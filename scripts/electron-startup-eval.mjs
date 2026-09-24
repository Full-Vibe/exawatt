#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { withElectronApp } from './lib/electron-eval.mjs';
import { ensurePackagedApp } from './lib/packaged-app.mjs';

// This tree's package, built when absent or stale (BUG-217).
const packaged = await ensurePackagedApp({ label: 'startup' });
const runs = Math.max(1, Number.parseInt(process.env.STARTUP_RUNS ?? '3', 10));
const userData = mkdtempSync(join(tmpdir(), 'exawatt-startup-eval-'));
const staleRendererCache = join(userData, 'renderer-cache', 'stale-build');
mkdirSync(staleRendererCache, { recursive: true });
writeFileSync(join(staleRendererCache, 'obsolete'), 'fixture');
const results = [];

const ms = value => Math.round(value * 10) / 10;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

try {
  for (let index = 0; index < runs; index += 1) {
    // The launcher stamps the launch on the same clock this measures with, so
    // the measurement runs through it like every other eval (BUG-217).
    await withElectronApp(
      {
        packaged,
        env: {
          ...process.env,
          EXAWATT_TEST: '1',
          EXAWATT_USER_DATA: userData,
        },
      },
      async (_app, page, launch) => {
        const elapsed = () => ms(performance.now() - launch.startedAt);
        const connected = ms(launch.connectedAt - launch.startedAt);
        const firstWindow = ms(launch.firstWindowAt - launch.startedAt);
        await page
          .locator('[data-exawatt-launch], [data-command-altitude]')
          .first()
          .waitFor({ timeout: 30_000 });
        const firstVisible = elapsed();
        const launchScreenShown =
          (await page.locator('[data-exawatt-launch]').count()) > 0;
        if (
          index === 0 &&
          launchScreenShown &&
          process.env.STARTUP_SCREENSHOT
        ) {
          const screenshot = resolve(process.env.STARTUP_SCREENSHOT);
          mkdirSync(dirname(screenshot), { recursive: true });
          await page.screenshot({ path: screenshot });
        }
        // BOOT INTEGRITY (BUG-016). A build whose main process throws inside
        // `bootstrapCommandSurface` never leaves the splash, and waiting only
        // for the workspace reports that as an anonymous timeout on a selector.
        // Read the splash's own failed state so the eval names what happened.
        try {
          await page
            .locator('[data-command-altitude]')
            .waitFor({ timeout: 30_000 });
        } catch (error) {
          const paused = await page
            .locator('[data-exawatt-launch][data-failed="true"]')
            .count();
          if (!paused) throw error;
          const label = await page.locator('#startup-label').textContent();
          const detail = await page.locator('#startup-detail').textContent();
          throw new Error(
            `The app never reached the workspace: "${label}. ${detail}". Main ` +
              'threw inside bootstrapCommandSurface; its stderr carries the cause.'
          );
        }
        const workspaceReady = elapsed();
        let staleCachePruned = null;
        if (index === 0 && launchScreenShown) {
          await page.waitForTimeout(400);
          staleCachePruned = !existsSync(staleRendererCache);
          if (!staleCachePruned) {
            throw new Error('Startup did not prune the stale renderer cache');
          }
        }
        const navigation = await page.evaluate(() => {
          const entry = performance.getEntriesByType('navigation')[0];
          return entry
            ? {
                domContentLoaded:
                  Math.round(entry.domContentLoadedEventEnd * 10) / 10,
                load: Math.round(entry.loadEventEnd * 10) / 10,
              }
            : null;
        });
        results.push({
          run: index + 1,
          cache: index === 0 ? 'cold' : 'warm',
          connected,
          firstWindow,
          firstVisible,
          launchScreenShown,
          staleCachePruned,
          workspaceReady,
          navigation,
        });
      },
      { firstWindowMs: 30_000 }
    );
  }
} finally {
  rmSync(userData, { recursive: true, force: true });
}

const summary = {
  executable: packaged.executablePath,
  runs: results,
  medians: {
    connected: median(results.map(result => result.connected)),
    firstWindow: median(results.map(result => result.firstWindow)),
    firstVisible: median(results.map(result => result.firstVisible)),
    workspaceReady: median(results.map(result => result.workspaceReady)),
  },
};

console.log(JSON.stringify(summary, null, 2));
