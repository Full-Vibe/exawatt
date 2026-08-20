import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetResolvedDistributionForTest } from './resolved';

/**
 * The runtime half of incident `0015` (BUG-044).
 *
 * `verify:community-build` proves the community composition BUILDS. This proves
 * it RUNS: every request-time entrypoint — server actions and route handlers —
 * has to answer under a distribution that excludes the account capability, and
 * "answer" means a response, not a throw. The build check cannot see this,
 * because every one of these paths only executes when something calls it.
 *
 * The suite is a CENSUS plus a BEHAVIOUR check, and the census is the half that
 * makes it durable. A new server action or route handler fails this file until
 * its author writes down what it does with no account service, so the class
 * cannot quietly regrow one 500 at a time.
 *
 * ENG-030 WP3 split the census across the composition boundary rather than
 * shrinking it. The hosted implementations left `src/app` for the company
 * overlay, so there are now two exhaustive maps and a third property tying them
 * together: an entrypoint declared as company code may NOT exist in the public
 * tree, and nothing under `src/` may import across the boundary. A relocation
 * that quietly left a hosted route behind, or a public module that reached into
 * the overlay, would still be a build that ships what it says it does not.
 */

const APP_ROOT = path.resolve(__dirname, '../../app');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const OFFICIAL_CONTRACT = readFileSync(
  path.join(REPO_ROOT, 'scripts/distribution.official.example.json'),
  'utf8'
);

type Disposition =
  /** Reaches the account seam; must degrade without it. */
  | 'degrades'
  /** Never touches the account surface in any distribution. */
  | 'account-free';

/**
 * Every request-time entrypoint under `src/app`, with what it means when the
 * account capability is absent. Keep this exhaustive: the census below fails
 * on anything discovered that is not listed, and on anything listed that no
 * longer exists.
 */
const ENTRYPOINTS: Record<string, Disposition> = {
  // Per-device keyboard overrides. The device store is the source of truth;
  // these actions only sync it to an account, so "no account" is an ordinary
  // answer rather than an error.
  'actions/preferences.ts': 'degrades',
  // No account service means no session to end.
  'actions/projects.ts': 'degrades',
  // The landing routes of an account flow that cannot start here: 404.
  'auth/callback/route.ts': 'degrades',
  'auth/electron-callback/route.ts': 'degrades',
  // Local-only reads. `api/oc/token` deliberately consults no account at all,
  // but is now a tombstone: OS-local credentials never cross a web response.
  'api/dev-identity/route.ts': 'account-free',
  'api/oc/token/route.ts': 'account-free',
  // Hackathon toy (temporary): generates a fabricated timeline from a public
  // handle via the Anthropic API. Never touches the account seam.
  'api/world/simulate/route.ts': 'account-free',
};

/**
 * The same census for the company overlay (ENG-030 WP3). These entrypoints are
 * hosted implementations: they exist in an `official-web` composition and in no
 * other. The dispositions are unchanged by the move — a token-authenticated
 * service route is already nullable at its own seam (`authenticatedSupabase`
 * returns null), so an absent capability is 401, never a throw — and stating
 * them here is what keeps "the overlay is where hosted code lives" checkable
 * from the public side of the boundary.
 */
const OVERLAY_ENTRYPOINTS: Record<string, Disposition> = {
  // No account service means no operator to authorise; both verbs refuse.
  'admin/invites/actions.ts': 'degrades',
  'api/context-labels/route.ts': 'degrades',
  'api/conversations/summarize/route.ts': 'degrades',
  'api/feedback/route.ts': 'degrades',
  'api/goal-visuals/route.ts': 'degrades',
  'api/operator-stats/route.ts': 'degrades',
  // Invite redemption runs on the service-role store, which is already
  // nullable, and the download itself is never gated on it.
  'download/artifact/route.ts': 'account-free',
};

const OVERLAY_APP_ROOT = path.join(
  REPO_ROOT,
  'company/overlay/web/src/app'
);

function walk(directory: string, root = directory): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules') continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...walk(absolute, root));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || /\.(test|spec)\.tsx?$/.test(entry)) continue;
    const source = readFileSync(absolute, 'utf8');
    const isRouteHandler = /^route\.tsx?$/.test(entry);
    const isServerAction = /^\s*['"]use server['"];/m.test(source);
    if (isRouteHandler || isServerAction) {
      found.push(path.relative(root, absolute));
    }
  }
  return found;
}

/** Every source file the public application tree carries. */
function publicSourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules') continue;
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      found.push(...publicSourceFiles(absolute));
      continue;
    }
    if (/\.(ts|tsx|mts|js|jsx|mjs|cjs)$/.test(entry)) found.push(absolute);
  }
  return found;
}

