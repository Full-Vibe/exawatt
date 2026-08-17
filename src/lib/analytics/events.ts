/**
 * ENG-030 OS1.2 — the public, versioned analytics event allowlist.
 *
 * Decisions `0031` and `0034` bind this module: it is the ONLY way a product
 * analytics event may be emitted, and it may never carry content. Prompts,
 * responses, terminal output, source code, repository or Project names, paths,
 * filenames, diffs, task text, credentials, environment values, and raw source
 * or Session identifiers are excluded **structurally**, not by convention:
 * every declared property is a closed enum, a boolean, a bounded integer, or a
 * shape-validated version string, so a caller has nowhere to put free text.
 *
 * Adding an event or a property here is a deliberate, reviewable change to a
 * public contract (decision `0031`: "installing PostHog does not authorize
 * arbitrary capture"). Bump `ANALYTICS_ALLOWLIST_VERSION` when the shape of an
 * existing event changes so a warehouse reader can tell the versions apart.
 */

/** Bumped whenever an event's declared properties change shape. */
export const ANALYTICS_ALLOWLIST_VERSION = 1;

/** The four events decision `0031` / roadmap OS1.2 authorize. No others. */
export const ANALYTICS_EVENT_NAMES = [
  'app_launched',
  'sign_in_attempted',
  'hosted_call_failed',
  'app_crashed',
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

/**
 * PostHog's own exception event. `capture_exceptions` produces it directly
 * inside the SDK, so it never passes through `toAnalyticsPayload`; the
 * redaction pass in `redact.ts` strips its message text before send. It is
 * listed here because the transport-level filter must let it through.
 */
export const POSTHOG_EXCEPTION_EVENT = '$exception';

/**
 * The crash payload properties allowed to leave, and nothing else.
 *
 * The four events above are allowlisted, so `$exception` should be too. It was
 * originally filtered by denylist instead, which meant a future posthog-js
 * release could add a content-bearing `$exception_*` property and it would ship
 * by default — the class of content decision `0031` forbids. Nothing leaks
 * today (`posthog-js@1.413.2` emits only these two from `ErrorProperties`, and
 * `$exception_steps` — free-text breadcrumbs — is gated behind
 * `error_tracking.exception_steps`, which this project never enables), so this
 * is defence in depth, not a live incident.
 *
 * Each member is safe by construction:
 *  - `$exception_list` — an array of exceptions, rebuilt field by field in
 *    `redact.ts`: the message is replaced, frame locations lose anything
 *    machine-identifying, and every other field is dropped.
 *  - `$exception_level` — a closed severity enum (`EXCEPTION_LEVELS`) coerced
 *    to a member before send, so it can never carry a string of its own.
 *
 * Adding a member here is the same kind of deliberate public-contract change
 * as adding an event property, and must be reflected in
 * `docs/engineering/outbound-data.md`.
 */
export const ANALYTICS_EXCEPTION_PROPERTIES = [
  '$exception_list',
  '$exception_level',
] as const;

export type AnalyticsExceptionProperty =
  (typeof ANALYTICS_EXCEPTION_PROPERTIES)[number];

/** `@posthog/core`'s `SeverityLevel`. `$exception_level` is one of these. */
export const EXCEPTION_LEVELS = [
  'fatal',
  'error',
  'warning',
  'log',
  'info',
  'debug',
] as const;

/* ------------------------------------------------------------------ *
 * Closed enums. Every property a caller can set is one of these.
 * ------------------------------------------------------------------ */

export const SURFACES = ['desktop', 'web'] as const;
export type AnalyticsSurface = (typeof SURFACES)[number];

export const PLATFORMS = [
  'darwin',
  'win32',
  'linux',
  'web',
  'unknown',
] as const;
export type AnalyticsPlatform = (typeof PLATFORMS)[number];

/** Mirrors `ExawattBuildInfo['delivery']`, plus the hosted renderer. */
export const BUILD_DELIVERIES = [
  'signed',
  'dogfood',
  'hosted',
  'unknown',
] as const;
export type AnalyticsBuildDelivery = (typeof BUILD_DELIVERIES)[number];

export const SIGN_IN_METHODS = [
  'google',
  'github',
  'password',
  'unknown',
] as const;
export type SignInMethod = (typeof SIGN_IN_METHODS)[number];

export const SIGN_IN_OUTCOMES = [
  'started',
  'succeeded',
  'failed',
  'unknown',
] as const;
export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

export const SIGN_IN_FAILURES = [
  'cancelled',
  'invalid_credentials',
  'not_configured',
  'callback_exchange',
  'network',
  'provider_error',
  'unknown',
] as const;
export type SignInFailure = (typeof SIGN_IN_FAILURES)[number];

/** Exawatt-hosted or Supabase-backed calls whose failure is worth counting. */
export const HOSTED_SERVICES = [
  'context_labels',
  'conversation_summary',
  'goal_visuals',
  'project_registry',
  'product_feedback',
  'operator_stats',
  'update_feed',
  'auth',
  'unknown',
] as const;
export type HostedService = (typeof HOSTED_SERVICES)[number];

export const HOSTED_FAILURES = [
  'network',
  'timeout',
  'unauthorized',
  'rate_limited',
  'quota_exhausted',
  'server_error',
  'invalid_response',
  'unknown',
] as const;
export type HostedFailure = (typeof HOSTED_FAILURES)[number];

/**
 * Map an HTTP status onto the closed failure enum. Shared so every hosted
 * caller classifies the same status the same way — otherwise the counts are
 * not comparable across services, which is the only thing they are for. A
 * wrong bucket is worse than a coarse one, so where this codebase's routes and
 * the general HTTP meaning disagree, the general meaning wins: these counts
 * cover Supabase and vendor responses too, not only `src/app/api`.
 *
 * Each branch, against what the routes actually return:
 *  - `401` every route's missing/invalid bearer token; `403` is Supabase RLS.
 *  - `429` is a throttle. Our three hosted routes send it with
 *    `Retry-After: 3600` when `claim_*_quota` returns false, and their own copy
 *    deliberately refuses to attribute that to the caller's quota — one boolean
 *    covers the caller's quota, the global ceiling, and the kill switch. So it
 *    is counted as throttling, which is also what a Supabase or vendor 429
 *    means. `quota_exhausted` is reserved for a status that says only that.
 *  - `402` is that status: allowance spent. No route emits it yet.
 *  - `408`/`504` are gateway timeouts on the model-backed routes.
 *  - `>= 500` is our `500`/`502`/`503` — the service or its upstream failed.
 *  - Any other `4xx` is a request the service refused rather than a broken one:
 *    `400` unparseable body, `404` missing object, `409` operator-stats
 *    demanding a linked GitHub identity, `413` over the byte cap, `422`
 *    fal.ai's safety rejection. This is the coarse bucket; `409` used to be
 *    misfiled as `quota_exhausted`, which is a conflict, not a quota.
 */
export function hostedFailureForStatus(status: number): HostedFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status === 402) return 'quota_exhausted';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'server_error';
  if (status >= 400) return 'invalid_response';
  return 'unknown';
}

