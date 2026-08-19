import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContractJson,
} from '@exawatt/core/distribution';
import { resolveDistributionAnalyticsDecision } from '@/lib/analytics/config';
import { parseGoalVisualRequest } from '@/lib/goal-visuals/contract';
import { OUTBOUND_CONTROLS, OUTBOUND_CONTROL_IDS } from './contract';
import {
  createPathClassifier,
  readPathManifest,
} from '../../../scripts/lib/open-source-paths.mjs';

/**
 * ENG-030 OS2.2 — what the product SAYS it sends, held to what it sends.
 *
 * On 2026-08-18 decision `0021` was found asserting that Exawatt "forwards
 * short Session excerpts to Anthropic's API for Session labels with no opt-out
 * yet". OS1.5 had made that false eleven days earlier by giving context labels
 * their own switch. The document was public-bound, and a stale privacy claim is
 * materially worse published than unpublished. The same audit found the same
 * sentence still open in `projects/external-user-readiness.md`, an absolute
 * "your prompts are never uploaded" on `/download` that the context-label
 * payload disproves, and a `/privacy` analytics claim guarded by an assertion
 * about an environment variable the analytics resolver stopped consulting.
 *
 * WHY THESE FOUR ASSERTIONS AND NOT OTHERS
 *
 * Free prose cannot be pinned, and pretending otherwise produces a test that
 * either passes vacuously or fails on every rewrite. What CAN be pinned is the
 * small set of structural facts that every one of the stale claims above got
 * wrong. Each block below is chosen because a real, dated failure would have
 * tripped it:
 *
 *   1. CONTROL GROUNDING — every control names a capability that exists in the
 *      distribution contract, and community withholds it. Catches prose that
 *      invents or renames a capability.
 *   2. NO LIVE ABSOLUTE NEGATIVE — no public-bound document asserts that an
 *      outbound behavior cannot be turned off while `OUTBOUND_CONTROLS` says it
 *      can. This is the `0021` failure, stated as an invariant.
 *   3. DESTINATION CENSUS — every shipped module that can issue an HTTP request
 *      of its own is declared here with the manifest section that discloses it.
 *      A new outbound feature fails this file until it is written down.
 *   4. THE ANALYTICS CLAIM, ANCHORED TO THE REAL MECHANISM — whether the
 *      downloaded app collects analytics is decided by the distribution
 *      contract, not by `NEXT_PUBLIC_POSTHOG_KEY`, which
 *      `src/lib/analytics/config.ts` deliberately ignores.
 *
 * WHAT THIS DELIBERATELY DOES NOT COVER, so nobody reads it as more than it is:
 * it does not read a sentence for meaning, does not prove a redactor is
 * complete, does not observe a packaged build (`pnpm eval:community:network`
 * does that), does not reach the hosted routes, and cannot see the contents of
 * the official distribution secret, which lives outside every checkout. It
 * proves that the claims and the code have not drifted apart STRUCTURALLY. A
 * human still has to read the prose.
 *
 * Siblings, so the coverage boundary is legible:
 *   - `src/lib/analytics/manifest.test.ts`  — manifest vs. the event allowlist
 *   - `src/app/legal-surfaces.test.ts`      — /privacy and /terms vs. the same
 *   - `community-closure.test.ts`           — the Supabase-client census this
 *                                             file's `fetch` census complements
 */

const REPO_ROOT = process.cwd();
const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

const MANIFEST_PATH = 'docs/engineering/outbound-data.md';
const MANIFEST = read(MANIFEST_PATH);

/** The repository's own published shape of an official build's contract. */
const OFFICIAL = parseDistributionContractJson(
  read('scripts/distribution.official.example.json')
);

/* ------------------------------------------------------------------ */
/* 1. CONTROL GROUNDING                                                */
/* ------------------------------------------------------------------ */

/** Resolve `enrichment.contextLabels`-style paths against a parsed contract. */
function capabilityValue(contract: unknown, dottedPath: string): unknown {
  return dottedPath
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        node && typeof node === 'object'
          ? (node as Record<string, unknown>)[key]
          : undefined,
      contract
    );
}

