import { shell } from 'electron';
import path from 'path';
import { configureUnreadableStateNotice } from './persisted-state-file';
import { postNativeNotification } from './permissions/runtime';

/**
 * Saved state that stays unreadable across a retry is shown once per launch
 * as a system notification (BUG-247). Clicking it reveals the file, which is
 * where the operator fixes a permission or a stray directory. It posts through
 * the one notification path, so a Mac that never allowed notifications sees
 * the primer first instead of a bare system prompt (ENG-045).
 */
export function installUnreadableStateNotice(productName: string): void {
  configureUnreadableStateNotice(notice => {
    void postNativeNotification({
      reason: `${productName} can't read its ${notice.label}. Allow notifications and it can tell you when that happens.`,
      options: {
        title: `${productName} can't read its ${notice.label}`,
        body: `${path.basename(notice.file)}: ${notice.detail}. It stays as it is, and new changes wait until it can be read.`,
      },
      onClick: () => shell.showItemInFolder(notice.file),
    });
  });
}
