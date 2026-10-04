import { BrowserWindow, Notification, app, shell } from 'electron';
import { permissionDeclaration } from '@exawatt/core';
import { broadcastToWindows } from '../window-broadcast';
import {
  createNativeNotifier,
  type NativeNotificationRequest,
  type NotificationHandle,
} from './native-notification';
import {
  loadNotificationAuthorization,
  type NotificationAuthorization,
} from './notification-authorization';
import { createNotificationsProvider } from './notifications-provider';
import {
  createPermissionService,
  type PermissionService,
} from './permission-service';

/**
 * Where main's permission service and its one notification path are built
 * from Electron (ENG-045). Everything with logic lives in the modules beside
 * this one and is tested without Electron; this file only binds them to it.
 */

let service: PermissionService | null = null;

interface PermissionsRuntimeOptions {
  /** The app's macOS bundle identifier; null in a development launch, whose
   *  bundle is Electron's own. */
  bundleId: string | null;
  /** A test launch may stand in for the native read (`EXAWATT_TEST=1`). */
  testAuthorization: NotificationAuthorization | null;
}

export function installPermissions(
  options: PermissionsRuntimeOptions
): PermissionService {
  if (service) throw new Error('Permissions are already installed');
  const windows = () => BrowserWindow.getAllWindows();
  const built = createPermissionService({
    providers: {
      notifications: createNotificationsProvider({
        platform: process.platform,
        authorization:
          options.testAuthorization ?? loadNotificationAuthorization(),
        settingsLink: permissionDeclaration('notifications').settingsLink!,
        bundleId: options.bundleId,
        openExternal: url => shell.openExternal(url),
      }),
    },
    publish: snapshot =>
      broadcastToWindows(windows(), 'permissions:changed', snapshot),
    offerPrimer: request => {
      const open = windows().filter(
        win => !win.isDestroyed() && !win.webContents.isLoading()
      );
      broadcastToWindows(open, 'permissions:primer-requested', request);
      return open.length > 0;
    },
  });
  service = built;
  void built.refresh();
  // A grant made in System Settings shows up when the user comes back.
  app.on('browser-window-focus', () => void built.refresh());
  return built;
}

const notify = createNativeNotifier({
  // Fails closed: before permissions are installed nothing is posted.
  permissions: {
    require: (id, reason) =>
      service ? service.require(id, reason) : Promise.resolve(false),
  },
  supported: () => Notification.isSupported(),
  // The single `new Notification(` in the app. See `native-notification.ts`.
  create: options => new Notification(options) as unknown as NotificationHandle,
});

/** Posts a native notification if, and only if, the user has allowed them. */
export function postNativeNotification(
  request: NativeNotificationRequest
): Promise<NotificationHandle | null> {
  return notify(request);
}
