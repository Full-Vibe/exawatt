#!/usr/bin/env node

import { chromium } from 'playwright-core';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const fakeBin = join(root, 'bin');
const pidDir = join(root, 'pids');
const projectDir = join(root, 'project');
const targetApp = join(root, basename(sourceApp));
const executable = join(targetApp, 'Contents', 'MacOS', 'Exawatt');
mkdirSync(home, { recursive: true });
mkdirSync(userData, { recursive: true });
mkdirSync(fakeBin, { recursive: true });
mkdirSync(pidDir, { recursive: true });
mkdirSync(projectDir, { recursive: true });

const fakeClaude = join(fakeBin, 'claude');
writeFileSync(
  fakeClaude,
  `#!/bin/sh
if [ "$1" = "-p" ]; then printf 'fixture context'; exit 0; fi
id="unknown"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--session-id" ] || [ "$prev" = "--resume" ]; then id="$arg"; fi
  prev="$arg"
done
printf '%s\n' "$$" > "$EXAWATT_TEST_PID_DIR/claude-$id-$$.pid"
printf 'UPDATE_CLAUDE:%s\n' "$*"
while IFS= read -r line; do printf '%s\n' "$line"; done
`
);
chmodSync(fakeClaude, 0o755);

const fakeCodex = join(fakeBin, 'codex');
writeFileSync(
  fakeCodex,
  `#!/bin/sh
if [ "$1" = "resume" ]; then
  id="$2"
  fresh=0
else
  id="$(/usr/bin/uuidgen | /usr/bin/tr '[:upper:]' '[:lower:]')"
  fresh=1
fi
printf '%s\n' "$$" > "$EXAWATT_TEST_PID_DIR/codex-$id-$$.pid"
printf 'UPDATE_CODEX:%s\n' "$*"
while IFS= read -r line; do
  if [ "$fresh" = "1" ]; then
    dir="$HOME/.codex/sessions/fixture"
    /bin/mkdir -p "$dir"
    printf '{"type":"session_meta","payload":{"id":"%s","cwd":"%s"}}\n' "$id" "$PWD" > "$dir/rollout-$id.jsonl"
    fresh=0
  fi
  printf '%s\n' "$line"
done
`
);
chmodSync(fakeCodex, 0o755);

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
  PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
  EXAWATT_RENDERER_LOGS: '1',
  EXAWATT_TEST: '1',
  EXAWATT_USER_DATA: userData,
  EXAWATT_TEST_HARNESS_BIN: fakeBin,
  EXAWATT_TEST_PID_DIR: pidDir,
  EXAWATT_TEST_QUIT_RESPONSE: 'confirm',
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

async function sessions(page) {
  return (await page.evaluate(async () => (await window.electron?.pty?.list()) ?? []));
}

async function waitForSessions(page, count) {
  return await waitFor(async () => {
    const current = await sessions(page);
    return current.length === count ? current : null;
  }, `Timed out waiting for ${count} live sessions`, 45_000);
}

async function waitForAgentIdentities(page, count) {
  return await waitFor(async () => {
    const agents = (await sessions(page)).filter(
      session => session.harness !== 'shell'
    );
    return agents.length === count && agents.every(session => session.harnessSessionId)
      ? agents
      : null;
  }, `Timed out waiting for ${count} provider identities`, 45_000);
}

function harnessPids() {
  return readdirSync(pidDir)
    .filter(name => name.endsWith('.pid'))
    .map(name => Number(readFileSync(join(pidDir, name), 'utf8').trim()))
    .filter(Number.isFinite);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

  await page.getByLabel('Working directory for new sessions').fill(projectDir);
  for (let i = 0; i < 2; i++) {
    await page.getByTitle(/Launch a new Claude Code session/).click();
    await waitForSessions(page, i + 1);
  }
  for (let i = 0; i < 2; i++) {
    await page.getByTitle(/Launch a new Codex session/).click();
    await waitForSessions(page, i + 3);
  }
  await page.getByTitle(/Launch a new Shell session/).click();
  const original = await waitForSessions(page, 5);
  for (const [index, session] of original.entries()) {
    await page.evaluate(
      async ({ id, marker }) =>
        window.electron?.pty?.write(id, `printf '${marker}\\n'\n`),
      { id: session.id, marker: `ENG018_UPDATE_HISTORY_${index + 1}` }
    );
  }
  const originalAgents = await waitForAgentIdentities(page, 4);
  const exactIds = originalAgents.map(session => session.harnessSessionId).sort();
  await page.evaluate(() => window.electron?.app?.checkForUpdates());

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
  if (downloaded.liveSessions !== 5) {
    throw new Error(
      `Expected five impacted live sessions, got ${downloaded.liveSessions}`
    );
  }
  const restartButton = page.getByRole('button', { name: 'Restart to Update' });
  await restartButton.waitFor({ timeout: 10_000 });

  const oldProcess = matchingPids()[0];
  if (!oldProcess)
    throw new Error('Could not identify the baseline app process');
  await restartButton.click().catch(() => undefined);
  await waitFor(
    () => !matchingPids().includes(oldProcess),
    'Baseline app did not quit for update',
    60_000
  );
  browser = null;

  await waitFor(
    () => harnessPids().every(pid => !isAlive(pid)),
    'Update restart left an agent or shell process alive',
    30_000
  );

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

  const histories = readdirSync(join(userData, 'sessions')).filter(name =>
    name.endsWith('.json')
  );
  if (histories.length !== 5) {
    throw new Error(`Expected five retained histories; got ${histories.length}`);
  }
  for (let index = 1; index <= 5; index++) {
    const marker = `ENG018_UPDATE_HISTORY_${index}`;
    if (
      !histories.some(name =>
        readFileSync(join(userData, 'sessions', name), 'utf8').includes(marker)
      )
    ) {
      throw new Error(`Retained update history ${index} is missing`);
    }
  }

  if ((await sessions(page)).length !== 0) {
    throw new Error('Updated relaunch spawned work without operator action');
  }
  const resumeBanner = page
    .getByRole('status')
    .filter({ hasText: '4 agents are ready to resume' });
  await resumeBanner.waitFor({ timeout: 20_000 });
  await resumeBanner.getByRole('button', { name: 'Resume All' }).click();
  const resumed = await waitForSessions(page, 4);
  if (resumed.some(session => session.harness === 'shell')) {
    throw new Error('Resume All restarted the shell');
  }
  const resumedIds = resumed.map(session => session.harnessSessionId).sort();
  if (JSON.stringify(resumedIds) !== JSON.stringify(exactIds)) {
    throw new Error(
      `Update resume identity mismatch: ${JSON.stringify({ exactIds, resumedIds })}`
    );
  }

  const finalProcess = matchingPids()[0];
  if (!finalProcess) throw new Error('Updated app process disappeared early');
  process.kill(finalProcess, 'SIGTERM');
  await waitFor(
    () => harnessPids().every(pid => !isAlive(pid)),
    'Final evaluation cleanup left a resumed agent alive',
    30_000
  );
  browser = null;

  console.log(
    `PASS signed update: ${initialVersion} -> ${verified}; 4 exact agents + 1 stopped shell; automatic relaunch`
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
  await waitFor(
    () => matchingPids().length === 0,
    'Evaluation app did not stop during cleanup',
    10_000
  ).catch(() => undefined);
  resetShipIt();
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
}