describe('outbound controls are grounded in the distribution contract', () => {
  it('names a capability that exists, that community withholds', () => {
    for (const id of OUTBOUND_CONTROL_IDS) {
      const control = OUTBOUND_CONTROLS[id];
      const capability = control.requiresDistributionCapability;
      if (capability === null) {
        // Genuinely ungated traffic leaves through a separate program with its
        // own network identity. Today that is only the re-entry recap, which
        // shells out to the operator's own `claude` CLI.
        expect(control.destination).toContain('never Exawatt');
        continue;
      }
      expect(
        capabilityValue(OFFICIAL, capability),
        `${id} names ${capability}, which an official contract does not carry`
      ).not.toBeUndefined();
      expect(
        capabilityValue(OFFICIAL, capability),
        `${id}: an official contract must configure ${capability}`
      ).not.toBeNull();
      // Nullish either way: `ownAccount` is null outright in community, so its
      // member does not resolve. Both readings mean withheld, and the official
      // assertion above is what proves the path is real.
      expect(
        capabilityValue(COMMUNITY_DISTRIBUTION, capability) ?? null,
        `${id}: a community build must withhold ${capability}`
      ).toBeNull();
    }
  });

  it('gives every control a label and an off switch in the manifest', () => {
    for (const id of OUTBOUND_CONTROL_IDS) {
      const control = OUTBOUND_CONTROLS[id];
      expect(
        MANIFEST,
        `${MANIFEST_PATH} must name the "${control.label}" control`
      ).toContain(control.label);
    }
  });

  it('states the one default that is off, and says so where it matters', () => {
    // Decision `0029`: publishing is the only outbound behavior that is opt-in,
    // and the only one that makes anything public. If that polarity ever flips,
    // every sentence describing it is wrong at once.
    const offByDefault = OUTBOUND_CONTROL_IDS.filter(
      id => !OUTBOUND_CONTROLS[id].defaultEnabled
    );
    expect(offByDefault).toEqual(['operatorProfile']);
    expect(MANIFEST).toContain('Off by default, switch-governed');
  });
});

/* ------------------------------------------------------------------ */
/* 2. NO LIVE ABSOLUTE NEGATIVE                                        */
/* ------------------------------------------------------------------ */

/**
 * Sentences asserting that an outbound behavior CANNOT be switched off. Each is
 * a phrase that shipped, or nearly shipped, as a false claim.
 */
const NO_OFF_SWITCH_PHRASES = [
  'no opt-out',
  'no opt out',
  'untoggleable',
  'no user-facing toggle',
  'no user-facing off switch',
  'no user setting',
  'cannot be turned off',
  'no way to disable',
  'no control at all',
];

/**
 * The one outbound behavior that genuinely has no switch: the update check
 * (`docs/engineering/outbound-data.md` section 6, and its own Known-gaps line).
 * It has no `OUTBOUND_CONTROLS` entry, which is exactly why it is allowed to be
 * described this way. Anything else must be struck through or corrected.
 */
const BEHAVIORS_WITH_NO_SWITCH = [
  'update check',
  'update feed',
  'app updates',
  'updater',
];

/** A retraction, not a claim: struck through, closed, or explicitly corrected. */
const RETRACTION_MARKERS = [
  '~~',
  'closed 20',
  'corrected 20',
  'no longer',
  'made that false',
  'made it false',
  'was factually stale',
  'shape to avoid',
  'at the time',
];

/**
 * Claim-sized blocks, not paragraphs.
 *
 * A markdown bullet list is ONE paragraph, and that granularity is what let the
 * first draft of this test pass while `external-user-readiness.md` carried a
 * live "no user-facing off switch" bullet three items above a struck-through
 * one: the retraction marker in a sibling bullet excused the whole list. A new
 * block therefore starts at a blank line, a list item, or a heading, and each
 * block carries the nearest preceding heading so a bullet like "**No user
 * setting disables it**" is still read under "## 6. App updates".
 */
function claimBlocks(source: string): string[] {
  const blocks: string[] = [];
  let heading = '';
  let current: string[] = [];
  const flush = () => {
    const body = current.join('\n').trim();
    if (body) blocks.push(`${heading}\n${body}`);
    current = [];
  };
  for (const line of source.split('\n')) {
    if (
      /^\s*$/.test(line) ||
      /^\s*[-*+]\s/.test(line) ||
      /^#{1,6}\s/.test(line)
    ) {
      flush();
      if (/^#{1,6}\s/.test(line)) {
        heading = line;
        continue;
      }
    }
    current.push(line);
  }
  flush();
  return blocks;
}

/**
 * Every tracked path the publication classifier calls PUBLIC or GENERATED.
 *
 * Read as SOURCE, not as the rendered public variant. A phrase inside a
 * `public-omit` block therefore still fails even though it never publishes.
 * That is the conservative direction on purpose: the source is what the next
 * agent edits, and `0021` was corrected at the source for the same reason.
 */
