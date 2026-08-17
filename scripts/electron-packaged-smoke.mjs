#!/usr/bin/env node

import { _electron as electron } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  assertPackagedContract,
  resolvePackagedApp,
} from './lib/packaged-app.mjs';

// The gate must be correct under EVERY distribution this repository can build,
// not just the one that used to be the only one (BUG-043). The package name and
// the capabilities the package owes both come from the resolved contract —
// `resolveDistributionIdentity` for the bundle, `contract.updates` for the
// updater group — which is the same source `prepare-electron-builder-config`
// projects electron-builder's config from.
async function resolveOrNull() {
  try {
    return await resolvePackagedApp();
  } catch {
    // The resolver needs the built `@exawatt/core` runtime, which a tree that
    // has never built anything does not have. Building produces it, so resolve
    // again on the other side rather than refuse.
    return null;
  }
}

let packaged = await resolveOrNull();

// This is the only Electron eval that needs no dev server, which is what makes
// it usable as a delivery gate (`SURFACE_GATES`) — but it does need a package,
// and a fresh agent worktree has none. Build one rather than fail as though the
// app were broken. BUG-036 shipped a renderer that could not start precisely
// because the oracle that proves it could not be routed to unattended.
if (
  !process.env.EXAWATT_APP_PATH &&
  (!packaged || !existsSync(packaged.executablePath))
) {
  console.log('[packaged-smoke] no local package; building one');
  execFileSync('pnpm', ['electron:build:dir'], { stdio: 'inherit' });
  // Packaging stages dist-electron/node_modules, and that snapshot sits on the
  // DEVELOPMENT module resolution path (incident 0012). Leaving it behind would
  // poison every dev Electron eval that runs after this gate in the same tree.
  execFileSync('node', ['scripts/discard-electron-snapshot.mjs'], {
    stdio: 'inherit',
  });
  // The build produced `@exawatt/core`, so a first attempt that failed for its
  // absence can now answer. It resolves the same ambient contract the build just
  // packaged from, so this cannot disagree with the artifact.
  packaged = await resolvePackagedApp();
}
// No package to build (EXAWATT_APP_PATH) and no resolution: surface the real
// error instead of the null.
if (!packaged) packaged = await resolvePackagedApp();

const executable = packaged.executablePath;
const { productUpdatesEnabled } = packaged;
assertPackagedContract(packaged.appPath, packaged.digest);
console.log(
  `[packaged-smoke] ${packaged.identity.productName} (${packaged.identity.appId}) ` +
    `distribution ${packaged.digest.slice(0, 12)}; product updates ` +
    `${productUpdatesEnabled ? 'declared' : 'excluded'} by the contract`
);
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
  // Product updates are an OPTIONAL grouped preload capability (WP2a): `main.ts`
  // passes `--exawatt-capability-updates` only when `contract.updates !== null`,
  // and the preload omits the whole group otherwise. So the gate pins BOTH
  // directions rather than asserting one and checking neither. Asserting the
  // absence is the half that matters most: a community package that somehow
  // exposed an updater would be reaching a feed its contract does not declare,
  // which is precisely the neutrality the seam exists to guarantee.
  const updates = await page.evaluate(async () => {
    const api = window.electron?.app;
    if (!api || !('updates' in api)) return { exposed: false, status: null };
    return { exposed: true, status: await api.updates.getStatus() };
  });
  const initialUpdate = updates.status;
  if (productUpdatesEnabled) {
    if (
      initialUpdate?.phase !== 'idle' ||
      initialUpdate.currentVersion !== expectedVersion
    ) {
      throw new Error(
        `Packaged updater IPC is invalid: ${JSON.stringify(initialUpdate)}`
      );
    }
  } else if (updates.exposed) {
    throw new Error(
      'Packaged preload exposed window.electron.app.updates, but this ' +
        'distribution contract declares no update feed. The package would ' +
        'offer an updater with nothing to update from.'
    );
  }
  const buildInfo = await page.evaluate(() =>
    window.electron?.app?.getBuildInfo()
  );
  // Orthogonal to the contract: `delivery` is the release CHANNEL, and
  // `startProductUpdater` only goes live on `signed`. A local package that
  // recorded `signed` would start checking a feed from a developer's machine.
  if (buildInfo?.delivery !== 'dogfood') {
    throw new Error(
      `Local package recorded the signed release channel: ${JSON.stringify(buildInfo)}`
    );
  }
  const buildUpdatesEnabled =
    buildInfo.distribution.capabilities.updates === true;
  if (buildUpdatesEnabled !== productUpdatesEnabled) {
    throw new Error(
      `Build-info update capability disagrees with the packaged contract: ${JSON.stringify({ buildUpdatesEnabled, productUpdatesEnabled })}`
    );
  }
  const hasUpdateMenu = await app.evaluate(({ Menu }) =>
    Boolean(
      Menu.getApplicationMenu()?.items.some(item =>
        item.submenu?.items.some(child => child.label === 'Check for Updates…')
      )
    )
  );
  if (hasUpdateMenu !== productUpdatesEnabled) {
    throw new Error(
      `Native update menu disagrees with the distribution capability: ${JSON.stringify({ hasUpdateMenu, productUpdatesEnabled })}`
    );
  }
  const diagnostics = await page.evaluate(() =>
    window.electron?.app?.getDiagnosticsReport(false)
  );
  if (!productUpdatesEnabled) {
    const updaterLog = diagnostics.logs.find(
      log => log.name === 'updater.jsonl'
    );
    if (diagnostics.update !== null || updaterLog?.present) {
      throw new Error(
        `Capability-absent package initialized updater state: ${JSON.stringify({ update: diagnostics.update, updaterLog })}`
      );
    }
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
  if (productUpdatesEnabled) {
    const updateWithSession = await page.evaluate(() =>
      window.electron?.app?.updates?.getStatus()
    );
    if (updateWithSession?.liveSessions !== 1) {
      throw new Error(
        'Updater status did not report restart impact from the live PTY'
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Packaged Electron errors: ${errors.join(' | ')}`);
  }
  console.log(
    `PASS packaged Electron (${packaged.identity.productName}): background launch + ` +
      'local renderer + capability-shaped preload/menu/diagnostics + PTY round trip + contract-declared updater ' +
      `${productUpdatesEnabled ? 'present' : 'absent'}`
  );
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
