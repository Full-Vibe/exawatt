/**
 * ENG-030 OS1.1 — where analytics go, and whether they go at all.
 *
 * Decision `0034`: the client reaches PostHog **only** through an
 * Exawatt-owned reverse proxy, so the desktop app's sole analytics destination
 * is `exawatt.ai`. The rewrite lives in `next.config.ts`.
 *
 * The Electron wrinkle this module exists for: the packaged renderer is served
 * by a package-local Next standalone server on `http://127.0.0.1:<ephemeral>`
 * (`electron/main/main.ts`, `server.listen(0, '127.0.0.1')`). A relative
 * `/ingest` there would resolve to that loopback server, whose rewrite would
 * then make the *user's own machine* the thing that talks to PostHog —
 * exactly the outbound identity decision `0034` exists to prevent. So in
 * Electron the ingest host is the absolute hosted origin; on the web it stays
 * relative and same-origin.
 *
 * Decision `0031`'s configurable sink survives: `NEXT_PUBLIC_POSTHOG_HOST`
 * overrides the destination for a downstream distributor or self-hoster, and
 * `NEXT_PUBLIC_ANALYTICS_DISABLED` suppresses initialization and emission
 * entirely, without patching product code.
 */

import type { AnalyticsSurface } from './events';
import type { DistributionContractV1 } from '@exawatt/core/distribution';

/** The hosted origin that owns the `/ingest` rewrite (decision `0034`). */
export const EXAWATT_HOSTED_ORIGIN = 'https://www.exawatt.ai';

/** Same-origin path the Next rewrite proxies to PostHog. */
export const ANALYTICS_INGEST_PATH = '/ingest';

/** What the desktop renderer must use: absolute, so it leaves via exawatt.ai. */
export const DESKTOP_ANALYTICS_HOST = `${EXAWATT_HOSTED_ORIGIN}${ANALYTICS_INGEST_PATH}`;

export interface AnalyticsEnv {
  /** `NEXT_PUBLIC_POSTHOG_KEY` — absent means analytics stay off. */
  key?: string;
  /** `NEXT_PUBLIC_POSTHOG_HOST` — distributor override for the sink. */
  host?: string;
  /** `NEXT_PUBLIC_ANALYTICS_DISABLED` — build switch. */
  disabled?: string;
  /** `process.env.NODE_ENV`. */
  nodeEnv?: string;
}

export interface AnalyticsRuntime {
  /** `window.electron?.isElectron` — resolved by the caller. */
  isElectron: boolean;
  /** The persisted runtime opt-out. */
  optedOut: boolean;
}

export type AnalyticsDisabledReason =
  | 'no_distribution_config'
  | 'not_production'
  | 'disabled_by_build'
  | 'opted_out'
  | 'missing_key'
  /** The SDK chunk failed to load. Emission stays off; product is unaffected. */
  | 'load_failed';

export type AnalyticsDecision =
  | { enabled: true; key: string; apiHost: string }
  | { enabled: false; reason: AnalyticsDisabledReason };

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

/**
 * Trailing slashes matter: PostHog appends `/i/v0/e/`, and `//i/v0/e/` misses
 * the rewrite. Normalize once here rather than at every call site.
 */
function normalizeHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.endsWith('/') ? trimmed.replace(/\/+$/, '') : trimmed;
}

/**
 * Web gets the relative same-origin path; Electron gets the absolute hosted
 * origin; an explicit override beats both.
 */
export function resolveAnalyticsApiHost({
  isElectron,
  hostOverride,
}: {
  isElectron: boolean;
  hostOverride?: string;
}): string {
  const override = hostOverride?.trim();
  if (override) return normalizeHost(override);
  return isElectron ? DESKTOP_ANALYTICS_HOST : ANALYTICS_INGEST_PATH;
}

/**
 * The single gate. Production-only by construction, and every "off" path is a
 * refusal to initialize — decision `0031` requires the switches to suppress
 * emission, not merely dashboard ingestion.
 */
export function resolveAnalyticsDecision(
  env: AnalyticsEnv,
  runtime: AnalyticsRuntime
): AnalyticsDecision {
  if (env.nodeEnv !== 'production')
    return { enabled: false, reason: 'not_production' };
  if (truthy(env.disabled))
    return { enabled: false, reason: 'disabled_by_build' };
  if (runtime.optedOut) return { enabled: false, reason: 'opted_out' };
  const key = env.key?.trim();
  if (!key) return { enabled: false, reason: 'missing_key' };
  return {
    enabled: true,
    key,
    apiHost: resolveAnalyticsApiHost({
      isElectron: runtime.isElectron,
      hostOverride: env.host,
    }),
  };
}

/** Distribution-aware seam; existing callers migrate in WP2b-2. */
export function resolveDistributionAnalyticsDecision(
  distribution: DistributionContractV1,
  runtime: AnalyticsRuntime,
  nodeEnv: string | undefined
): AnalyticsDecision {
  if (!distribution.analytics) {
    return { enabled: false, reason: 'no_distribution_config' };
  }
  return resolveAnalyticsDecision(
    {
      key: distribution.analytics.projectKey,
      host: distribution.analytics.ingestOrigin,
      nodeEnv,
    },
    runtime
  );
}

/**
 * `NEXT_PUBLIC_*` values are inlined at build time, so they must be referenced
 * as literal member expressions — a computed lookup reads as `undefined` in the
 * bundle. Keeping the literals in one place makes the whole configurable
 * surface greppable.
 */
export function readAnalyticsEnv(): AnalyticsEnv {
  return {
    key: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    disabled: process.env.NEXT_PUBLIC_ANALYTICS_DISABLED,
    nodeEnv: process.env.NODE_ENV,
  };
}

/** Electron detection uses the same idiom as `use-electron-auth.ts`. */
export function detectElectron(): boolean {
  return typeof window !== 'undefined' && window.electron?.isElectron === true;
}

/**
 * Which shell this code is running in. `surface` is required on every event,
 * but it is an ambient fact rather than a per-call-site decision — computing
 * it here keeps call sites from each inventing their own detection and
 * disagreeing. Call from an effect or an event handler, never during render:
 * `window.electron` is absent in the server pass and the hydration pass.
 */
export function analyticsSurface(): AnalyticsSurface {
  return detectElectron() ? 'desktop' : 'web';
}