async function publicBoundMarkdown(): Promise<string[]> {
  const manifest = await readPathManifest(
    path.join(REPO_ROOT, 'scripts/open-source-paths.manifest.json')
  );
  const classify = createPathClassifier(manifest);
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(path.join(REPO_ROOT, directory))) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const child = path.join(directory, entry);
      if (statSync(path.join(REPO_ROOT, child)).isDirectory()) {
        visit(child);
        continue;
      }
      if (!child.endsWith('.md')) continue;
      const classification = classify(child).classification;
      if (classification === 'PUBLIC' || classification === 'GENERATED') {
        files.push(child);
      }
    }
  };
  visit('docs');
  for (const entry of readdirSync(REPO_ROOT)) {
    if (!entry.endsWith('.md')) continue;
    const classification = classify(entry).classification;
    if (classification === 'PUBLIC' || classification === 'GENERATED') {
      files.push(entry);
    }
  }
  return files.sort();
}

describe('no public-bound document says a switched behavior cannot be switched', () => {
  it('finds no live "no off switch" claim outside the update check', async () => {
    // `/privacy`, `/terms`, and `/download` are not PUBLIC-classified — they
    // live in the company overlay, because a fork inherits no operator's legal
    // pages — but strangers read them, so they are audited with the rest. Both
    // locations are listed: the composed path an official build serves from,
    // and the overlay source. A public checkout has neither and skips them.
    const surfaces = [
      ...(await publicBoundMarkdown()),
      'src/app/privacy/page.tsx',
      'src/app/terms/page.tsx',
      'company/overlay/web/src/app/privacy/page.tsx',
      'company/overlay/web/src/app/terms/page.tsx',
      'company/overlay/web/src/app/download/page.tsx',
      // ENG-030 WP3: `/download`'s machine-behaviour prose moved into a shared
      // component when the public tree gained its own download page, so the
      // sentences this scan is about live here now for BOTH surfaces. Listing
      // the page alone would have quietly stopped auditing them.
      'src/components/download/machine-disclosures.tsx',
      'src/app/download/community/page.tsx',
    ];
    const offenders: string[] = [];
    for (const file of surfaces) {
      let source: string;
      try {
        source = read(file);
      } catch {
        // A public checkout has no company overlay; that is composition, not a
        // missing assertion.
        continue;
      }
      for (const paragraph of claimBlocks(source)) {
        const lowered = paragraph.toLowerCase();
        if (!NO_OFF_SWITCH_PHRASES.some(phrase => lowered.includes(phrase))) {
          continue;
        }
        if (RETRACTION_MARKERS.some(marker => lowered.includes(marker))) {
          continue;
        }
        if (BEHAVIORS_WITH_NO_SWITCH.some(word => lowered.includes(word))) {
          continue;
        }
        offenders.push(`${file}: ${paragraph.trim().slice(0, 160)}`);
      }
    }
    expect(
      offenders,
      'Every behavior in OUTBOUND_CONTROLS has a switch. A public document ' +
        'saying otherwise is the decision `0021` failure repeating. Strike ' +
        'the sentence through with ~~ and date the closure, or correct it.'
    ).toEqual([]);
  });

  it('keeps the update check listed as the exception it is', () => {
    // The exemption above is only honest while the update check really has no
    // control. The moment one exists, it belongs in OUTBOUND_CONTROLS and this
    // exemption has to go.
    const controlLabels = OUTBOUND_CONTROL_IDS.map(id =>
      OUTBOUND_CONTROLS[id].label.toLowerCase()
    );
    expect(controlLabels).not.toContain('app updates');
    expect(MANIFEST).toContain('**No user setting disables it** — a known gap');
  });
});

/* ------------------------------------------------------------------ */
/* 3. DESTINATION CENSUS                                               */
/* ------------------------------------------------------------------ */

const SHIPPED_TREES = ['src', 'electron', 'packages/core/src'];

/**
 * Every shipped module that can issue an HTTP request of its own, mapped to the
 * manifest section that discloses what it sends. `null` means the module only
 * PASSES a transport around and adds no destination of its own.
 *
 * Modules that reach Supabase through `createOptionalClient` /
 * `accountServerClient` do not appear here and are not missing: they carry no
 * `fetch` of their own, and `community-closure.test.ts` already censuses every
 * site that can construct a remote client.
 */
