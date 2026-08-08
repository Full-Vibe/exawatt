/**
 * ENG-030 OS1.5b — the main→renderer analytics bridge.
 *
 * Electron main cannot emit a product analytics event itself: `posthog-js`
 * lives in the renderer, and decision `0034` means main has NO analytics
 * destination of its own, ever — the desktop app's sole analytics destination
 * is the renderer's proxied `/ingest`. So main-process facts worth counting
 * (hosted-call failures, process crashes) are queued here as narrow typed
 * events, and the renderer drains the queue through the same allowlisted
 * `captureAnalyticsEvent` path every other event takes. An opted-out renderer
 * drains and drops; nothing in this module talks to the network.
 *
 * Deliberately NOT persisted: a crash at quit that no renderer ever drains is
 * an accepted loss. Writing analytics to disk from a crash path would trade a
 * lost counter for new risk in exactly the code that must never add risk.
 *
 * This module imports no Electron API so the enforcement points
 * (`pty/context-summarizer.ts`, `pty/conversation-catalog.ts`) and their unit
 * tests can use it directly; `analytics-ipc.ts` wires the notifier and the
 * drain channel to real windows.
 *
 * The literal vocabularies below MIRROR the closed enums in
 * `src/lib/analytics/events.ts` (which Electron main cannot import — the two
 * trees compile separately). They are wire constants, not a second policy:
 * the renderer re-validates every drained payload against the canonical
 * allowlist, maps HTTP statuses with the canonical `hostedFailureForStatus`,
 * and drops anything it does not recognize — drift here can narrow what is
 * counted, never widen what leaves the machine.
 */

export const MAIN_ANALYTICS_QUEUE_CAP = 16;

export const MAIN_CRASH_SCOPES = [
  'renderer',
  'main',
  'gpu',
  'utility',
  'agent_harness',
] as const;
export type MainCrashScope = (typeof MAIN_CRASH_SCOPES)[number];

export const MAIN_CRASH_REASONS = [
  'crashed',
  'killed',
  'out_of_memory',
  'launch_failed',
  'unresponsive',
  'unknown',
] as const;
export type MainCrashReason = (typeof MAIN_CRASH_REASONS)[number];

/** Only the hosted services main actually calls; the renderer covers the rest. */
export const MAIN_HOSTED_SERVICES = [
  'context_labels',
  'conversation_summary',
  'goal_visuals',
] as const;
export type MainHostedService = (typeof MAIN_HOSTED_SERVICES)[number];

/**
 * Failure classes main may assert directly — only the ones no HTTP status can
 * express. When a status exists, main forwards the raw code and the renderer
 * applies the one canonical status→failure mapping.
 */
export const MAIN_TRANSPORT_FAILURES = ['network', 'timeout'] as const;
export type MainTransportFailure = (typeof MAIN_TRANSPORT_FAILURES)[number];

export type MainProcessAnalyticsEvent =
  | {
      name: 'app_crashed';
      scope: MainCrashScope;
      reason: MainCrashReason;
      appVersion: string | null;
    }
  | {
      name: 'hosted_call_failed';
      service: MainHostedService;
      /** Set only when there was no HTTP status to classify. */
      failure: MainTransportFailure | null;
      statusCode: number | null;
    };

function member<T extends string>(
  allowed: readonly T[],
  value: unknown
): value is T {
  return (allowed as readonly unknown[]).includes(value);
}

/** Typed rejection at the queue boundary: garbage never enters the queue. */
export function isMainProcessAnalyticsEvent(
  value: unknown
): value is MainProcessAnalyticsEvent {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.name === 'app_crashed') {
    return (
      member(MAIN_CRASH_SCOPES, candidate.scope) &&
      member(MAIN_CRASH_REASONS, candidate.reason) &&
      (candidate.appVersion === null || typeof candidate.appVersion === 'string')
    );
  }
  if (candidate.name === 'hosted_call_failed') {
    return (
      member(MAIN_HOSTED_SERVICES, candidate.service) &&
      (candidate.failure === null ||
        member(MAIN_TRANSPORT_FAILURES, candidate.failure)) &&
      (candidate.statusCode === null ||
        (typeof candidate.statusCode === 'number' &&
          Number.isInteger(candidate.statusCode)))
    );
  }
  return false;
}

let queue: MainProcessAnalyticsEvent[] = [];
let notify: (() => void) | null = null;

