#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.NAV_SCREENSHOT_DIR || '/tmp/exawatt-electron-altitude';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-nav-eval-'));
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: `${BASE}/workspace`,
  },
});

try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.locator('[data-command-altitude]').waitFor();
  await page.getByLabel('Working directory for new sessions').fill('/tmp');
  await page.getByTitle(/Launch a new Shell session/).click();
  await page.waitForFunction(async () => {
    const sessions = await window.electron?.pty?.list();
    return sessions?.length === 1;
  });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'after-launch.png'),
    fullPage: true,
  });
  await page.locator('[data-initiative]').waitFor();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'terminal.png'),
    fullPage: true,
  });

  await page.locator('[data-command-altitude-level="sessions"]').click();
  await page.waitForURL('**/workspace?view=sessions');
  await page.locator('[data-expose-tile]').waitFor();

  await page.locator('[data-command-altitude-level="spatial"]').click();
  await page.waitForURL('**/fleet/spatial');
  await page
    .locator('[data-command-altitude-level="spatial"][aria-current="page"]')
    .waitFor();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'spatial.png'),
    fullPage: true,
  });

  await page.keyboard.press('Meta+Shift+M');
  await page.waitForURL('**/workspace');
  await page.locator('[data-initiative]').waitFor();
  const sessionCount = await page.evaluate(async () => {
    const sessions = await window.electron?.pty?.list();
    return sessions?.length ?? 0;
  });
  if (sessionCount !== 1) {
    throw new Error(
      `Expected the live PTY to survive navigation; found ${sessionCount}`
    );
  }
  if (errors.length > 0) {
    throw new Error(`Electron errors: ${errors.join(' | ')}`);
  }

  console.log(
    'PASS Electron navigation: live terminal → Sessions → Spatial → shortcut return'
  );
  console.log(`Screenshots: ${SCREENSHOT_DIR}`);
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