describe('every request-time entrypoint has a declared community disposition', () => {
  it('discovers exactly the entrypoints this file accounts for', () => {
    expect(walk(APP_ROOT).sort()).toEqual(Object.keys(ENTRYPOINTS).sort());
  });

  it('accounts for every hosted entrypoint the company overlay supplies', () => {
    // A public checkout has no overlay; the boundary below is what makes that
    // the only difference between the two trees.
    if (!existsSync(OVERLAY_APP_ROOT)) {
      expect(existsSync(path.join(REPO_ROOT, 'company'))).toBe(false);
      return;
    }
    expect(walk(OVERLAY_APP_ROOT).sort()).toEqual(
      Object.keys(OVERLAY_ENTRYPOINTS).sort()
    );
  });

  it('keeps every hosted entrypoint out of the public tree', () => {
    // The relocation is only real if the public tree stopped carrying these.
    // `verify:community-build` would still be green with a stray hosted route
    // present, because a route that answers 401 builds perfectly well.
    for (const entrypoint of Object.keys(OVERLAY_ENTRYPOINTS)) {
      expect(existsSync(path.join(APP_ROOT, entrypoint))).toBe(false);
      expect(ENTRYPOINTS).not.toHaveProperty(entrypoint);
    }
  });

  it('lets nothing in the public tree import across the composition boundary', () => {
    // If a public file needs something from a relocated module, the shared
    // piece is a contract and belongs in public; the implementation does not.
    const offenders = publicSourceFiles(path.join(REPO_ROOT, 'src'))
      .filter(file =>
        /(from|import|require)\s*\(?\s*['"][^'"]*company\/overlay/.test(
          readFileSync(file, 'utf8')
        )
      )
      .map(file => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('lets no server action reach the account through the ambient env', () => {
    // The throwing compatibility wrapper is gone; `accountServerClient` is the
    // only server-side account seam, and it asks the contract, never the env.
    const server = readFileSync(
      path.join(REPO_ROOT, 'src/lib/supabase/server.ts'),
      'utf8'
    );
    expect(server).not.toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(server).not.toContain(
      'Account service is not configured in this build'
    );
  });
});

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [], set: () => {} }),
  headers: async () => new Headers({ host: 'www.exawatt.ai' }),
}));

const exchangeCodeForSession = vi.fn(async () => ({ error: null }));
const getUser = vi.fn(async () => ({ data: { user: null } }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser, exchangeCodeForSession, signOut: vi.fn() },
  }),
}));

function useContract(json: string | undefined) {
  if (json === undefined) {
    delete process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON;
  } else {
    process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON = json;
  }
  resetResolvedDistributionForTest();
}

describe('a community distribution answers every account-backed entrypoint', () => {
  beforeEach(() => {
    // Exactly what `distribution-build.mjs` forces into a community build.
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
    useContract(undefined);
  });

  afterEach(() => {
    useContract(undefined);
    vi.clearAllMocks();
  });

  it('reports keyboard overrides as unavailable rather than as none', async () => {
    const preferences = await import('@/app/actions/preferences');

    // The distinction is the whole defect: an empty array here is what let the
    // provider adopt "no overrides" over the operator's real bindings.
    await expect(preferences.getKeyboardShortcuts()).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(preferences.updateKeyboardShortcuts([])).resolves.toEqual({
      status: 'unavailable',
    });
    await expect(preferences.resetKeyboardShortcuts()).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('treats sign-out as a no-op with no session to end', async () => {
    const { signOut } = await import('@/app/actions/projects');
    await expect(signOut()).resolves.toBeUndefined();
  });

  it('reports the auth landing routes as absent', async () => {
    const callback = await import('@/app/auth/callback/route');
    const response = await callback.GET(
      new Request('https://app.test/auth/callback?code=abc')
    );
    expect(response.status).toBe(404);

    const electron = await import('@/app/auth/electron-callback/route');
    const relayed = await electron.GET(
      new Request('https://app.test/auth/electron-callback?code=abc')
    );
    expect(relayed.status).toBe(404);
    // Nothing may relay into a protocol scheme this distribution never registers.
    await expect(relayed.text()).resolves.not.toContain('exawatt://');
  });

  it('retires the local gateway web read with no account in the picture', async () => {
    const token = await import('@/app/api/oc/token/route');
    const response = await token.GET();
    expect(response.status).toBe(410);
    await expect(response.text()).resolves.not.toMatch(/token|password|ws:/i);
  });
});

describe('an official distribution still reaches the account', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = '';
    useContract(OFFICIAL_CONTRACT);
  });

  afterEach(() => {
    useContract(undefined);
    vi.clearAllMocks();
  });

  it('asks the account who is signed in, not the ambient env', async () => {
    // The env stays blank on purpose: only the contract may enable the
    // capability, and the hosted answer must not depend on the legacy pair.
    const preferences = await import('@/app/actions/preferences');
    await expect(preferences.getKeyboardShortcuts()).resolves.toEqual({
      status: 'signed-out',
    });
    expect(getUser).toHaveBeenCalled();
  });

  it('exchanges an auth callback code instead of 404ing', async () => {
    const callback = await import('@/app/auth/callback/route');
    const response = await callback.GET(
      new Request('https://app.test/auth/callback?code=abc')
    );
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://app.test/workspace');
  });

  it('still relays the desktop callback deep link', async () => {
    const electron = await import('@/app/auth/electron-callback/route');
    const response = await electron.GET(
      new Request('https://app.test/auth/electron-callback?code=abc')
    );
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('exawatt://auth/callback');
  });
});
