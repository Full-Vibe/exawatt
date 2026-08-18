/**
 * ENG-030 WP2's closure property, and the one assertion no test held.
 *
 * `community-neutrality.test.ts` proves the community CONTRACT projects no
 * capability. `community-runtime.test.ts` proves every request-time ENTRYPOINT
 * answers without an account. Neither proves CLOSURE — that there is no OTHER
 * door: some module nobody's census walked which builds its own client and
 * reaches an Exawatt service anyway. The inventory's WP2 acceptance names that
 * assertion in as many words ("no module reachable from a community build
 * imports a service factory that can resolve non-null"), and this file is it.
 *
 * The proof is deliberately a SUPERSET argument rather than a reachability
 * walk. "Reachable from a community build" computed from the module graph is
 * both expensive and fragile: Next's client/server split, `use client`
 * boundaries, route-segment tree-shaking, and Electron's separate `rootDir`
 * mean any hand-rolled walk would answer a slightly different question than
 * the bundler does, and would silently narrow the moment one of them changed.
 * So this asserts the property over EVERY module in the three shipped trees
 * (`src/`, `electron/`, `packages/core/src/`), which strictly CONTAINS
 * everything a community build can reach. If nothing anywhere can construct an
 * Exawatt service client under the community contract, then in particular
 * nothing reachable can.
 *
 * Three assertions carry it:
 *
 *   1. CENSUS — the set of shipped modules that value-import a remote-client
 *      constructor is exactly the declared list below. A new one fails this
 *      file until its author writes down which seam gates it, so the class
 *      cannot quietly regrow one import at a time.
 *   2. ABSENCE — with every one of those constructors mocked to THROW, and
 *      `fetch` mocked to throw, every declared factory still ANSWERS under the
 *      community contract. A construction attempt cannot pass as a null here;
 *      it is an exception with the caller's name on it.
 *   3. NO SECOND DOOR — no shipped module carries an Exawatt-owned service host
 *      as a literal outside the declared non-request roles, so nothing can
 *      reach one without a constructor the census already covers; and every
 *      dynamic `import()` in the shipped trees has a literal specifier, so no
 *      module can enter the graph unnamed.
 *
 * `company/overlay/` is deliberately outside the trees walked here, and that is
 * a statement about composition rather than an omission: WP3 made the overlay
 * strictly ADD-ONLY on top of a public tree, and only the `official-*` profiles
 * apply it, so no community build can contain a file from it.
 * `community-runtime.test.ts` owns the enforcement — nothing under `src/` may
 * import across the boundary — which is what keeps this file's tree list from
 * being a way to hide a service client rather than a way to bound the proof.
 *
 * What this deliberately does NOT prove: that a third-party dependency makes
 * no call of its own, that a native module opens no socket, and that the
 * packaged runtime behaves as the source says. Those are observations, not
 * static properties — `pnpm eval:community:network` makes them against a real
 * packaged community build.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMUNITY_DISTRIBUTION } from '@exawatt/core/distribution';
import { resetResolvedDistributionForTest } from './resolved';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** The trees that ship inside a desktop package or its loopback server. */
const SHIPPED_TREES = ['src', 'electron', 'packages/core/src'];

/**
 * Packages whose exports can open a socket to an Exawatt-owned service. A
 * module that value-imports one of these is, by definition, able to construct
 * a client; a module that does not, is not.
 *
 * `posthog-js` is the analytics sink; the two Supabase packages are account
 * transport and every service-role/anon read built on it.
 */
const REMOTE_CLIENT_PACKAGES = [
  '@supabase/ssr',
  '@supabase/supabase-js',
  'posthog-js',
];

/**
 * Every shipped module allowed to value-import one of the above, and the seam
 * that decides whether it may ever construct anything. Each is exercised under
 * the community contract in the ABSENCE suite below.
 */
const DECLARED_CONSTRUCTOR_SITES: Record<string, string> = {
  // The renderer account seam. `contract.account` or null — legacy
  // `NEXT_PUBLIC_SUPABASE_*` is deliberately invisible to it.
  'src/lib/supabase/client.ts': 'createOptionalClient(contract)',
  // The one server-side account seam a request-time path may use (BUG-044).
  'src/lib/supabase/server.ts': 'createOptionalServerClient(contract)',
  // Bearer-token service routes. Null capability answers 401, never a throw.
  'src/lib/server/authenticated-supabase.ts': 'authenticatedSupabase(token)',
  // The public arena's anonymous reads (incident `0017`).
  'src/lib/operator-stats/public.ts': 'publicClient() via the read helpers',
  // Cookie-refresh middleware. A stale cookie from a previous official install
  // is not authority to rebuild transport.
  'src/proxy.ts': 'resolvedDistribution().account before createServerClient',
  // Analytics. The SDK chunk is imported only after the decision is `enabled`,
  // so a community build never even loads it.
  'src/lib/analytics/client.ts': 'resolveDistributionAnalyticsDecision',
  // Electron main's OAuth coordinator. It holds no baked configuration: the
  // renderer passes url/anon-key over IPC, and the renderer cannot produce
  // them without `contract.account`.
  'electron/main/auth-coordinator.ts': 'ElectronAuthStartConfig over IPC',
};

