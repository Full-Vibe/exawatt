import type { PermissionRead } from '@exawatt/core';
import type { PermissionProvider } from './permission-service';
import type { NotificationAuthorization } from './notification-authorization';

/** Opens System Settings when its own pane link cannot be opened. */
export const SYSTEM_SETTINGS_URL = 'x-apple.systempreferences:';

/** The Notifications pane, scrolled to this app's entry when macOS honors it. */
export function notificationsPaneUrl(
  settingsLink: string,
  bundleId: string | null
): string {
  return bundleId
    ? `${settingsLink}?id=${encodeURIComponent(bundleId)}`
    : settingsLink;
}

interface NotificationsProviderDependencies {
  platform: NodeJS.Platform;
  /** Null when the native read is not available in this build. */
  authorization: NotificationAuthorization | null;
  settingsLink: string;
  bundleId: string | null;
  openExternal: (url: string) => Promise<void>;
}

/**
 * The `notifications` grant. macOS owns the permission; other platforms have
 * no gate, so a notification is always allowed there. On macOS the status is
 * the system's own answer, and a build that cannot ask the system reads
 * `unknown`, never `denied`.
 */
export function createNotificationsProvider(
  dependencies: NotificationsProviderDependencies
): PermissionProvider {
  const { platform, authorization } = dependencies;
  return {
    async read(): Promise<PermissionRead> {
      if (platform !== 'darwin') return { ok: true, state: 'granted' };
      if (!authorization) return { ok: false };
      const answer = await authorization.read();
      return answer === 'unavailable'
        ? { ok: false }
        : { ok: true, state: answer };
    },
    async request() {
      if (platform !== 'darwin' || !authorization) return;
      await authorization.request();
    },
    async openSettings() {
      const pane = notificationsPaneUrl(
        dependencies.settingsLink,
        dependencies.bundleId
      );
      try {
        await dependencies.openExternal(pane);
      } catch {
        // Apple does not support these links; System Settings itself opens.
        await dependencies.openExternal(SYSTEM_SETTINGS_URL);
      }
    },
  };
}
