/**
 * The allowlist in plain words, for `/privacy` (decision `0031`: disclosure
 * moves with the code).
 *
 * Typed over every allowlisted event, so an event added to `events.ts`
 * without a sentence here does not compile, and the Privacy page renders
 * this list rather than its own copy of it. Each line says what is recorded
 * and, where it matters, what is not.
 */

import { ACCOUNT_STREAM_EVENTS, type AnalyticsEventName } from './events';

/** Where the installation stream records it; `account` events are recorded
 *  only under a signed-in account. */
type AnalyticsDisclosureWhere = 'website' | 'app' | 'account';

interface AnalyticsEventDisclosure {
  where: AnalyticsDisclosureWhere;
  /** One sentence fragment, production voice. */
  what: string;
}

export const ANALYTICS_EVENT_DISCLOSURES: Record<
  AnalyticsEventName,
  AnalyticsEventDisclosure
> = {
  page_viewed: {
    where: 'website',
    what: 'the path of each page you view, never its query string, and the site that sent you here',
  },
  download_requested: {
    where: 'website',
    what: 'that you downloaded the app, and for which platform and chip',
  },
  app_launched: {
    where: 'app',
    what: 'that the app launched, with its version, platform and whether you are signed in',
  },
  sign_in_attempted: {
    where: 'app',
    what: 'a sign-in attempt, its method and whether it worked',
  },
  hosted_call_failed: {
    where: 'app',
    what: 'that a hosted feature failed, which one and how',
  },
  app_crashed: {
    where: 'app',
    what: 'that part of the app crashed, plus a crash report with its error message removed',
  },
  project_opened: {
    where: 'app',
    what: 'that you opened a Project and how you opened it, never its name or folder',
  },
  agent_launched: {
    where: 'app',
    what: 'that an Agent started: which engine, its permission mode, and whether it was the first on this install',
  },
  agent_directed: {
    where: 'app',
    what: 'that you sent one instruction to several Agents, and how many received it',
  },
  agent_finished: {
    where: 'account',
    what: 'that an Agent finished, and which engine it ran',
  },
};

/** `where: 'signed-in'` is the account stream's whole list, from
 *  `ACCOUNT_STREAM_EVENTS`; the others are the installation stream's. */
export function analyticsDisclosuresFor(
  where: AnalyticsDisclosureWhere | 'signed-in'
): AnalyticsEventDisclosure[] {
  if (where === 'signed-in') {
    return ACCOUNT_STREAM_EVENTS.map(name => ANALYTICS_EVENT_DISCLOSURES[name]);
  }
  return Object.values(ANALYTICS_EVENT_DISCLOSURES).filter(
    disclosure => disclosure.where === where
  );
}
