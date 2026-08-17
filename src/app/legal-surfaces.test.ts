import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { ANALYTICS_PROPERTY_DENYLIST } from '@/lib/analytics/redact';

/**
 * `/privacy` and `/terms` are factual claims about shipped behavior, and until
 * this file existed nothing held them to it. An audit on 2026-08-16 found both
 * pages describing a product that does not exist: a cloud platform with a web
 * dashboard and API access, a third-party payment processor, collection of
 * "prompts, outputs, logs", tracking of "pages visited, time spent", three
 * privacy controls under names Settings has never used, and an operator-profile
 * takedown that the switch does not perform. Every one of those was disproven
 * by code sitting in the same repository.
 *
 * The structural cause was ownership, not carelessness: these pages had no
 * test and no roadmap owner, so they could not fail. This test is the owner.
 *
 * It pins the load-bearing claims to the same contracts
 * `docs/engineering/outbound-data.md` is pinned to by
 * `src/lib/analytics/manifest.test.ts`:
 *
 *   - `OUTBOUND_CONTROLS` — the control names and what each one sends
 *   - `ANALYTICS_PROPERTY_DENYLIST` — what analytics cannot carry
 *   - `.github/workflows/release-macos.yml` — what the downloaded build is
 *     actually built with
 *   - the absence of any billing implementation
 *
 * When one of these fails, the fix is to reconcile the page to the code. Never
 * the other way round.
 */

const read = (path: string) => readFileSync(path, 'utf8');

/** JSX wraps prose across lines; compare on collapsed whitespace. */
const flatten = (source: string) => source.replace(/\s+/g, ' ');

/**
 * The rendered page, not the file. Comments in these files deliberately quote
 * the false claims they exist to prevent, so a naive read of the source would
 * fail the very assertions those comments are warning about.
 */
const rendered = (path: string) =>
  flatten(
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^[ \t]*\/\/.*$/gm, ' ')
  );

const PRIVACY = rendered('src/app/privacy/page.tsx');
const TERMS = rendered('src/app/terms/page.tsx');
const RELEASE_WORKFLOW = read('.github/workflows/release-macos.yml');

describe('privacy page: outbound controls', () => {
  it('names every control the operator can actually see in Settings', () => {
    for (const control of Object.values(OUTBOUND_CONTROLS)) {
      expect(
        PRIVACY,
        `/privacy must describe the "${control.label}" control`
      ).toContain(control.label);
    }
  });

  it('never uses the internal vocabulary the contract forbids', () => {
    // `contract.ts` goalVisuals: "Goal visuals" is roadmap vocabulary and must
    // not reach a user-facing string. Same for the internal ids.
    for (const forbidden of [
      'Goal visuals',
      'goal visuals',
      'goalVisuals',
      'reentryRecap',
      'contextLabels',
      're-entry recap',
    ]) {
      expect(PRIVACY, `"${forbidden}" is internal vocabulary`).not.toContain(
        forbidden
      );
    }
  });

  it('keeps pausing and taking down a public profile as separate acts', () => {
    // The switch calls `setOperatorAutoPublish`; only the DELETE behind
    // "Remove public profile" runs `disable_operator_profile`, which is what
    // the public reads filter on (`WHERE p.enabled = true`).
    expect(OUTBOUND_CONTROLS.operatorProfile.cost).toContain(
      'it stays visible until you remove it'
    );
    expect(PRIVACY).toContain('Remove public profile');
    expect(PRIVACY).toContain('stops future updates');
    expect(PRIVACY).toContain(
      'stays visible on the public leaderboard, profile, and Run pages until you remove it'
    );
    // The claim this page carried until 2026-08-16.
    expect(PRIVACY).not.toContain(
      'Disabling the profile removes those records from public queries'
    );
  });

  it('states the operator profile is off until the operator turns it on', () => {
    expect(OUTBOUND_CONTROLS.operatorProfile.defaultEnabled).toBe(false);
    expect(PRIVACY).toContain('off until you turn it on');
  });
});