export const CRASH_SCOPES = [
  'renderer',
  'main',
  'gpu',
  'utility',
  'agent_harness',
] as const;
export type CrashScope = (typeof CRASH_SCOPES)[number];

export const CRASH_REASONS = [
  'crashed',
  'killed',
  'out_of_memory',
  'launch_failed',
  'unresponsive',
  'unknown',
] as const;
export type CrashReason = (typeof CRASH_REASONS)[number];

/* ------------------------------------------------------------------ *
 * The typed event union. Callers construct one of these; there is no
 * escape hatch for arbitrary properties.
 * ------------------------------------------------------------------ */

export interface AppLaunchedEvent {
  name: 'app_launched';
  surface: AnalyticsSurface;
  platform: AnalyticsPlatform;
  delivery: AnalyticsBuildDelivery;
  /** `app.getVersion()`; shape-validated, dropped when it is not a version. */
  appVersion?: string | null;
  /** Whether an Exawatt account session exists. Never who it belongs to. */
  signedIn: boolean;
}

export interface SignInAttemptedEvent {
  name: 'sign_in_attempted';
  surface: AnalyticsSurface;
  method: SignInMethod;
  outcome: SignInOutcome;
  /** Only meaningful when `outcome` is `failed`; a class, never a message. */
  failure?: SignInFailure | null;
}

