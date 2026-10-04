import type { PermissionService } from './permission-service';

/**
 * The one way Exawatt posts a native macOS notification (ENG-045).
 *
 * Electron raises macOS's notification prompt as a side effect of the first
 * `Notification.show()`, so the prompt can only be primed if nothing shows a
 * notification without asking the permission registry first. Every
 * notification path goes through `post`, which asks `require('notifications')`
 * before it builds anything; `notification-paths.test.ts` fails if a second
 * path appears.
 */

/** The part of Electron's `Notification` this module drives. */
export interface NotificationHandle {
  on(event: 'click' | 'close' | 'failed', listener: () => void): unknown;
  show(): void;
  close(): void;
}

export interface NativeNotificationOptions {
  title: string;
  body: string;
  silent?: boolean;
}

export interface NativeNotificationRequest {
  /** Why the user is being asked, one sentence in the primer's voice. */
  reason: string;
  options: NativeNotificationOptions;
  /** Checked once the grant is confirmed: a notice that went stale while the
   *  user was being asked is dropped rather than posted late. */
  isCurrent?: () => boolean;
  onClick?: () => void;
  onClose?: () => void;
}

export interface NativeNotificationDependencies {
  permissions: Pick<PermissionService, 'require'>;
  /** Whether this platform can show a native notification at all. */
  supported: () => boolean;
  /** The single construction of a native notification in the app. */
  create: (options: NativeNotificationOptions) => NotificationHandle;
}

export function createNativeNotifier(
  dependencies: NativeNotificationDependencies
) {
  // A collected Notification drops its click handler, so each one is held
  // until it closes or fails.
  const live = new Set<NotificationHandle>();

  /** The notification when it was shown; null when it was not allowed to be. */
  return async function post(
    request: NativeNotificationRequest
  ): Promise<NotificationHandle | null> {
    if (!dependencies.supported()) return null;
    const allowed = await dependencies.permissions.require(
      'notifications',
      request.reason
    );
    if (!allowed) return null;
    if (request.isCurrent && !request.isCurrent()) return null;
    const notification = dependencies.create(request.options);
    live.add(notification);
    notification.on('click', () => request.onClick?.());
    notification.on('close', () => {
      live.delete(notification);
      request.onClose?.();
    });
    notification.on('failed', () => live.delete(notification));
    notification.show();
    return notification;
  };
}
