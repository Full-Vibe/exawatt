/**
 * ENG-030 OS1 — the single client entry point for product analytics.
 *
 * Next runs this once per renderer load, before the app hydrates. It does two
 * things and nothing else: ask `initAnalytics()` whether analytics are on for
 * this build, and — if they are — emit `app_launched`.
 *
 * Everything that decides behavior lives under `src/lib/analytics/`:
 *   - `config.ts`  where events go (decision `0034`: only via exawatt.ai) and
 *                  whether they go at all (production, key, build switch,
 *                  runtime opt-out).
 *   - `events.ts`  the public, versioned, content-excluding allowlist.
 *   - `redact.ts`  the transport-level enforcement of that allowlist.
 *
 * `docs/engineering/outbound-data.md` is the published manifest.
 */

import {
  captureAnalyticsEvent,
  detectElectron,
  hasAccountSession,
  initAnalytics,
  readLaunchContext,
} from '@/lib/analytics';

async function reportLaunch(): Promise<void> {
  const decision = await initAnalytics();
  if (!decision.enabled) return;

  const isElectron = detectElectron();
  // Build info is an Electron IPC round trip and may be unavailable against an
  // older main process; the launch event is worth more than its enrichment.
  const build = isElectron
    ? await window.electron?.app?.getBuildInfo().catch(() => null)
    : null;

  captureAnalyticsEvent(
    readLaunchContext({
      isElectron,
      platform: isElectron ? window.electron?.platform : null,
      delivery: build?.delivery,
      version: build?.version,
      signedIn: hasAccountSession(
        typeof document === 'undefined' ? null : document.cookie
      ),
    })
  );
}

void reportLaunch();
