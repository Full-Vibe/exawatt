import path from 'path';

/**
 * The native read of macOS's notification authorization (ENG-045).
 *
 * Electron raises the notification prompt as a side effect of the first
 * `Notification.show()` and exposes neither the status nor a way to ask on
 * its own, so the primer could not come first and Settings could not show the
 * answer. `electron/native/notification-authorization.mm` is the whole native
 * surface: two promise-returning calls over `UNUserNotificationCenter`.
 *
 * `unavailable` means the system could not answer, for example a build whose
 * identity usernoted cannot validate. It is never a verdict.
 */
export interface NotificationAuthorization {
  read(): Promise<'not-determined' | 'denied' | 'granted' | 'unavailable'>;
  request(): Promise<'granted' | 'denied' | 'unavailable'>;
}

/** The compiled addon sits beside the compiled main, in `dist-electron/native`
 *  (`scripts/build-electron-native.mjs`). */
export const NOTIFICATION_AUTHORIZATION_BINARY = path.join(
  __dirname,
  '..',
  '..',
  'native',
  'notification-authorization.node'
);

/**
 * Loads the addon, or answers null: another platform, a build that skipped
 * the native step, or a library macOS refused to load. Null makes the status
 * `unknown` and nothing worse.
 */
export function loadNotificationAuthorization(
  platform: NodeJS.Platform = process.platform,
  load: (file: string) => unknown = file =>
    // A native addon is loaded by path, at runtime, and may be absent.
    require(file)
): NotificationAuthorization | null {
  if (platform !== 'darwin') return null;
  try {
    const addon = load(
      NOTIFICATION_AUTHORIZATION_BINARY
    ) as Partial<NotificationAuthorization>;
    if (
      typeof addon?.read !== 'function' ||
      typeof addon?.request !== 'function'
    )
      return null;
    return addon as NotificationAuthorization;
  } catch {
    return null;
  }
}
