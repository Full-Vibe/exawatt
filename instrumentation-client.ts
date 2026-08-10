/**
 * ENG-030 OS1 — the single client entry point for product analytics.
 *
 * Next runs this once per renderer load, before the app hydrates. It does
 * four things and nothing else: ask `initAnalytics()` whether analytics are
 * on for this build, emit `app_launched` if they are, and — in the desktop
 * renderer — start draining the events Electron main queued behind it
 * (OS1.5b: main-process crashes and hosted-call failures, which have no other
 * path to the allowlisted emission pipeline) and start the ENG-035 operator-
 * profile sync schedule (renderer-owned; gated end to end on the opt-in
 * publishing preference).
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
import { startMainProcessAnalyticsBridge } from '@/lib/analytics-bridge/main-process-events';
import { startOperatorStatsAutoSync } from '@/lib/operator-stats/auto-sync';

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
startMainProcessAnalyticsBridge();
// ENG-035: the desktop renderer owns the public-profile sync schedule (the
// session, GitHub identity, and analytics path all live here). Returns null
// and does nothing on web surfaces; every upload gate lives in the executor.
startOperatorStatsAutoSync();
