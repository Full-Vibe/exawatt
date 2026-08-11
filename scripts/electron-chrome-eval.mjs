#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openShellFromLauncher } from './lib/electron-eval.mjs';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const root = mkdtempSync(join(tmpdir(), 'exawatt-chrome-eval-'));
const userData = join(root, 'userData');
const projectDir = join(
  root,
  'projects',
  'daily-driver-adoption',
  'long-identifying-worktree-name',
  'application'
);
const screenshots = process.env.EXAWATT_CHROME_SCREENSHOTS ?? '/tmp/exawatt-chrome-eval';
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(screenshots, { recursive: true });

const app = await electron.launch({
  executablePath: executable,
  env: {
    ...process.env,
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
  },
});

try {
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(20_000);
  await page.setViewportSize({ width: 800, height: 600 });
  await page.locator('[data-command-altitude]').waitFor();
  await page.evaluate(dir => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: dir })
    );
  }, projectDir);
  await page.locator('[data-agent-composer]').waitFor();
  await openShellFromLauncher(page);

  const terminal = page.locator('.xterm-helper-textarea');
  await terminal.waitFor();
  const context = page.locator('[data-active-session-context]');
  await context.waitFor();
  const enableNotifications = page.getByRole('button', {
    name: 'Enable attention notifications',
  });
  await enableNotifications.waitFor();
  if ((await enableNotifications.getAttribute('aria-pressed')) !== 'false') {
    throw new Error('Attention notifications did not default off');
  }
  await enableNotifications.click();
  await page
    .getByRole('button', { name: 'Disable attention notifications' })
    .waitFor();
  const savedSettings = JSON.parse(
    readFileSync(join(userData, 'settings.json'), 'utf8')
  );
  if (savedSettings.notifications?.attention !== true) {
    throw new Error('Attention notification setting did not persist');
  }
  const pathLabel = context.locator('[title]').first();
  if ((await pathLabel.getAttribute('title')) !== projectDir) {
    throw new Error('Active cwd does not disclose its full path');
  }
  const bounds = await context.boundingBox();
  if (!bounds || bounds.x < 0 || bounds.x + bounds.width > 800) {
    throw new Error(`Context bar exceeds the 800px viewport: ${JSON.stringify(bounds)}`);
  }

  await terminal.focus();
  await terminal.press('F6');
  const chromeFocused = await page.evaluate(() =>
    !!document.activeElement?.closest('[data-workspace-chrome]')
  );
  if (!chromeFocused) throw new Error('F6 did not move focus from terminal to chrome');
  await page.keyboard.press('Escape');
  const terminalFocused = await page.evaluate(() =>
    document.activeElement?.classList.contains('xterm-helper-textarea') ?? false
  );
  if (!terminalFocused) throw new Error('Escape did not return chrome focus to terminal');

  await page.screenshot({ path: join(screenshots, 'workspace-800x600.png') });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.screenshot({ path: join(screenshots, 'workspace-1400x900.png') });
  console.log(
    'PASS chrome: cwd + layouts + focus boundary + default-off notification setting'
  );
} finally {
  await app.close();
  rmSync(root, { recursive: true, force: true });
}