/**
 * Host suffixes that identify an Exawatt-operated service. A literal
 * containing one of these in shipped source is a potential second door, so
 * each surviving occurrence is declared with the reason it is not a request.
 */
const SERVICE_HOST_SUFFIXES = ['exawatt.ai', 'supabase.co', 'posthog.com'];

const DECLARED_HOST_LITERALS: Record<string, string> = {
  // `src/app/{privacy,terms}/page.tsx` used to be declared here for their
  // `mailto:` contact addresses. They moved to the company overlay on
  // 2026-08-18 because a fork must not inherit one operator's legal pages, so
  // the public tree no longer contains them and no declaration is owed.
  //
  // Prose naming the official distributor so a community build cannot be
  // mistaken for one (decision `0021`). Not a URL, not a link, never a request:
  // the page's own test asserts it offers no artifact.
  'src/app/download/community/page.tsx':
    'prose naming the official distribution',
  // Canonical public website origin for sitemap/robots. The module's own
  // comment pins it: never an analytics fallback.
  'src/lib/analytics/config.ts': 'sitemap/robots origin',
  // The PostHog rewrite destinations. `distributionRewrites` returns [] unless
  // `contract.analytics` is present, which is what stops a community build
  // being repurposed as an ambient ingest proxy — pinned in next-policy.test.
  'src/lib/distribution/next-policy.ts':
    'rewrite destinations, emitted only when contract.analytics exists',
};

function walkShipped(): string[] {
  const found: string[] = [];
  const visit = (absolute: string) => {
    for (const entry of readdirSync(absolute)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(absolute, entry);
      if (statSync(child).isDirectory()) {
        visit(child);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      if (/\.d\.ts$/.test(entry)) continue;
      found.push(path.relative(REPO_ROOT, child));
    }
  };
  for (const tree of SHIPPED_TREES) visit(path.join(REPO_ROOT, tree));
  return found;
}

/** Import statements with the pure `import type` form removed. */
function valueImportSpecifiers(source: string): string[] {
  const withoutTypeOnly = source.replace(
    /^\s*import\s+type\s[\s\S]*?from\s*['"][^'"]+['"];?/gm,
    ''
  );
  const specifiers: string[] = [];
  const pattern =
    /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutTypeOnly)) !== null) {
    const clause = match[1] ?? '';
    const specifier = match[2] ?? match[3];
    if (!specifier) continue;
    // `import { type Session } from 'x'` binds no value; `import { createClient,
    // type Session }` does. Keep the module only when at least one binding is
    // not inline-`type`.
    const named = clause.match(/\{([\s\S]*)\}/)?.[1];
    if (named !== undefined) {
      const bindings = named
        .split(',')
        .map(binding => binding.trim())
        .filter(Boolean);
      if (bindings.length > 0 && bindings.every(b => /^type\s/.test(b))) {
        continue;
      }
    }
    specifiers.push(specifier);
  }
  return specifiers;
}

function importsRemoteClient(source: string): boolean {
  return valueImportSpecifiers(source).some(specifier =>
    REMOTE_CLIENT_PACKAGES.some(
      pkg => specifier === pkg || specifier.startsWith(`${pkg}/`)
    )
  );
}

