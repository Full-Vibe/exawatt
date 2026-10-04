import type { NotificationAuthorization } from './notification-authorization';

/**
 * A stand-in for the native notification read in a test launch
 * (`EXAWATT_TEST=1`), so an Electron eval can walk the primer without raising
 * a real system prompt on the operator's Mac. It has the addon's surface and
 * its one rule: asking about an answered grant returns the answer without
 * asking again, as macOS does.
 *
 *   EXAWATT_TEST_NOTIFICATION_AUTHORIZATION = not-determined | denied | granted
 *   EXAWATT_TEST_NOTIFICATION_ANSWER        = granted (default) | denied
 */
export function testNotificationAuthorization(
  isTest: boolean,
  env: Readonly<Record<string, string | undefined>>
): NotificationAuthorization | null {
  if (!isTest) return null;
  const initial = env.EXAWATT_TEST_NOTIFICATION_AUTHORIZATION;
  if (
    initial !== 'not-determined' &&
    initial !== 'denied' &&
    initial !== 'granted'
  ) {
    return null;
  }
  const answer =
    env.EXAWATT_TEST_NOTIFICATION_ANSWER === 'denied' ? 'denied' : 'granted';
  let status: 'not-determined' | 'denied' | 'granted' = initial;
  return {
    read: async () => status,
    request: async () => {
      if (status === 'not-determined') status = answer;
      return status === 'granted' ? 'granted' : 'denied';
    },
  };
}
