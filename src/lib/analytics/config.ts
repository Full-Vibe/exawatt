/**
 * ENG-030 OS1.1 — where analytics go, and whether they go at all.
 *
 * The resolved distribution contract is the only authority. Community builds
 * carry `analytics: null`; official and downstream builds supply an absolute
 * PostHog-compatible ingest endpoint and public project key. Ambient legacy
 * `NEXT_PUBLIC_POSTHOG_*` variables are deliberately invisible here.
 */

import type { AnalyticsSurface } from './events';
import type { DistributionContractV1 } from '@exawatt/core/distribution';

/** Public website origin used by sitemap/robots; never an analytics fallback. */
export const EXAWATT_HOSTED_ORIGIN = 'https://www.exawatt.ai';

export interface AnalyticsRuntime {
  /** The persisted runtime opt-out. */
  optedOut: boolean;
}

export type AnalyticsDisabledReason =
  | 'no_distribution_config'
  | 'not_production'
  | 'opted_out'
  /** The SDK chunk failed to load. Emission stays off; product is unaffected. */
  | 'load_failed';

export type AnalyticsDecision =
  | { enabled: true; key: string; apiHost: string }
  | { enabled: false; reason: AnalyticsDisabledReason };

/**
 * Trailing slashes matter: PostHog appends `/i/v0/e/`, and `//i/v0/e/` misses
 * the rewrite. Normalize once here rather than at every call site.
 */
function normalizeHost(host: string): string {
  const trimmed = host.trim();
  return trimmed.endsWith('/') ? trimmed.replace(/\/+$/, '') : trimmed;
}

/**
 * The single gate. A configured endpoint is absolute on every surface, which
 * is load-bearing for packaged Electron: a relative `/ingest` would resolve
 * against its loopback renderer and make the user's machine proxy PostHog.
 */
export function resolveDistributionAnalyticsDecision(
  distribution: DistributionContractV1,
  runtime: AnalyticsRuntime,
  nodeEnv: string | undefined
): AnalyticsDecision {
  if (!distribution.analytics) {
    return { enabled: false, reason: 'no_distribution_config' };
  }
  if (nodeEnv !== 'production')
    return { enabled: false, reason: 'not_production' };
  if (runtime.optedOut) return { enabled: false, reason: 'opted_out' };
  return {
    enabled: true,
    key: distribution.analytics.projectKey,
    apiHost: normalizeHost(distribution.analytics.ingestOrigin),
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
