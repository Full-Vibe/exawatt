/**
 * ENG-030 OS1.5b — renderer drain for main-process analytics events.
 *
 * Electron main observes facts worth counting (its hosted-call failures, and
 * crashes of any process) but has no analytics path of its own — decision
 * `0034` gives the desktop app exactly one analytics destination, the
 * renderer's proxied `/ingest`. Main queues narrow typed events
 * (`electron/main/analytics-bridge.ts`); this module drains that queue and
 * feeds each event through the same allowlisted `captureAnalyticsEvent` every
 * renderer event takes, so the allowlist, redaction, and opt-out apply
 * identically. When analytics are off, `captureAnalyticsEvent` no-ops — the
 * queue is still drained, and the events are dropped. Main never learns or
 * cares which.
 *
 * Every payload is re-validated here before it can reach the emission path:
 * the preload boundary is typed, but the renderer treats what crosses it as
 * untrusted input all the same. Unknown names, unknown services, and unknown
 * crash scopes are dropped; HTTP statuses are classified with the one
 * canonical `hostedFailureForStatus` mapping so main never re-implements it.
 */

import {
  analyticsSurface,
  captureAnalyticsEvent,
  hostedFailureForStatus,
  initAnalytics,
  type AnalyticsEvent,
} from '@/lib/analytics';
import {
  CRASH_REASONS,
  CRASH_SCOPES,
  HOSTED_SERVICES,
  type CrashReason,
  type CrashScope,
  type HostedService,
} from '@/lib/analytics/events';

function member<T extends string>(
  allowed: readonly T[],
  value: unknown
): value is T {
  return (allowed as readonly unknown[]).includes(value);
}

/** Typed rejection at the boundary: anything unrecognized becomes `null`. */
export function normalizeMainProcessAnalyticsEvent(
  raw: unknown
): AnalyticsEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Record<string, unknown>;

  if (candidate.name === 'app_crashed') {
    if (!member<CrashScope>(CRASH_SCOPES, candidate.scope)) return null;
    const reason = member<CrashReason>(CRASH_REASONS, candidate.reason)
      ? candidate.reason
      : 'unknown';
    return {
      name: 'app_crashed',
      surface: analyticsSurface(),
      scope: candidate.scope,
      reason,
      appVersion:
        typeof candidate.appVersion === 'string' ? candidate.appVersion : null,
    };
  }

  if (candidate.name === 'hosted_call_failed') {
    if (!member<HostedService>(HOSTED_SERVICES, candidate.service)) return null;
    const statusCode =
      typeof candidate.statusCode === 'number' &&
      Number.isInteger(candidate.statusCode)
        ? candidate.statusCode
        : null;
    // A status is authoritative; main only asserts the classes no status can
    // express (transport-level network/timeout).
    const failure =
      statusCode !== null
        ? hostedFailureForStatus(statusCode)
        : candidate.failure === 'network' || candidate.failure === 'timeout'
          ? candidate.failure
          : 'unknown';
    return {
      name: 'hosted_call_failed',
      surface: analyticsSurface(),
      service: candidate.service,
      failure,
      statusCode,
    };
  }

  return null;
}

interface MainAnalyticsBridge {
  drainMainProcessEvents: () => Promise<unknown[]>;
  onMainProcessEvents?: (handler: () => void) => () => void;
}

/**
 * One atomic drain. Always drains — an opted-out renderer must still empty
 * main's queue (`captureAnalyticsEvent` then drops every event); a renderer
 * that skipped the drain would leave the queue to overflow for nothing.
 */
export async function drainMainProcessAnalyticsEvents(
  bridge: MainAnalyticsBridge,
  capture: (event: AnalyticsEvent) => void = captureAnalyticsEvent
): Promise<void> {
  try {
    const events = await bridge.drainMainProcessEvents();
    if (!Array.isArray(events)) return;
    for (const raw of events) {
      const event = normalizeMainProcessAnalyticsEvent(raw);
      if (event) capture(event);
    }
  } catch {
    // Analytics never propagate a failure into product behavior.
  }
}

/**
 * Start the bridge for this renderer: drain whatever queued before the page
 * existed, then drain again on every nudge from main. Web surfaces have no
 * bridge and return immediately.
 */
export function startMainProcessAnalyticsBridge(): void {
  if (typeof window === 'undefined') return;
  const bridge = window.electron?.analytics;
  if (!bridge) return;
  let draining = false;
  let queued = false;
  const drain = async () => {
    if (draining) {
      queued = true;
      return;
    }
    draining = true;
    try {
      // Idempotent; guarantees the enable/opt-out decision exists before the
      // first event is offered to the emission path.
      await initAnalytics();
      await drainMainProcessAnalyticsEvents(bridge);
    } finally {
      draining = false;
      if (queued) {
        queued = false;
        void drain();
      }
    }
  };
  bridge.onMainProcessEvents?.(() => void drain());
  void drain();
}
