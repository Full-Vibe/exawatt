#!/usr/bin/env node
/**
 * ENG-004 V4.2 on the real desktop bridge: a ghost slot on the Fleet board
 * opens THE composer (the workspace's draft tab) in that zone's Project, not
 * the active one, through the existing pending-slot request.
 *
 * Run: EXA_BASE=http://localhost:<port> pnpm eval:electron:fleet-direct
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  openShellFromLauncher,
  waitForPageCondition,
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';

const base = process.env.EXA_BASE ?? 'http://localhost:7183';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-fleet-direct-'));
const projectA = mkdtempSync(join(tmpdir(), 'exawatt-ghost-a-'));
const projectB = mkdtempSync(join(tmpdir(), 'exawatt-ghost-b-'));

try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_WINDOW_MODE: 'inactive',
        EXAWATT_USER_DATA: userData,
        EXAWATT_DEV_URL: `${base}/workspace`,
      },
    },
    async (_app, page) => {
      await waitForWorkspaceReady(page);
      await page.evaluate(() =>
        window.electron.settings.updatePresentation({
          field: 'fleetView',
          value: 'v1',
        })
      );
      // Two Projects with a Session each; B is opened last, so it is the
      // ACTIVE Project when the operator leaves for the board.
      for (const [index, dir] of [projectA, projectB].entries()) {
        await page.evaluate(
          detail =>
            window.dispatchEvent(
              new CustomEvent('exawatt:open-project', { detail })
            ),
          dir
        );
        await page.locator('[data-agent-composer]').waitFor();
        await openShellFromLauncher(page);
        await waitForPageCondition(
          page,
          async count => (await window.electron.pty.list()).length === count,
          index + 1,
          { label: `Session ${index + 1}` }
        );
      }
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-board]').waitFor();
      // Drill into Project A by its own control, then use its ghost.
      const leafA = projectA.split('/').pop();
      await page
        .locator(`button[aria-label^="Open Project ${leafA}"]`)
        .first()
        .click();
      await page.waitForURL(/altitude=project/);
      const ghost = page.locator('button[data-board-ghost]');
      await ghost.first().waitFor({ state: 'visible' });
      assert.equal(await ghost.count(), 1, 'one ghost in the focused Project');
      const shots = process.env.EXAWATT_EVAL_SHOTS;
      if (shots) {
        await page.screenshot({ path: join(shots, 'live-ghost-project.png') });
      }
      await ghost.first().focus();
      await page.keyboard.press('Enter');

      await page.waitForURL('**/workspace*');
      await page.locator('[data-agent-composer]').waitFor();
      // The draft the ghost opened is the stage, in Project A, although B
      // was the active Project when the operator left for the board.
      await waitForPageCondition(
        page,
        leaf =>
          document
            .querySelector('[data-active-session-path]')
            ?.getAttribute('title')
            ?.endsWith(leaf) === true,
        leafA,
        { label: `the composer in ${leafA}` }
      );
      console.log(`PASS  ghost opens the composer in ${leafA}`);

      // Direct on this machine: both Projects' Agents join the working set
      // (Shift+1, Shift+2), ⌘D focuses the one field, and every recipient
      // row answers before anything is sent: a shell takes no messages, and
      // a build without the bus says so rather than pretending to send.
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-board]').waitFor();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Shift+Digit1');
      await page.keyboard.press('Shift+Digit2');
      await page.locator('[data-spatial-selection-panel="multi"]').waitFor();
      await page.keyboard.press('Meta+d');
      await page.waitForFunction(() =>
        document.activeElement?.hasAttribute('data-direct-input')
      );
      await waitForPageCondition(
        page,
        () => document.querySelectorAll('[data-direct-result]').length === 2,
        undefined,
        { label: 'a Direct result row per recipient' }
      );
      if (shots) {
        await page.keyboard.type('Report status');
        await page.screenshot({ path: join(shots, 'live-direct.png') });
      }
      console.log('PASS  Direct lists every recipient with its answer');
    }
  );
} finally {
  for (const dir of [userData, projectA, projectB]) {
    rmSync(dir, { recursive: true, force: true });
  }
}
