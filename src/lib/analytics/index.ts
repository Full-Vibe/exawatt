/**
 * ENG-030 OS1 — product analytics.
 *
 * The whole surface: `initAnalytics()` at startup, `captureAnalyticsEvent()`
 * with one of the allowlisted events, `setAnalyticsOptOut()` for the runtime
 * off switch, and the ENG-047 web-to-app link (`currentWebAnalyticsId`,
 * `recordWebAlias`). Decisions `0031` and `0034` bind this directory;
 * `docs/engineering/outbound-data.md` is its published manifest.
 */

export {
  captureAnalyticsEvent,
  currentWebAnalyticsId,
  initAnalytics,
  isAnalyticsEmitting,
  readAnalyticsOptOut,
  recordWebAlias,
  setAnalyticsOptOut,
} from './client';

export {
  EXAWATT_HOSTED_ORIGIN,
  analyticsSurface,
  detectElectron,
  resolveDistributionAnalyticsDecision,
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
  type ProjectBinding,
  type ProjectOpenSource,
  type SignInFailure,
  type SignInMethod,
  type SignInOutcome,
} from './events';

export { ANALYTICS_PROPERTY_DENYLIST, scrubAnalyticsCapture } from './redact';

export { hasAccountSession, readLaunchContext } from './launch-context';
