#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { waitForPageCondition, withElectronApp } from './lib/electron-eval.mjs';
import { ensurePackagedApp } from './lib/packaged-app.mjs';
import { icnsImageSlices } from './lib/app-icon.mjs';

// The gate must be correct under EVERY distribution this repository can build,
// not just the one that used to be the only one (BUG-043). The package name and
// the capabilities the package owes both come from the resolved contract —
// `resolveDistributionIdentity` for the bundle, `contract.updates` for the
// updater group — which is the same source `prepare-electron-builder-config`
// projects electron-builder's config from.
//
// This needs no dev server, which is what makes it usable as a delivery gate
// (`SURFACE_GATES`), but it does need a package, and a fresh agent worktree
// has none. `ensurePackagedApp` builds one rather than fail as though the app
// were broken: BUG-036 shipped a renderer that could not start precisely
// because the oracle that proves it could not be routed to unattended.
const packaged = await ensurePackagedApp({ label: 'packaged-smoke' });
const { productUpdatesEnabled } = packaged;
const expectedWebIcon = icnsImageSlices(
  readFileSync(resolve(packaged.identity.iconPath))
)[0];
if (!expectedWebIcon) {
  throw new Error(
    `Distribution icon ${packaged.identity.iconPath} has no browser representation`
  );
}
const expectedWebIconDigest = createHash('sha256')
  .update(expectedWebIcon.png)
  .digest('hex');
console.log(
  `[packaged-smoke] ${packaged.identity.productName} (${packaged.identity.appId}) ` +
    `distribution ${packaged.digest.slice(0, 12)}; product updates ` +
    `${productUpdatesEnabled ? 'declared' : 'excluded'} by the contract`
);
const expectedVersion = JSON.parse(
  readFileSync(resolve('package.json'), 'utf8')
).version;
const userData = mkdtempSync(join(tmpdir(), 'exawatt-packaged-smoke-'));
const launchOptions = {
  packaged,
  env: {
    ...process.env,
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_RENDERER_LOGS: '1',
  },
};
const launchLimits = { maxMs: 120_000, firstWindowMs: 45_000 };

