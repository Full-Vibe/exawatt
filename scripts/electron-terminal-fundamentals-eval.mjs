#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const userData = mkdtempSync(join(tmpdir(), 'exawatt-terminal-eval-'));
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
  page.setDefaultTimeout(30_000);
  await page.locator('[data-command-altitude]').waitFor();
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent('exawatt:open-project', { detail: '/tmp' })
    );
  });
  await page.locator('[data-agent-composer]').waitFor();
  await page.getByRole('button', { name: /Open shell in / }).click();
  const textarea = page.locator('.xterm-helper-textarea');
  await textarea.waitFor();

  const sessionId = await page.evaluate(async () => {
    const sessions = await window.electron?.pty?.list();
    if (sessions?.length !== 1) {
      throw new Error(`Expected one terminal session; got ${sessions?.length ?? 0}`);
    }
    return sessions[0].id;
  });
  await page.waitForTimeout(2_000);

  await page.evaluate(async id => {
    await window.electron?.pty?.write(
      id,
      "/usr/bin/awk 'BEGIN { for (i = 1; i <= 20000; i++) printf \"EXAWATT_LINE_%05d\\n\", i }'\n"
    );
  }, sessionId);
  await page.waitForFunction(async id => {
    const buffer = await window.electron?.pty?.buffer(id);
    if (!buffer) return false;
    const marker = 'EXAWATT_LINE_20000';
    return buffer.indexOf(marker) !== buffer.lastIndexOf(marker);
  }, sessionId);
  await page.waitForTimeout(3_000);
  if (process.env.EXAWATT_EVAL_SCREENSHOT) {
    await page.screenshot({ path: process.env.EXAWATT_EVAL_SCREENSHOT });
  }

  await textarea.focus();
  await textarea.press('Meta+f');
  const search = page.getByLabel('Search terminal scrollback');
  await search.fill('EXAWATT_LINE_00001');
  await page.waitForFunction(() => {
    const value = document.querySelector('[data-terminal-search] span')?.textContent;
    return value && value !== '0/0';
  });
  await page.getByLabel('Close terminal search').click();

  await page.locator('.terminal-pane').click({ button: 'right', position: { x: 40, y: 80 } });
  await page.getByRole('menuitem', { name: 'Select All' }).click();
  await textarea.focus();
  await textarea.press('Meta+c');
  const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
  if (!copied.includes('EXAWATT_LINE_00001') || !copied.includes('EXAWATT_LINE_20000')) {
    throw new Error('Terminal Select All and Copy did not reach the Electron clipboard');
  }

  const clipboardMarker = 'EXAWATT_CLIPBOARD_TEXT_9713';
  await app.evaluate(({ clipboard }, value) => clipboard.writeText(value), clipboardMarker);
  await textarea.focus();
  await textarea.press('Meta+v');
  await page.waitForFunction(async ({ id, marker }) => {
    const buffer = await window.electron?.pty?.buffer(id);
    return buffer?.includes(marker);
  }, { id: sessionId, marker: clipboardMarker });

  const onePixelPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await app.evaluate(
    ({ clipboard, nativeImage }, dataUrl) => {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    },
    onePixelPng
  );
  const imagePaste = await page.evaluate(async id => {
    return await window.electron?.pty?.pasteClipboard(id);
  }, sessionId);
  if (imagePaste?.kind !== 'image' || !imagePaste.path || !existsSync(imagePaste.path)) {
    throw new Error(`Image paste did not create a private temporary file: ${JSON.stringify(imagePaste)}`);
  }

  console.log(
    'PASS terminal fundamentals: 20k-line search + context copy + text/image paste'
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