describe('closure: only declared seams can construct a remote client', () => {
  const shipped = walkShipped();

  it('discovers exactly the constructor sites this file accounts for', () => {
    const discovered = shipped
      .filter(file => importsRemoteClient(readFileSync(file, 'utf8')))
      .sort();
    expect(discovered).toEqual(Object.keys(DECLARED_CONSTRUCTOR_SITES).sort());
  });

  it('finds no Exawatt service host outside a declared non-request role', () => {
    const discovered = shipped
      .filter(file => {
        const source = readFileSync(file, 'utf8');
        return SERVICE_HOST_SUFFIXES.some(suffix => source.includes(suffix));
      })
      .sort();
    expect(discovered).toEqual(Object.keys(DECLARED_HOST_LITERALS).sort());
  });

  it('leaves no module able to enter the graph unnamed', () => {
    // The census above reads static and literal-dynamic imports. A computed
    // specifier — `import(somePath)` — would let a module join the graph
    // without ever appearing in it, which would make the census unsound rather
    // than merely incomplete. There are none, and this keeps it that way.
    const computed = shipped.filter(file => {
      const source = readFileSync(file, 'utf8');
      return /(?<![.\w])import\(\s*(?!['"])/.test(source);
    });
    expect(computed).toEqual([]);
  });
});

/* -------------------------------------------------------------------- */
/* ABSENCE — every declared seam answers with no constructor available.  */
/* -------------------------------------------------------------------- */

function refuse(what: string) {
  return () => {
    throw new Error(`A community build constructed ${what}`);
  };
}

vi.mock('@supabase/ssr', () => ({
  createBrowserClient: refuse('a browser account client'),
  createServerClient: refuse('a server account client'),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: refuse('a Supabase service client'),
  isAuthRetryableFetchError: () => false,
}));

vi.mock('posthog-js/dist/module.full.no-external', () => ({
  default: refuse('the analytics SDK'),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers({ host: 'www.exawatt.ai' }),
}));

describe('absence: every declared seam answers under the community contract', () => {
  beforeEach(() => {
    // Exactly what `distribution-build.mjs` forces into a community build,
    // plus the private key that must never be sufficient on its own.
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://poisoned.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'poisoned-anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'poisoned-service-role-key';
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'poisoned-project-key';
    delete process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON;
    resetResolvedDistributionForTest();
    // Nothing below may reach the network either: a factory that returned a
    // hand-rolled fetch wrapper instead of a client would slip past the
    // constructor mocks, and this catches it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        throw new Error(`A community build fetched ${String(input)}`);
      })
    );
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    resetResolvedDistributionForTest();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renderer account seam: createOptionalClient', async () => {
    const { createOptionalClient } = await import('@/lib/supabase/client');
    expect(createOptionalClient(COMMUNITY_DISTRIBUTION)).toBeNull();
  });

  it('server account seam: createOptionalServerClient / accountServerClient', async () => {
    const seam = await import('@/lib/supabase/server');
    await expect(
      seam.createOptionalServerClient(COMMUNITY_DISTRIBUTION)
    ).resolves.toBeNull();
    await expect(seam.accountServerClient()).resolves.toBeNull();
  });

  it('bearer-token service seam: authenticatedSupabase', async () => {
    const { authenticatedSupabase } =
      await import('@/lib/server/authenticated-supabase');
    await expect(authenticatedSupabase('any-token')).resolves.toBeNull();
  });

  it('service-role seam: it is not in the public tree at all (WP3)', () => {
    // `inviteStore()` used to be declared above and return null under the
    // community contract. WP3 moved it, and the whole invite surface with it,
    // into the company overlay — so the strongest statement is now absence
    // rather than a null. `community-runtime.test.ts` owns the other half:
    // nothing under `src/` may import across the composition boundary, which
    // is what stops this file from coming back through the side door.
    expect(
      existsSync(path.join(REPO_ROOT, 'src/lib/invites/server-client.ts'))
    ).toBe(false);
  });

  it('public arena seam: configured=false and absence, not emptiness', async () => {
    const arena = await import('@/lib/operator-stats/public');
    expect(arena.publicArenaConfigured()).toBe(false);
    await expect(arena.readLeaderboard('agent-hours', 'all')).resolves.toEqual(
      []
    );
    await expect(arena.readOperatorProfile('jake')).resolves.toBeNull();
    await expect(arena.readRunReceipt('run-1')).resolves.toBeNull();
  });

  it('middleware seam: a stale session cookie rebuilds no transport', async () => {
    const { NextRequest } = await import('next/server');
    const { proxy } = await import('@/proxy');
    // A non-public path with a structurally valid Supabase session cookie: the
    // one input that gets past the cookie short-circuit and would reach
    // `createServerClient` if the contract were not the only capability switch.
    const request = new NextRequest('http://127.0.0.1:7000/admin/invites');
    request.cookies.set('sb-project-auth-token', 'stale-session-value');
    const response = await proxy(request);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('analytics seam: the SDK chunk is never even imported', async () => {
    const analytics = await import('@/lib/analytics/client');
    await expect(analytics.initAnalytics()).resolves.toEqual({
      enabled: false,
      reason: 'no_distribution_config',
    });
  });

  it('electron main holds no configuration of its own to construct from', () => {
    // `auth-coordinator.ts` is the one Electron main module that can build an
    // account client, and it is handed url/anon-key over IPC rather than
    // reading any environment. The renderer is the only producer of that
    // config, and it derives it from `contract.account` (`use-electron-auth`).
    // Both halves are asserted as source facts because there is no runtime in
    // this suite that can hold an Electron IPC channel.
    const coordinator = readFileSync(
      path.join(REPO_ROOT, 'electron/main/auth-coordinator.ts'),
      'utf8'
    );
    expect(coordinator).not.toContain('process.env');
    const renderer = readFileSync(
      path.join(REPO_ROOT, 'src/hooks/use-electron-auth.ts'),
      'utf8'
    );
    expect(renderer).toContain('resolvedDistribution().account');
  });
});