/** The pid listening on a loopback port, or null when nothing is. */
function listenerOn(port) {
  try {
    const pid = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8' }
    )
      .trim()
      .split('\n')[0];
    return pid ? Number(pid) : null;
  } catch {
    // lsof exits 1 when no process matches.
    return null;
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * LaunchServices' record of `pid` as a running application: its bundle id and
 * type (`Foreground` is what the Dock and app switchers list), or null when
 * the process never registered as one.
 */
function launchServicesEntry(pid) {
  const asn = execFileSync('lsappinfo', ['find', `pid=${pid}`], {
    encoding: 'utf8',
  }).trim();
  if (!asn) return null;
  const info = execFileSync(
    'lsappinfo',
    ['info', '-only', 'bundleid', '-only', 'ApplicationType', asn],
    { encoding: 'utf8' }
  );
  const field = key => info.match(new RegExp(`"${key}"="([^"]*)"`))?.[1];
  return {
    bundleId: field('CFBundleIdentifier'),
    type: field('ApplicationType'),
  };
}

/** The diagnostics records the launch wrote to `logs/main.jsonl`. */
function mainRecords() {
  try {
    return readFileSync(join(userData, 'logs', 'main.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function waitUntil(condition, failure, deadlineMs = 10_000) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${failure} (TIMED OUT after ${deadlineMs / 1000}s)`);
}

let firstOrigin = null;
let marker = null;
try {
  await withElectronApp(
    launchOptions,
    async (app, page) => {
      page.setDefaultTimeout(20_000);
      const backgroundState = await app.evaluate(({ app, BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        return {
          visible: windows.some(window => window.isVisible()),
          focused: windows.some(window => window.isFocused()),
          dockVisible:
            process.platform === 'darwin'
              ? (app.dock?.isVisible() ?? true)
              : null,
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
      page.on('pageerror', error =>
        errors.push(String(error.message || error))
      );
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
      // The community projection deliberately omits Next's conventional
      // `src/app/icon.png`, because that file is the official Exawatt mark. The
      // header used to infer `/icon.png` from electron-builder's `iconPath`, which
      // made an otherwise healthy community package emit a 400 on every page. Read
      // the URLs the packaged renderer actually chose and demand usable bytes from
      // both browser metadata and visible chrome. This checks the distribution
      // boundary rather than a filename: official and community packages may use
      // different URLs, but neither may point at an absent asset.
      const brandAssets = await page.evaluate(async expectedDigest => {
        const candidates = [
          ...document.querySelectorAll('link[rel~="icon"]'),
          ...document.querySelectorAll('[data-chrome-brand] img'),
        ];
        const urls = [
          ...new Set(
            candidates
              .map(element => {
                const selected =
                  element instanceof HTMLImageElement
                    ? element.currentSrc || element.src
                    : element instanceof HTMLLinkElement
                      ? element.href
                      : '';
                if (!selected) return '';
                const selectedUrl = new URL(selected, window.location.href);
                // `next/image` wraps the declared source in its optimization route.
                // The distribution contract owns the source bytes, so unwrap that
                // URL and verify the input rather than coupling this gate to a
                // negotiated WebP/AVIF transformation.
                if (selectedUrl.pathname === '/_next/image') {
                  const source = selectedUrl.searchParams.get('url');
                  return source
                    ? new URL(source, window.location.href).href
                    : '';
                }
                return selectedUrl.href;
              })
              .filter(Boolean)
          ),
        ];
        return await Promise.all(
          urls.map(async assetUrl => {
            try {
              const response = await fetch(assetUrl);
              const bytes = await response.arrayBuffer();
              const digest = [
                ...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
              ]
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
              return {
                url: assetUrl,
                status: response.status,
                digest,
                expectedDigest,
              };
            } catch (error) {
              return { url: assetUrl, status: 0, error: String(error) };
            }
          })
        );
      }, expectedWebIconDigest);
      if (brandAssets.length === 0) {
        throw new Error(
          'Packaged renderer declared no distribution brand asset'
        );
      }
      const brokenBrandAssets = brandAssets.filter(
        asset =>
          asset.status < 200 ||
          asset.status >= 400 ||
          asset.digest !== asset.expectedDigest
      );
      if (brokenBrandAssets.length > 0) {
        throw new Error(
          `Packaged distribution brand asset failed: ${JSON.stringify(brokenBrandAssets)}`
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
        if (!api || !('updates' in api))
          return { exposed: false, status: null };
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
            item.submenu?.items.some(
              child => child.label === 'Check for Updates…'
            )
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
        throw new Error(
          `Packaged shell failed: ${created?.error ?? 'no result'}`
        );
      }
      const sessionId = created.session.id;
      await page.evaluate(async id => {
        await window.electron?.pty?.write(
          id,
          "printf 'EXAWATT_PACKAGED_OK\\n'\n"
        );
      }, sessionId);
      await waitForPageCondition(
        page,
        async id => {
          const buffer = await window.electron?.pty?.buffer(id);
          return buffer?.includes('EXAWATT_PACKAGED_OK');
        },
        sessionId
      );
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

      // BUG-022: a second launch of the same install serves the same origin, so
      // what the renderer stored per origin is still there. The port used to be
      // picked at random every launch, which made `localStorage` a per-launch
      // store on the desktop.
      firstOrigin = new URL(page.url()).origin;
      marker = `relaunch-${Date.now()}`;
      await page.evaluate(
        value => localStorage.setItem('exawatt.eval.relaunch-marker', value),
        marker
      );
    },
    launchLimits
  );

  await withElectronApp(
    launchOptions,
    async (app, relaunched) => {
      relaunched.setDefaultTimeout(20_000);
      await relaunched.locator('[data-command-altitude]').waitFor();
      const secondOrigin = new URL(relaunched.url()).origin;
      if (secondOrigin !== firstOrigin) {
        throw new Error(
          `The second launch moved the renderer origin: ${firstOrigin} -> ${secondOrigin}`
        );
      }
      const survived = await relaunched.evaluate(() =>
        localStorage.getItem('exawatt.eval.relaunch-marker')
      );
      if (survived !== marker) {
        throw new Error(
          `localStorage did not survive a relaunch on ${secondOrigin}: expected ${marker}, read ${survived}`
        );
      }

      const rendererPort = Number(new URL(relaunched.url()).port);
      const firstServerPid = listenerOn(rendererPort);
      if (!firstServerPid) {
        throw new Error(
          `Nothing is listening on the renderer port ${rendererPort}`
        );
      }

      // BUG-310: macOS lists one application for the app, not two. The server
      // used to run as the app's own executable, and Next naming its process
      // registered it as a second running application with the app's bundle
      // id; as a utility process it runs from the helper bundle, which macOS
      // keeps out of the Dock and every app switcher.
      const mainPid = app.process().pid;
      const appEntry = launchServicesEntry(mainPid);
      const serverEntry = launchServicesEntry(firstServerPid);
      if (appEntry?.bundleId !== packaged.identity.appId) {
        throw new Error(
          `Electron main is not the registered ${packaged.identity.appId} application: ${JSON.stringify(appEntry)}`
        );
      }
      if (
        serverEntry !== null &&
        (serverEntry.bundleId === packaged.identity.appId ||
          serverEntry.type === 'Foreground')
      ) {
        throw new Error(
          `The renderer server (pid ${firstServerPid}) is registered as a second application: ${JSON.stringify(serverEntry)}`
        );
      }

      // BUG-223: a server killed from outside comes back on its own port, so
      // the origin survives, and the death is on the record twice: Chromium's
      // account of its helper and the supervisor's restart.
      process.kill(firstServerPid, 'SIGKILL');
      await waitUntil(
        () => {
          const pid = listenerOn(rendererPort);
          return pid !== null && pid !== firstServerPid;
        },
        `The renderer server killed from outside did not come back on port ${rendererPort}`,
        30_000
      );
      await relaunched.locator('[data-command-altitude]').waitFor();
      if (new URL(relaunched.url()).origin !== secondOrigin) {
        throw new Error(
          `The restarted renderer server moved the origin: ${secondOrigin} -> ${new URL(relaunched.url()).origin}`
        );
      }
      await waitUntil(() => {
        const events = mainRecords().map(record => record.event);
        return events.includes('renderer-server.restarted');
      }, 'The renderer server restart is not on the record');
      const records = mainRecords();
      const exited = records.filter(r => r.event === 'renderer-server.exited');
      const gone = records.filter(
        r => r.event === 'child.gone' && r.name === 'Renderer Server'
      );
      if (
        exited.length !== 1 ||
        exited[0].action !== 'restart' ||
        gone.length !== 1 ||
        gone[0].reason !== 'killed'
      ) {
        throw new Error(
          `The renderer server's death is not on the record as one kill and one restart: ${JSON.stringify({ exited, gone })}`
        );
      }

      // BUG-070: the renderer server ends with Electron main however main ends.
      // SIGKILL runs no shutdown code at all; Chromium ends a utility process
      // when main goes. Before that, the server reparented to launchd and kept
      // its port, its memory, and a Dock icon of its own.
      const serverPid = listenerOn(rendererPort);
      const mainExited = new Promise(resolve =>
        app.process().once('exit', resolve)
      );
      app.process().kill('SIGKILL');
      await mainExited;
      await waitUntil(
        () => !isAlive(serverPid) && listenerOn(rendererPort) === null,
        `The renderer server (pid ${serverPid}) outlived a SIGKILLed Electron main and still holds port ${rendererPort}`
      );

      console.log(
        `PASS packaged Electron (${packaged.identity.productName}): background launch + ` +
          'local renderer + capability-shaped preload/menu/diagnostics + PTY round trip + contract-declared updater ' +
          `${productUpdatesEnabled ? 'present' : 'absent'} + one origin and its storage across a relaunch + ` +
          'one registered application + a killed renderer server restarts on its origin, on the record + ' +
          'renderer server ends with a killed main'
      );
    },
    launchLimits
  );
} finally {
  rmSync(userData, { recursive: true, force: true });
}
