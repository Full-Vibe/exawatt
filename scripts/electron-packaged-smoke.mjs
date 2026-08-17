#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const executable = resolve(
  process.env.EXAWATT_APP_PATH ??
    'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt'
);

// This is the only Electron eval that needs no dev server, which is what makes
// it usable as a delivery gate (`SURFACE_GATES`) — but it does need a package,
// and a fresh agent worktree has none. Build one rather than fail as though the
// app were broken. BUG-036 shipped a renderer that could not start precisely
// because the oracle that proves it could not be routed to unattended.
if (!process.env.EXAWATT_APP_PATH && !existsSync(executable)) {
  console.log('[packaged-smoke] no local package; building one');
  execFileSync('pnpm', ['electron:build:dir'], { stdio: 'inherit' });
  // Packaging stages dist-electron/node_modules, and that snapshot sits on the
  // DEVELOPMENT module resolution path (incident 0012). Leaving it behind would
  // poison every dev Electron eval that runs after this gate in the same tree.
  execFileSync('node', ['scripts/discard-electron-snapshot.mjs'], {
    stdio: 'inherit',
  });
}
const expectedVersion = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8')
).version;
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
  const backgroundState = await app.evaluate(({ app, BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows();
    return {
      visible: windows.some(window => window.isVisible()),
      focused: windows.some(window => window.isFocused()),
      dockVisible:
        process.platform === 'darwin' ? (app.dock?.isVisible() ?? true) : null,
    };
  });
  if (
    backgroundState.visible ||
    backgroundState.focused ||
    backgroundState.dockVisible === true
  ) {
    throw new Error(
      `Automated Electron launch activated its UI: ${JSON.stringify(backgroundState)}`
    );
  }
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.locator('[data-command-altitude]').waitFor();
  const url = new URL(page.url());
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/workspace') {
    throw new Error(
      `Expected packaged /workspace on loopback; got ${page.url()}`
    );
  }
  const hasPty = await page.evaluate(() => !!window.electron?.pty);
  if (!hasPty) throw new Error('Packaged renderer has no PTY preload');
  const initialUpdate = await page.evaluate(() =>
    window.electron?.app?.getUpdateStatus()
  );
  if (
    initialUpdate?.phase !== 'idle' ||
    initialUpdate.currentVersion !== expectedVersion
  ) {
    throw new Error(
      `Packaged updater IPC is invalid: ${JSON.stringify(initialUpdate)}`
    );
  }
  const buildInfo = await page.evaluate(() =>
    window.electron?.app?.getBuildInfo()
  );
  if (buildInfo?.delivery !== 'dogfood') {
    throw new Error(
      `Local package unexpectedly enabled product updates: ${JSON.stringify(buildInfo)}`
    );
  }

  const created = await page.evaluate(async () => {
    return await window.electron?.pty?.create({
      harness: 'shell',
      cwd: '/tmp',
    });
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
    throw new Error(
      'Updater status did not report restart impact from the live PTY'
    );
  }

  if (errors.length > 0) {
    throw new Error(`Packaged Electron errors: ${errors.join(' | ')}`);
  }
  console.log(
    'PASS packaged Electron: background launch + local renderer + preload + PTY round trip'
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
