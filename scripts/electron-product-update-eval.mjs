#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const sourceApp = process.env.EXAWATT_BASE_APP_PATH
  ? resolve(process.env.EXAWATT_BASE_APP_PATH)
  : null;
const expectedVersion = process.env.EXAWATT_EXPECTED_UPDATE;

if (!sourceApp || !sourceApp.endsWith('.app') || !existsSync(sourceApp)) {
  throw new Error(
    'EXAWATT_BASE_APP_PATH must point to the signed baseline .app'
  );
}
if (!expectedVersion) {
  throw new Error('EXAWATT_EXPECTED_UPDATE must name the version to install');
}

const root = mkdtempSync(join(tmpdir(), 'exawatt-product-update-'));
const home = join(root, 'home');
const userData = join(root, 'user-data');
const targetApp = join(root, basename(sourceApp));
const executable = join(targetApp, 'Contents', 'MacOS', 'Exawatt');
mkdirSync(home, { recursive: true });
mkdirSync(userData, { recursive: true });
execFileSync('/usr/bin/ditto', [sourceApp, targetApp]);

const launchEnv = {
  ...process.env,
  HOME: home,
  EXAWATT_RENDERER_LOGS: '1',
};

function bundleVersion() {
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    [
      '-c',
      'Print :CFBundleShortVersionString',
      join(targetApp, 'Contents', 'Info.plist'),
    ],
    { encoding: 'utf8' }
  ).trim();
}

async function waitFor(predicate, message, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(message);
}

async function launch() {
  return electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: launchEnv,
  });
}

function matchingPids() {
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(match => match?.[2].startsWith(executable))
    .map(match => Number(match[1]));
}

let app = null;
try {
  app = await launch();
  const page = await app.firstWindow({ timeout: 45_000 });
  page.setDefaultTimeout(20_000);
  await page.locator('[data-command-altitude]').waitFor();

  const initialVersion = await app.evaluate(({ app: electronApp }) =>
    electronApp.getVersion()
  );
  if (initialVersion === expectedVersion) {
    throw new Error(`Baseline is already ${expectedVersion}`);
  }

  const created = await page.evaluate(() =>
    window.electron?.pty?.create({ harness: 'shell', cwd: '/tmp' })
  );
  if (!created?.ok) {
    throw new Error(
      `Could not create update-impact session: ${created?.error ?? 'unknown'}`
    );
  }

  await page.evaluate(() => window.electron?.app?.checkForUpdates());
  const downloaded = await waitFor(async () => {
    const next = await page.evaluate(() =>
      window.electron?.app?.getUpdateStatus()
    );
    if (next?.phase === 'error')
      throw new Error(`Updater failed: ${next.error}`);
    return next?.phase === 'downloaded' ? next : null;
  }, `Timed out downloading Exawatt ${expectedVersion}`);
  if (downloaded.availableVersion !== expectedVersion) {
    throw new Error(
      `Expected ${expectedVersion}, got ${downloaded.availableVersion}`
    );
  }
  if (downloaded.liveSessions !== 1) {
    throw new Error(
      `Expected one impacted live session, got ${downloaded.liveSessions}`
    );
  }
  await page
    .getByText(`Restarting will stop 1 live session.`)
    .waitFor({ timeout: 10_000 });

  const oldProcess = app.process();
  const exited = new Promise(resolve => oldProcess.once('exit', resolve));
  await page.evaluate(() => window.electron?.app?.restartUpdate());
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Baseline app did not quit for update')),
        60_000
      )
    ),
  ]);
  app = null;

  await waitFor(
    () => bundleVersion() === expectedVersion,
    `Bundle was not replaced with Exawatt ${expectedVersion}`,
    90_000
  );
  const relaunched = await waitFor(
    () => matchingPids()[0] ?? null,
    'Updated app did not relaunch automatically',
    30_000
  );
  process.kill(relaunched, 'SIGTERM');
  await waitFor(
    () => !matchingPids().includes(relaunched),
    'Relaunched app did not stop'
  );

  app = await launch();
  const updatedPage = await app.firstWindow({ timeout: 45_000 });
  await updatedPage.locator('[data-command-altitude]').waitFor();
  const verified = await app.evaluate(({ app: electronApp }) =>
    electronApp.getVersion()
  );
  const buildInfo = await updatedPage.evaluate(() =>
    window.electron?.app?.getBuildInfo()
  );
  if (verified !== expectedVersion || buildInfo?.delivery !== 'signed') {
    throw new Error(
      `Updated bundle verification failed: ${JSON.stringify({ verified, buildInfo })}`
    );
  }

  console.log(
    `PASS signed update: ${initialVersion} -> ${verified}; live-session warning; automatic relaunch`
  );
} finally {
  await app?.close().catch(() => undefined);
  for (const pid of matchingPids()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
  rmSync(root, { recursive: true, force: true });
}
