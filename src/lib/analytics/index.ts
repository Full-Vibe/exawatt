/**
 * ENG-030 OS1 — product analytics.
 *
 * The whole surface: `initAnalytics()` at startup, `captureAnalyticsEvent()`
 * with one of the four allowlisted events, `setAnalyticsOptOut()` for the
 * runtime off switch. Decisions `0031` and `0034` bind this directory;
 * `docs/engineering/outbound-data.md` is its published manifest.
 */

export {
  captureAnalyticsEvent,
  initAnalytics,
  isAnalyticsEmitting,
  readAnalyticsOptOut,
  readInstallationId,
  setAnalyticsOptOut,
  writeAnalyticsOptOut,
  ANALYTICS_INSTALLATION_ID_STORAGE_KEY,
  ANALYTICS_OPT_OUT_STORAGE_KEY,
} from './client';

export {
  ANALYTICS_INGEST_PATH,
  DESKTOP_ANALYTICS_HOST,
  EXAWATT_HOSTED_ORIGIN,
  analyticsSurface,
  detectElectron,
  readAnalyticsEnv,
  resolveAnalyticsApiHost,
  resolveAnalyticsDecision,
  type AnalyticsDecision,
  type AnalyticsDisabledReason,
} from './config';

export {
  ANALYTICS_ALLOWLIST_VERSION,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_EVENT_PROPERTIES,
  ANALYTICS_EXCEPTION_PROPERTIES,
  hostedFailureForStatus,
  toAnalyticsPayload,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsSurface,
  type CrashReason,
  type CrashScope,
  type HostedFailure,
  type HostedService,
  type SignInFailure,
  type SignInMethod,
  type SignInOutcome,
} from './events';

export { ANALYTICS_PROPERTY_DENYLIST, scrubAnalyticsCapture } from './redact';

export { hasAccountSession, readLaunchContext } from './launch-context';