const OUTBOUND_CALL_SITES: Record<string, string | null> = {
  'electron/main/auth-coordinator.ts': '## 5. Supabase',
  // Wraps whatever transport it is handed and records phase metadata locally.
  'electron/main/auth-diagnostics.ts': null,
  'electron/main/consumption/claude-plan-account.ts':
    '## 7. Locally spawned agent harnesses',
  // Injects `electron.net.fetch` into the modules above; opens no destination.
  'electron/main/main.ts': null,
  'electron/main/pty/context-summarizer.ts': '## 2. Hosted context labels',
  'electron/main/pty/conversation-catalog.ts':
    '## 3. Hosted conversation summaries',
  'src/components/feedback/product-feedback-provider.tsx': '## 5. Supabase',
  'src/components/feedback/use-untriaged-feedback.ts': '## 5. Supabase',
  'src/components/hud/goal-visual-layout-study.tsx': '## 4. Goal visuals',
  'src/components/operator-stats/publish-panel.tsx': '## 5. Supabase',
  'src/lib/desktop-release/desktop-build.ts': '## 6. App updates',
  'src/lib/operator-stats/auto-sync.ts': '## 5. Supabase',
  'src/lib/operator-stats/public.ts': '## 5. Supabase',
  'src/lib/server/authenticated-supabase.ts': '## 5. Supabase',
  'src/proxy.ts': '## 5. Supabase',
};

/** Comments quote hostnames and describe requests; read code, not prose. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

/**
 * `fetch` used as a VALUE: called directly, called through a stored reference,
 * or accepted as an injected transport. `conversation-catalog.ts` calls
 * `this.fetchFn(...)`, so matching only `fetch(` would miss a real destination.
 */
const FETCH_AS_VALUE =
  /(?<![.\w$'"])fetch\s*\(|\.fetch\s*\(|typeof\s+fetch\b|(?<![.\w$])fetch(?=\s*[,;)\]}])/;

function shippedModules(): string[] {
  const found: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(path.join(REPO_ROOT, directory))) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const child = path.join(directory, entry);
      if (statSync(path.join(REPO_ROOT, child)).isDirectory()) {
        visit(child);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      if (/\.d\.ts$/.test(entry)) continue;
      found.push(child);
    }
  };
  for (const tree of SHIPPED_TREES) visit(tree);
  return found;
}

describe('every outbound call site is declared and disclosed', () => {
  it('discovers exactly the modules this file accounts for', () => {
    const discovered = shippedModules()
      .filter(file => FETCH_AS_VALUE.test(withoutComments(read(file))))
      .sort();
    expect(
      discovered,
      'A shipped module gained or lost the ability to make an HTTP request. ' +
        'Add it to OUTBOUND_CALL_SITES with the outbound-data manifest ' +
        'section that discloses what it sends, or remove its entry.'
    ).toEqual(Object.keys(OUTBOUND_CALL_SITES).sort());
  });

  it('points every declared call site at a section the manifest really has', () => {
    for (const [file, section] of Object.entries(OUTBOUND_CALL_SITES)) {
      if (section === null) continue;
      expect(
        MANIFEST,
        `${file} claims to be disclosed under "${section}", which ` +
          `${MANIFEST_PATH} does not contain`
      ).toContain(section);
    }
  });

  it('names every third-party destination the shipped code can reach', () => {
    // The Exawatt-owned hosts are censused by `community-closure.test.ts`.
    // These are the ones that leave for somebody else, and a manifest that
    // omits one is the exact failure this file exists to prevent.
    for (const host of ['api.anthropic.com', 'fal.run', 'fal.media']) {
      expect(MANIFEST, `${MANIFEST_PATH} must name ${host}`).toContain(host);
    }
    // `avatars.githubusercontent.com` reaches a third party from the VIEWER's
    // machine because `img-src` is `https:` wholesale while `connect-src` is
    // enumerated from the contract. Added to the manifest 2026-08-18.
    expect(read('src/lib/distribution/next-policy.ts')).toContain(
      "img-src 'self' data: blob: https:"
    );
    expect(MANIFEST).toContain('avatars.githubusercontent.com');
  });
});

/* ------------------------------------------------------------------ */
/* 4. THE ANALYTICS CLAIM, ANCHORED TO THE REAL MECHANISM              */
/* ------------------------------------------------------------------ */

