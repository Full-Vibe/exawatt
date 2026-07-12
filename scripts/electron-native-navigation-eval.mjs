#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  throw new Error('The native navigation evaluator requires macOS.');
}

const base = process.env.EXA_BASE || 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-native-nav-'));
const app = await electron.launch({
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: `${base}/workspace`,
  },
});

try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.locator('[data-command-altitude]').waitFor();

  const clickAtOSLevel = async selector => {
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show();
      window.focus();
      return window.getContentBounds();
    });
    const box = await page.locator(selector).boundingBox();
    if (!box) throw new Error(`No native click target for ${selector}`);
    const x = Math.round(bounds.x + box.x + box.width / 2);
    const y = Math.round(bounds.y + box.y + box.height / 2);
    try {
      execFileSync('/usr/bin/osascript', [
        '-e',
        `tell application "System Events" to click at {${x}, ${y}}`,
      ]);
    } catch (error) {
      throw new Error(
        `Native click failed. Allow terminal automation in macOS Accessibility settings. ${String(error)}`
      );
    }
  };

  await clickAtOSLevel('[data-command-altitude-level="spatial"]');
  await page.waitForURL('**/fleet/spatial');
  await clickAtOSLevel('[data-command-altitude-level="terminal"]');
  await page.waitForURL('**/workspace');
  await clickAtOSLevel('[data-command-altitude-level="sessions"]');
  await page.waitForURL('**view=sessions**');

  console.log(
    'PASS native navigation: OS clicks reach Spatial, Terminal, and Sessions'
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
