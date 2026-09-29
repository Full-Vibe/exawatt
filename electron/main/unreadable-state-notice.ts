import { Notification, shell } from 'electron';
import path from 'path';
import { configureUnreadableStateNotice } from './persisted-state-file';

/**
 * Saved state that stays unreadable across a retry is shown once per launch
 * as a system notification (BUG-247). Clicking it reveals the file, which is
 * where the operator fixes a permission or a stray directory. Held here so a
 * collected Notification cannot drop its click handler.
 */
export function installUnreadableStateNotice(productName: string): void {
  const shown = new Set<Notification>();
  configureUnreadableStateNotice(notice => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({
      title: `${productName} can't read its ${notice.label}`,
      body: `${path.basename(notice.file)}: ${notice.detail}. It stays as it is, and new changes wait until it can be read.`,
    });
    shown.add(notification);
    notification.on('click', () => shell.showItemInFolder(notice.file));
    notification.on('close', () => shown.delete(notification));
    notification.show();
  });
}