/**
 * Queue one event for the next renderer drain. Bounded drop-oldest: a renderer
 * outage must never turn this into an unbounded buffer, and the newest events
 * are the ones a returning renderer can still act on. Never throws.
 */
export function queueMainAnalyticsEvent(event: MainProcessAnalyticsEvent): void {
  if (!isMainProcessAnalyticsEvent(event)) return;
  // Rebuild the exact declared shape so a caller cannot smuggle extra fields
  // across the IPC boundary alongside a valid event.
  const clean: MainProcessAnalyticsEvent =
    event.name === 'app_crashed'
      ? {
          name: 'app_crashed',
          scope: event.scope,
          reason: event.reason,
          appVersion: event.appVersion,
        }
      : {
          name: 'hosted_call_failed',
          service: event.service,
          failure: event.failure,
          statusCode: event.statusCode,
        };
  queue.push(clean);
  if (queue.length > MAIN_ANALYTICS_QUEUE_CAP) {
    queue.splice(0, queue.length - MAIN_ANALYTICS_QUEUE_CAP);
  }
  try {
    notify?.();
  } catch {
    // Analytics never propagate a failure into main-process behavior.
  }
}

/** Return everything queued and clear the queue (the renderer's drain). */
export function drainMainAnalyticsEvents(): MainProcessAnalyticsEvent[] {
  const drained = queue;
  queue = [];
  return drained;
}

/** `analytics-ipc.ts` points this at the renderer nudge channel. */
export function setMainAnalyticsNotifier(fn: (() => void) | null): void {
  notify = fn;
}

/* ------------------------------------------------------------------ *
 * Hosted-call failure helpers — the two shapes a main-process hosted
 * call can fail in. Callers guard for genuine attempt-and-fail: a
 * feature the operator switched off never reaches these.
 * ------------------------------------------------------------------ */

export function recordHostedCallHttpFailure(
  service: MainHostedService,
  statusCode: number
): void {
  queueMainAnalyticsEvent({
    name: 'hosted_call_failed',
    service,
    failure: null,
    statusCode: Number.isInteger(statusCode) ? statusCode : null,
  });
}

/** `AbortSignal.timeout` rejects with `TimeoutError`; anything else that kept
 *  the request from producing a status is a network failure. */
export function transportFailureFor(error: unknown): MainTransportFailure {
  const name =
    error && typeof error === 'object'
      ? (error as { name?: unknown }).name
      : null;
  return name === 'TimeoutError' || name === 'AbortError'
    ? 'timeout'
    : 'network';
}

export function recordHostedCallTransportFailure(
  service: MainHostedService,
  error: unknown
): void {
  queueMainAnalyticsEvent({
    name: 'hosted_call_failed',
    service,
    failure: transportFailureFor(error),
    statusCode: null,
  });
}

/* ------------------------------------------------------------------ *
 * Crash mappers — pure, so `main.ts` stays one line per listener and
 * the mapping is testable without Electron.
 * ------------------------------------------------------------------ */

/** Electron's `RenderProcessGoneDetails['reason']` / child-process reasons. */
function crashReasonFor(reason: string): MainCrashReason | null {
  switch (reason) {
    case 'clean-exit':
      return null; // an orderly exit is not a crash
    case 'crashed':
    case 'integrity-failure':
      return 'crashed';
    case 'oom':
      return 'out_of_memory';
    case 'killed':
      return 'killed';
    case 'launch-failed':
      return 'launch_failed';
    default:
      return 'unknown';
  }
}

export function appCrashFromRenderProcessGone(
  reason: string,
  appVersion: string | null
): MainProcessAnalyticsEvent | null {
  const mapped = crashReasonFor(reason);
  if (!mapped) return null;
  return { name: 'app_crashed', scope: 'renderer', reason: mapped, appVersion };
}

export function appCrashFromChildProcessGone(
  processType: string,
  reason: string,
  appVersion: string | null
): MainProcessAnalyticsEvent | null {
  const mapped = crashReasonFor(reason);
  if (!mapped) return null;
  return {
    name: 'app_crashed',
    scope: processType === 'GPU' ? 'gpu' : 'utility',
    reason: mapped,
    appVersion,
  };
}

export function appCrashFromMainException(
  appVersion: string | null
): MainProcessAnalyticsEvent {
  return { name: 'app_crashed', scope: 'main', reason: 'crashed', appVersion };
}

/** Test seam: forget queue and notifier between suites. */
export function __resetMainAnalyticsForTests(): void {
  queue = [];
  notify = null;
}
