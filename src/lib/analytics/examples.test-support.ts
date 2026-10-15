import type { AnalyticsEvent, AnalyticsEventName } from './events';

/**
 * One valid instance of every allowlisted event. Typed over the allowlist, so
 * an event added to `events.ts` without an example here does not compile,
 * and every suite that iterates these (emission shape, community silence,
 * the account stream) covers it automatically.
 */
const ANALYTICS_EVENT_EXAMPLES: {
  [K in AnalyticsEventName]: Extract<AnalyticsEvent, { name: K }>;
} = {
  app_launched: {
    name: 'app_launched',
    surface: 'desktop',
    platform: 'darwin',
    delivery: 'signed',
    appVersion: '0.1.8',
    signedIn: true,
  },
  sign_in_attempted: {
    name: 'sign_in_attempted',
    surface: 'desktop',
    method: 'google',
    outcome: 'failed',
    failure: 'cancelled',
  },
  hosted_call_failed: {
    name: 'hosted_call_failed',
    surface: 'web',
    service: 'goal_visuals',
    failure: 'rate_limited',
    statusCode: 429,
  },
  app_crashed: {
    name: 'app_crashed',
    surface: 'desktop',
    scope: 'renderer',
    reason: 'out_of_memory',
    appVersion: '0.1.8',
  },
  page_viewed: {
    name: 'page_viewed',
    surface: 'web',
    url: 'https://www.example.test/download?c=INVITE&utm_source=x',
    referrer: 'https://news.example.test/item?id=1',
  },
  download_requested: {
    name: 'download_requested',
    surface: 'web',
    platform: 'darwin',
    arch: 'arm64',
  },
  project_opened: {
    name: 'project_opened',
    surface: 'desktop',
    source: 'suggested',
    harnessHint: 'claude',
    bound: 'folder',
  },
  agent_launched: {
    name: 'agent_launched',
    surface: 'desktop',
    harness: 'codex',
    placement: 'local',
    permissionMode: 'auto',
    firstForInstall: true,
  },
  agent_directed: {
    name: 'agent_directed',
    surface: 'desktop',
    recipients: 3,
    delivered: 2,
  },
  agent_finished: {
    name: 'agent_finished',
    surface: 'desktop',
    harness: 'codex',
    placement: 'local',
  },
};

export const EVERY_ANALYTICS_EVENT: AnalyticsEvent[] = Object.values(
  ANALYTICS_EVENT_EXAMPLES
);
