#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
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

const applications = '/Applications';
mkdirSync(applications, { recursive: true });
const root = join(applications, 'Exawatt Update Evaluation');
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const home = join(root, 'home');
const userData = join(root, 'user-data');
const targetApp = join(root, basename(sourceApp));
const executable = join(targetApp, 'Contents', 'MacOS', 'Exawatt');
mkdirSync(home, { recursive: true });
mkdirSync(userData, { recursive: true });

function resetShipIt() {
  try {
    execFileSync('/bin/launchctl', ['remove', 'com.exawatt.app.ShipIt'], {
      stdio: 'ignore',
    });
  } catch {
    // No registered updater helper.
  }
  rmSync(join(homedir(), 'Library', 'Caches', 'com.exawatt.app.ShipIt'), {
    recursive: true,
    force: true,
  });
}

resetShipIt();
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

async function availablePort() {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a DevTools port'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function launch() {
  const port = await availablePort();
  execFileSync(
    '/usr/bin/open',
    [
      '-n',
      '-a',
      targetApp,
      '--args',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
    ],
    { env: launchEnv }
  );
  return await waitFor(
    async () => {
      try {
        const browser = await chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
          { timeout: 1_000 }
        );
        const page = browser.contexts()[0]?.pages()[0];
        if (!page) {
          await browser.close();
          return null;
        }
        return { browser, page };
      } catch {
        return null;
      }
    },
    'Timed out attaching to the LaunchServices app',
    45_000
  );
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

let browser = null;
try {
  let launched = await launch();
  browser = launched.browser;
  let page = launched.page;
  page.setDefaultTimeout(20_000);
  await page.locator('[data-command-altitude]').waitFor();

  const initialVersion = await page.evaluate(
    async () => (await window.electron?.app?.getUpdateStatus())?.currentVersion
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

  let transientRetries = 0;
  let retryAfter = 0;
  const downloaded = await waitFor(async () => {
    const next = await page.evaluate(() =>
      window.electron?.app?.getUpdateStatus()
    );
    if (next?.phase === 'error') {
      if (
        next.error?.includes('ERR_CONNECTION_CLOSED') &&
        transientRetries < 2
      ) {
        if (retryAfter === 0) retryAfter = Date.now() + 5_000;
        if (Date.now() >= retryAfter) {
          transientRetries += 1;
          retryAfter = 0;
          console.log(
            `[product-update] retrying transient connection failure (${transientRetries}/2)`
          );
          await page
            .evaluate(() => window.electron?.app?.checkForUpdates())
            .catch(() => undefined);
        }
        return null;
      }
      throw new Error(`Updater failed: ${next.error}`);
    }
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

  const oldProcess = matchingPids()[0];
  if (!oldProcess)
    throw new Error('Could not identify the baseline app process');
  await page
    .evaluate(() => window.electron?.app?.restartUpdate())
    .catch(() => undefined);
  await waitFor(
    () => !matchingPids().includes(oldProcess),
    'Baseline app did not quit for update',
    60_000
  );
  browser = null;

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

  launched = await launch();
  browser = launched.browser;
  page = launched.page;
  await page.locator('[data-command-altitude]').waitFor();
  const verified = await page.evaluate(
    async () => (await window.electron?.app?.getUpdateStatus())?.currentVersion
  );
  const buildInfo = await page.evaluate(() =>
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
  await browser?.close().catch(() => undefined);
  for (const pid of matchingPids()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }
  resetShipIt();
  rmSync(root, { recursive: true, force: true });
}
