/**
 * Posts one usage alert as a native notification (ENG-008 E17). A click
 * brings the window forward and opens Usage through the same Go-menu command
 * the menu bar uses, so the renderer's navigation manifest owns the route.
 */
import { BrowserWindow } from 'electron';
import type { UsageAlert } from '@exawatt/core';
import { postNativeNotification } from '../permissions/runtime';
import { pushToRenderer } from '../window-broadcast';

export function postUsageAlert(alert: UsageAlert, isCurrent: () => boolean): void {
  void postNativeNotification({
    reason: 'A plan limit is on course to run out before it resets.',
    options: { title: alert.title, body: alert.body, silent: false },
    isCurrent,
    onClick: () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      pushToRenderer(win.webContents, 'menu:command', 'go-consumption');
    },
  });
}