export interface HostedCallFailedEvent {
  name: 'hosted_call_failed';
  surface: AnalyticsSurface;
  service: HostedService;
  failure: HostedFailure;
  /** HTTP status when there was one. Bounded to 100–599; never a body. */
  statusCode?: number | null;
}

export interface AppCrashedEvent {
  name: 'app_crashed';
  surface: AnalyticsSurface;
  scope: CrashScope;
  reason: CrashReason;
  appVersion?: string | null;
}

export type AnalyticsEvent =
  | AppLaunchedEvent
  | SignInAttemptedEvent
  | HostedCallFailedEvent
  | AppCrashedEvent;

/** Property values that may leave the machine: no strings beyond enums. */
export type AnalyticsPropertyValue = string | number | boolean | null;

export interface AnalyticsPayload {
  name: AnalyticsEventName;
  properties: Record<string, AnalyticsPropertyValue>;
}

/**
 * The declared property key set per event. `redact.ts` enforces it at the
 * transport boundary, and `docs/engineering/outbound-data.md` documents it;
 * a test asserts all three agree.
 */
export const ANALYTICS_EVENT_PROPERTIES: Record<
  AnalyticsEventName,
  readonly string[]
> = {
  app_launched: [
    'allowlist_version',
    'surface',
    'platform',
    'delivery',
    'app_version',
    'signed_in',
  ],
  sign_in_attempted: [
    'allowlist_version',
    'surface',
    'method',
    'outcome',
    'failure',
  ],
  hosted_call_failed: [
    'allowlist_version',
    'surface',
    'service',
    'failure',
    'status_code',
  ],
  app_crashed: [
    'allowlist_version',
    'surface',
    'scope',
    'reason',
    'app_version',
  ],
};

export function isAnalyticsEventName(
  name: unknown
): name is AnalyticsEventName {
  return (ANALYTICS_EVENT_NAMES as readonly unknown[]).includes(name);
}

function member<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T
): T {
  return (allowed as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

function optionalMember<T extends string>(
  allowed: readonly T[],
  value: unknown
): T | null {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : null;
}

/** `0.1.8`, `1.2.3-beta.1` — anything else is not a version and is dropped. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function sanitizeAppVersion(value: unknown): string | null {
  return typeof value === 'string' && VERSION_PATTERN.test(value.trim())
    ? value.trim()
    : null;
}

function sanitizeStatusCode(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

/**
 * Turns a typed event into the exact wire payload. Unknown event names return
 * `null` (nothing is emitted); unknown enum members degrade to the enum's
 * `unknown` member or are dropped. Analytics never throws into product code.
 */
export function toAnalyticsPayload(
  event: AnalyticsEvent
): AnalyticsPayload | null {
  if (!event || !isAnalyticsEventName(event.name)) return null;
  const surface = member(SURFACES, event.surface, 'web');
  const base = {
    allowlist_version: ANALYTICS_ALLOWLIST_VERSION,
    surface,
  } satisfies Record<string, AnalyticsPropertyValue>;

  switch (event.name) {
    case 'app_launched':
      return {
        name: 'app_launched',
        properties: {
          ...base,
          platform: member(PLATFORMS, event.platform, 'unknown'),
          delivery: member(BUILD_DELIVERIES, event.delivery, 'unknown'),
          app_version: sanitizeAppVersion(event.appVersion),
          signed_in: event.signedIn === true,
        },
      };
    case 'sign_in_attempted':
      return {
        name: 'sign_in_attempted',
        properties: {
          ...base,
          method: member(SIGN_IN_METHODS, event.method, 'unknown'),
          outcome: member(SIGN_IN_OUTCOMES, event.outcome, 'unknown'),
          failure: optionalMember(SIGN_IN_FAILURES, event.failure),
        },
      };
    case 'hosted_call_failed':
      return {
        name: 'hosted_call_failed',
        properties: {
          ...base,
          service: member(HOSTED_SERVICES, event.service, 'unknown'),
          failure: member(HOSTED_FAILURES, event.failure, 'unknown'),
          status_code: sanitizeStatusCode(event.statusCode),
        },
      };
    case 'app_crashed':
      return {
        name: 'app_crashed',
        properties: {
          ...base,
          scope: member(CRASH_SCOPES, event.scope, 'renderer'),
          reason: member(CRASH_REASONS, event.reason, 'unknown'),
          app_version: sanitizeAppVersion(event.appVersion),
        },
      };
  }
}
