#!/usr/bin/env node
/** Real local PTY attention → Fleet shortcut/menu → exact Session. */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openShellFromLauncher,
  waitForWorkspaceReady,
  waitForPageCondition,
  withElectronApp,
} from './lib/electron-eval.mjs';
const base = process.env.EXA_BASE ?? 'http://localhost:7183';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-fleet-attention-'));
try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_WINDOW_MODE: 'foreground',
        EXAWATT_USER_DATA: userData,
        EXAWATT_DEV_URL: `${base}/workspace`,
      },
    },
    async (app, page) => {
      await waitForWorkspaceReady(page);
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: '/tmp' })
        )
      );
      await page.locator('[data-agent-composer]').waitFor();
      await openShellFromLauncher(page);
      await page.locator('.xterm-helper-textarea').waitFor();
      await openShellFromLauncher(page);
      await waitForPageCondition(
        page,
        async () => (await window.electron.pty.list()).length === 2
      );
      const ids = await page.evaluate(async () =>
        (await window.electron.pty.list()).map(session => session.id)
      );
      assert.equal(ids.length, 2);
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-board]').waitFor();
      // Produce actual BELs through the shell's PTY while no Session is focused.
      for (const id of ids) {
        await page.evaluate(
          id => window.electron.pty.write(id, "printf '\\a'\n"),
          id
        );
        await waitForPageCondition(
          page,
          async id =>
            (await window.electron.pty.list()).find(
              session => session.id === id
            )?.attention?.unread !== false &&
            !!(await window.electron.pty.list()).find(
              session => session.id === id
            )?.attention,
          id
        );
      }

      // Native menu uses the route's published availability, then the SAME event.
      await app.evaluate(({ Menu }) => {
        const item =
          Menu.getApplicationMenu().getMenuItemById('jump-attention');
        if (!item?.enabled) throw new Error('Fleet attention menu unavailable');
        item.click();
      });
      await page.waitForFunction(
        id => document.activeElement?.getAttribute('data-open-agent') === id,
        ids[0]
      );
      assert.equal(
        await page.evaluate(
          async id =>
            (await window.electron.pty.list()).find(
              session => session.id === id
            ).attention.unread,
          ids[0]
        ),
        true
      );
      await page.keyboard.press('Meta+j');
      await page.waitForFunction(
        id => document.activeElement?.getAttribute('data-open-agent') === id,
        ids[1]
      );
      await page.keyboard.press('Enter');
      await page.waitForURL('**/workspace*');
      await app.evaluate(async ({ app, BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        // CDP can report document.hasFocus() while macOS is locked. Inspection
        // requires the same native foreground fact that main consumes.
        const focused = new Promise((resolve, reject) => {
          const onFocus = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            window.removeListener('focus', onFocus);
            reject(
              new Error(
                'Native foreground unavailable: unlock macOS and focus the eval window before verifying inspection.'
              )
            );
          }, 30_000);
          window.once('focus', onFocus);
          if (window.isFocused()) {
            window.removeListener('focus', onFocus);
            onFocus();
          }
        });
        window.show();
        window.focus();
        app.focus({ steal: true });
        await focused;
      });
      await page.waitForFunction(() => document.hasFocus());
      await waitForPageCondition(
        page,
        async id =>
          (await window.electron.pty.list()).find(session => session.id === id)
            ?.attention?.unread === false,
        ids[1]
      );
      const attention = await page.evaluate(
        async id =>
          (await window.electron.pty.list()).find(session => session.id === id)
            ?.attention,
        ids[1]
      );
      assert.ok(attention, 'reading must not resolve a request');
      console.log(
        'PASS Live Fleet menu + CmdJ share queue, selection does not read, Enter acknowledges exact Session without resolving'
      );
    },
    { maxMs: 150_000 }
  );
} finally {
  rmSync(userData, { recursive: true, force: true });
}
