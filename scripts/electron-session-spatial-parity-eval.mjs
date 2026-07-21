#!/usr/bin/env node

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-session-spatial-parity-'));
const userData = join(root, 'userData');
const projectDir = join(root, 'project');
const screenshots = resolve(
  process.env.SESSION_PARITY_SCREENSHOT_DIR ??
    join(tmpdir(), 'exawatt-session-spatial-parity')
);
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(screenshots, { recursive: true });

async function sessions(page) {
  return await page.evaluate(
    async () => (await window.electron?.pty?.list()) ?? []
  );
}

async function waitForSessionCount(page, count) {
  await page.waitForFunction(
    async expected =>
      ((await window.electron?.pty?.list()) ?? []).length === expected,
    count
  );
  return await sessions(page);
}

async function waitForWorkspaceTabCount(page, count) {
  await page.waitForFunction(async expected => {
    const layout = await window.electron?.workspace?.load();
    return (
      layout?.projects?.reduce(
        (total, project) => total + project.tabs.length,
        0
      ) === expected
    );
  }, count);
}

try {
  await withElectronApp(
    {
      executablePath: executable,
      env: {
        ...process.env,
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_RENDERER_LOGS: '1',
      },
    },
    async (_app, page) => {
      page.setDefaultTimeout(25_000);
      const errors = [];
      page.on('pageerror', error =>
        errors.push(String(error.message || error))
      );

      await page.locator('[data-command-altitude]').waitFor();
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, projectDir);
      await page.locator('[data-agent-composer]').waitFor();

      await page.getByRole('button', { name: /Open shell in / }).click();
      await waitForSessionCount(page, 1);
      await waitForWorkspaceTabCount(page, 1);
      await page.getByRole('button', { name: /Open shell in / }).click();
      const [firstSession] = await waitForSessionCount(page, 2);
      await waitForWorkspaceTabCount(page, 2);

      // Exercise a process exit independently of tab close: the durable tab
      // must remain addressable while the PTY incarnation stops.
      await page.evaluate(
        async id => await window.electron?.pty?.write(id, 'exit\n'),
        firstSession.id
      );
      await page.waitForFunction(async id => {
        const current = (await window.electron?.pty?.list()) ?? [];
        return current.some(session => session.id === id && session.exited);
      }, firstSession.id);
      await page.waitForFunction(async durableSessionId => {
        const layout = await window.electron?.workspace?.load();
        const tabs = layout?.projects?.flatMap(project => project.tabs) ?? [];
        return (
          tabs.length === 2 &&
          tabs.some(
            tab =>
              tab.durableSessionId === durableSessionId &&
              tab.lifecycle === 'exited'
          )
        );
      }, firstSession.durableSessionId);
      await page.keyboard.press('Control+Meta+2');
      await page.locator('[data-expose-tile]').first().waitFor();
      const selected = page.locator('[data-expose-tile][data-selected="true"]');
      const before = await selected.getAttribute('aria-label');
      await page.keyboard.press('Meta+Shift+BracketLeft');
      await page.waitForFunction(previous => {
        const current = document.querySelector(
          '[data-expose-tile][data-selected="true"]'
        );
        return current?.getAttribute('aria-label') !== previous;
      }, before);
      if (!(await selected.locator('[data-expose-state]').isVisible())) {
        throw new Error(
          'Command-Shift-[ did not select the stopped Session in Sessions mode'
        );
      }
      await page.waitForFunction(() => {
        const current = document.querySelector(
          '[data-expose-tile][data-selected="true"]'
        );
        return current === document.activeElement;
      });
      const stoppedTabId = await selected.getAttribute('data-expose-tab');
      if (!stoppedTabId) {
        throw new Error(
          'Stopped Session did not retain a durable workspace tab'
        );
      }
      await page.keyboard.press('Control+Meta+3');
      await page.waitForURL('**/fleet/spatial**');
      await page.waitForFunction(
        () =>
          document
            .querySelector('[data-agent-count]')
            ?.getAttribute('data-agent-count') === '2'
      );
      await page.locator('[data-board-zone]').first().click();
      await page.waitForURL(
        url => url.searchParams.get('altitude') === 'project'
      );

      const stoppedAgent = page.locator(
        '[data-board-agent][data-board-session-state="stopped"]'
      );
      await stoppedAgent.waitFor();
      if ((await stoppedAgent.count()) !== 1) {
        throw new Error('Spatial did not expose exactly one stopped Agent');
      }
      // Let the command-surface transition owner reveal the settled board;
      // otherwise the evidence image can catch its intentional blackout.
      await page.waitForTimeout(1_300);
      await page.screenshot({
        path: join(screenshots, 'stopped-agent-dotted.png'),
        fullPage: true,
      });

      await stoppedAgent.click();
      await page.waitForURL(
        url => url.searchParams.get('altitude') === 'agent'
      );
      await page.getByRole('button', { name: 'Open stopped session' }).click();
      await page.waitForURL(url => url.pathname === '/workspace');
      try {
        await page
          .locator(`[data-session-durable="${firstSession.durableSessionId}"]`)
          .waitFor();
      } catch (error) {
        const debug = await page.evaluate(async () => ({
          active: document.querySelector('[data-active="true"]')?.textContent,
          restores: Array.from(
            document.querySelectorAll('[data-session-restore]')
          ).map(node => node.getAttribute('data-session-restore')),
          sessions: await window.electron?.pty?.list(),
          layout: await window.electron?.workspace?.load(),
        }));
        throw new Error(
          `Exact stopped handoff failed for ${stoppedTabId}: ${JSON.stringify(debug)}`,
          { cause: error }
        );
      }

      if (errors.length > 0) {
        throw new Error(`Electron page errors: ${errors.join(' | ')}`);
      }
      console.log(
        'PASS Session parity: Cmd-Shift-[ selects stopped tab; Spatial keeps dotted interactive Agent; handoff opens exact restore surface'
      );
      console.log(`Screenshot: ${screenshots}`);
    },
    { maxMs: 120_000, firstWindowMs: 45_000 }
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