describe('the analytics claim is anchored to what decides it', () => {
  it('proves the distribution contract, not an env var, is the switch', () => {
    // `/privacy` said "The macOS app you download is built without an
    // analytics key" and `legal-surfaces.test.ts` guarded it by asserting the
    // release workflow never mentions NEXT_PUBLIC_POSTHOG_KEY. That guard was
    // inert: `src/lib/analytics/config.ts` states in as many words that
    // ambient NEXT_PUBLIC_POSTHOG_* variables are deliberately invisible, and
    // the release workflow builds with EXAWATT_DISTRIBUTION_CONFIG_JSON, whose
    // `analytics` member is what actually decides.
    expect(read('src/lib/analytics/config.ts')).toContain(
      'Ambient legacy\n * `NEXT_PUBLIC_POSTHOG_*` variables are deliberately invisible here.'
    );
    const workflow = read('.github/workflows/release-macos.yml');
    expect(workflow).toContain('EXAWATT_DISTRIBUTION_CONFIG_JSON');

    expect(
      resolveDistributionAnalyticsDecision(
        OFFICIAL,
        { optedOut: false },
        'production'
      ).enabled,
      'An official contract configures analytics, so an official desktop ' +
        'build collects them. /privacy may not say otherwise.'
    ).toBe(true);
    expect(
      resolveDistributionAnalyticsDecision(
        COMMUNITY_DISTRIBUTION,
        { optedOut: false },
        'production'
      ).enabled
    ).toBe(false);
  });

  it('keeps /privacy off the claim the mechanism disproves', () => {
    // Composed location first, overlay source second (see the census above).
    const source = [
      'src/app/privacy/page.tsx',
      'company/overlay/web/src/app/privacy/page.tsx',
    ].find(candidate => existsSync(path.join(REPO_ROOT, candidate)));
    if (!source) return; // public checkout: the page is not this tree's
    const privacy = read(source).replace(/\s+/g, ' ');
    expect(
      privacy,
      'An official build carries an analytics endpoint. State the rule ' +
        '(analytics run where the build declares an endpoint), never the ' +
        'accident of one release.'
    ).not.toContain('built without an analytics key');
    expect(privacy).toContain(
      'Analytics run only where the build carries an analytics endpoint'
    );
  });

  it('keeps the manifest saying both halves', () => {
    expect(MANIFEST).toContain(
      'Off in community; on in configured production distributions'
    );
    expect(MANIFEST).toContain('Official web and desktop');
  });
});

/* ------------------------------------------------------------------ */
/* 5. THE PUBLISHED CONTRACT IS THE SHIPPED REQUEST                    */
/* ------------------------------------------------------------------ */

/** The `{ … }` body of a named interface, which contains no nested braces. */
function interfaceBody(source: string, name: string): string {
  const match = new RegExp(`interface ${name} \\{([^}]*)\\}`).exec(source);
  expect(match, `${name} is not declared as a flat interface`).not.toBeNull();
  return match![1];
}

describe('the published goal-visual contract is what the client sends', () => {
  it('keeps every caller on schemaVersion and an opaque identity', () => {
    // Until 2026-08-19 this block asserted the OPPOSITE: the schema admitted
    // only `{ schemaVersion, identityKey }` while the client sent the accepted
    // context label, so it required `contracts/README.md` to say the section
    // was a target rather than a guarantee. BUG-091 migrated the client, the
    // `/hud-gallery` bench, and the hosted route together, so the assertion is
    // inverted: the label may not come back without this failing.
    const schema = JSON.parse(
      read('contracts/services/v1/schemas/goal-visuals.schema.json')
    );
    expect(
      Object.keys(
        schema.$defs.request.properties as Record<string, unknown>
      ).sort()
    ).toEqual(['identityKey', 'schemaVersion']);
    expect(schema.$defs.request.additionalProperties).toBe(false);

    for (const [file, name] of [
      ['electron/main/pty/context-summarizer.ts', 'GoalVisualRequest'],
      ['src/lib/goal-visuals/contract.ts', 'GoalVisualRequest'],
    ] as const) {
      const body = interfaceBody(read(file), name);
      expect(body, `${file} must send the opaque identity`).toContain(
        'identityKey'
      );
      for (const retired of ['label', 'projectKey']) {
        expect(
          body,
          `${file} must not put ${retired} back on the wire (BUG-091)`
        ).not.toContain(retired);
      }
    }

    // The parser is the enforcement point: the request object is closed, so a
    // caller that adds a label is refused rather than silently trimmed.
    expect(() =>
      parseGoalVisualRequest(
        JSON.stringify({
          schemaVersion: 1,
          identityKey: 'a'.repeat(64),
          label: 'Improve agent context summaries',
        })
      )
    ).toThrow('unsupported fields');

    expect(read('contracts/README.md')).toContain(
      "**Exawatt's own client sends this.**"
    );
    expect(MANIFEST).toContain('two fields');
  });
});
