#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);
const userData = mkdtempSync(join(tmpdir(), 'exawatt-packaged-smoke-'));
const app = await electron.launch({
  executablePath: executable,
  env: {
    ...process.env,
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_RENDERER_LOGS: '1',
  },
});

try {
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(20_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.locator('[data-command-altitude]').waitFor();
  const url = new URL(page.url());
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/workspace') {
    throw new Error(`Expected packaged /workspace on loopback; got ${page.url()}`);
  }
  const hasPty = await page.evaluate(() => !!window.electron?.pty);
  if (!hasPty) throw new Error('Packaged renderer has no PTY preload');
  const initialUpdate = await page.evaluate(() =>
    window.electron?.app?.getUpdateStatus()
  );
  if (initialUpdate?.phase !== 'idle' || initialUpdate.currentVersion !== '0.1.0') {
    throw new Error(`Packaged updater IPC is invalid: ${JSON.stringify(initialUpdate)}`);
  }
  const buildInfo = await page.evaluate(() => window.electron?.app?.getBuildInfo());
  if (buildInfo?.delivery !== 'dogfood') {
    throw new Error(`Local package unexpectedly enabled product updates: ${JSON.stringify(buildInfo)}`);
  }

  const created = await page.evaluate(async () => {
    return await window.electron?.pty?.create({ harness: 'shell', cwd: '/tmp' });
  });
  if (!created?.ok) {
    throw new Error(`Packaged shell failed: ${created?.error ?? 'no result'}`);
  }
  const sessionId = created.session.id;
  await page.evaluate(async id => {
    await window.electron?.pty?.write(id, "printf 'EXAWATT_PACKAGED_OK\\n'\n");
  }, sessionId);
  await page.waitForFunction(async id => {
    const buffer = await window.electron?.pty?.buffer(id);
    return buffer?.includes('EXAWATT_PACKAGED_OK');
  }, sessionId);
  const updateWithSession = await page.evaluate(() =>
    window.electron?.app?.getUpdateStatus()
  );
  if (updateWithSession?.liveSessions !== 1) {
    throw new Error('Updater status did not report restart impact from the live PTY');
  }

  if (errors.length > 0) {
    throw new Error(`Packaged Electron errors: ${errors.join(' | ')}`);
  }
  console.log('PASS packaged Electron: local renderer + preload + PTY round trip');
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