describe('privacy page: what is collected', () => {
  it('does not claim to collect agent prompts, outputs, or logs', () => {
    // Nothing in the codebase writes agent content to a table. The Supabase
    // writes are projects, user_preferences, product_feedback (+attachments),
    // desktop_invites, desktop_invite_redemptions, and operator profile
    // aggregates.
    for (const claim of [
      'prompts, outputs, logs',
      'Configurations, prompts, outputs, logs',
      'Agent and task data',
    ]) {
      expect(PRIVACY).not.toContain(claim);
    }
    expect(PRIVACY).toContain('What we never store');
  });

  it('does not claim page-level or dwell tracking that the denylist forbids', () => {
    for (const property of ['$current_url', '$pathname', '$referrer', '$title']) {
      expect(ANALYTICS_PROPERTY_DENYLIST).toContain(property);
    }
    for (const claim of ['pages visited', 'time spent']) {
      expect(PRIVACY.toLowerCase()).not.toContain(claim);
    }
    expect(PRIVACY).toContain('does not measure how long you spend on a page');
    // `client.ts` sets disable_session_recording, autocapture: false, and
    // capture_pageview: false; the page may state that, and only that.
    expect(PRIVACY).toContain('no session replay');
  });

  it('describes the analytics reality of the build people download', () => {
    // The claim only holds while the release build ships without a key. If
    // this workflow ever passes NEXT_PUBLIC_POSTHOG_KEY, the downloaded app
    // starts collecting and this page has to be rewritten in the same change.
    expect(RELEASE_WORKFLOW).not.toContain('NEXT_PUBLIC_POSTHOG_KEY');
    expect(PRIVACY).toContain(
      'The macOS app you download is built without an analytics key'
    );
  });

  it('supports its claim that context-label excerpts are secret-redacted', () => {
    const summarizer = read('electron/main/pty/context-summarizer.ts');
    // Both entry points: the launch task and each submitted instruction.
    expect(
      summarizer.match(/redactContextEvidence\(/g)?.length ?? 0
    ).toBeGreaterThanOrEqual(3);
    expect(PRIVACY).toContain('with recognizable secrets replaced first');
  });
});

describe('legal surfaces: no phantom billing', () => {
  it('has no billing implementation to describe', () => {
    expect(existsSync('src/app/pricing')).toBe(false);
    expect(read('package.json')).not.toContain('stripe');
  });

  it('does not describe payments neither page can take', () => {
    for (const claim of [
      'payment processor',
      'pricing page',
      'refund policy',
      'paid subscription',
      'billed in advance',
    ]) {
      expect(PRIVACY.toLowerCase()).not.toContain(claim);
      expect(TERMS.toLowerCase()).not.toContain(claim);
    }
    expect(TERMS).toContain('Exawatt is free today');
    expect(TERMS).toContain('we collect no payment details');
  });
});

describe('terms page: describes the product that ships', () => {
  it('describes a macOS desktop app, not a cloud platform', () => {
    for (const claim of [
      'cloud-based platform',
      'web-based dashboard',
      'API access',
      'task scheduling',
      'log aggregation',
    ]) {
      expect(TERMS).not.toContain(claim);
    }
    expect(TERMS).toContain('desktop application for macOS on Apple silicon');
    expect(TERMS).toContain('run as local processes on your machine');
  });

  it('does not require an account the product does not require', () => {
    // `/download` is deliberately account-free (decision `0021`, 2026-08-14
    // amendment) and first run has no account wall.
    expect(TERMS).not.toContain('you must create an account');
    expect(TERMS).toContain('An account is optional');
  });

  it('keeps the YOLO-default safety signal the marketing floor requires', () => {
    // `docs/product/marketing.md`, "The de-apologising rule has a hard floor":
    // never trade a true safety signal for a warmer sentence.
    expect(TERMS).toContain(
      'starts agents with the harness approval prompts and sandboxing turned off'
    );
  });
});

describe('indexability of app surfaces', () => {
  const NOINDEX_SOURCES = [
    'src/app/workspace/page.tsx',
    'src/app/settings/layout.tsx',
    'src/app/fleet/spatial/layout.tsx',
    'src/app/eval/layout.tsx',
    'src/app/hud-gallery/layout.tsx',
    'src/app/usage/layout.tsx',
  ];

  it('refuses indexing on every public-but-not-marketing surface', () => {
    for (const path of NOINDEX_SOURCES) {
      expect(flatten(read(path)), `${path} must be noindex`).toContain(
        'robots: { index: false, follow: false }'
      );
    }
  });

  it('does not disallow the noindexed routes in robots.txt', () => {
    // A `Disallow` would stop the crawler fetching the page, which would stop
    // it reading the `noindex`. The two signals cancel; see `robots.ts`.
    const robots = read('src/app/robots.ts');
    for (const route of [
      "'/workspace",
      "'/settings",
      "'/fleet",
      "'/eval",
      "'/hud-gallery",
      "'/usage",
    ]) {
      expect(robots).not.toContain(route);
    }
    expect(robots).toContain("'/api/'");
    expect(robots).toContain("'/download/artifact'");
  });

  it('lets a crawler actually reach robots.txt and sitemap.xml', () => {
    // Both are matched by the proxy (no file extension exemption covers
    // `.txt`/`.xml`), so without these entries the auth gate answers a crawler
    // with a 307 to /sign-in and the whole indexability posture is inert.
    // Caught by curling a dev server, not by type-check.
    const proxy = read('src/proxy.ts');
    expect(proxy).toContain("'/robots.txt'");
    expect(proxy).toContain("'/sitemap.xml'");
  });
});
