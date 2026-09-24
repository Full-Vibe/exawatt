#!/usr/bin/env node
// Opt-in diagnostic, not a delivery gate (BUG-062 / BUG-082). Measures the
// operator's actual ⌘T on THIS machine: real login shell, real CLIs, a
// throwaway profile and one fixture Project, with the registry's in-process
// cache deliberately EXPIRED between samples (it lasts five seconds; the
// probe waits longer). Reports, per ⌘T, when the composer appeared, when the
// setup row left its placeholders, and when Start became pressable. Timing is
// reported, never asserted against the host (BUG-057).
//
// Only status commands run: nothing is started, nothing is billed. The
// operator's real workspace layout is never touched (EXAWATT_USER_DATA).
//
//   pnpm electron:compile
//   pnpm dev -p <port>
//   EXA_BASE=http://localhost:<port> node scripts/composer-registry-cold-probe.mjs
//
// COMPOSER_COLD_PROBE_SAMPLES (default 3) and COMPOSER_COLD_PROBE_OUTPUT
// shape the run. Screenshots of the settling window land beside the report.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
if (!process.env.EXA_BASE) {
  throw new Error('Set EXA_BASE to this checkout\'s dev server.');
}
const samplesWanted = Math.max(
  1,
  Number.parseInt(process.env.COMPOSER_COLD_PROBE_SAMPLES ?? '3', 10)
);
const outputPath =
  process.env.COMPOSER_COLD_PROBE_OUTPUT ??
  join(repo, '.artifacts', 'readiness-probe', 'composer-registry-cold.json');
mkdirSync(dirname(outputPath), { recursive: true });
const { waitForWorkspaceReady, withElectronApp } = await import(
  pathToFileURL(join(repo, 'scripts/lib/electron-eval.mjs')).href
);

const root = mkdtempSync(join(tmpdir(), 'exawatt-readiness-probe-'));
const userData = join(root, 'userData');
const project = join(root, 'project');
const emptyRoots = ['claude-projects', 'codex-sessions', 'grok-sessions'].map(
  name => join(root, name)
);
for (const dir of [userData, project, ...emptyRoots]) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(join(project, 'package.json'), '{}');
// Every registry probe passes through one login-shell chokepoint, which logs
// here under EXAWATT_TEST so shells can be counted per gesture.
const shellLog = join(root, 'login-shells.log');
function shellsLoggedAfter(since) {
  if (!existsSync(shellLog)) return 0;
  return readFileSync(shellLog, 'utf8')
    .split('\n')
    .filter(line => line && Number(line.split('\t')[0]) >= since).length;
}

const report = {
  checkout: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  }).trim(),
  loadavg: loadavg(),
  cacheExpiryWaitMs: 6_500,
  samples: [],
};

/** Arm a frame-sampled probe on the next ⌘T. */
async function arm(page, name) {
  await page.evaluate(name => {
    const probe = { name, started: null };
    window.__readinessProbe = probe;
    const capture = event => {
      if (!(event.key.toLowerCase() === 't' && event.metaKey && !event.altKey))
        return;
      if (probe.started !== null) return;
      document.removeEventListener('keydown', capture, true);
      probe.started = performance.now();
      const frame = now => {
        if (window.__readinessProbe !== probe) return;
        const elapsed = now - probe.started;
        const composer = document.querySelector('[data-agent-composer]');
        if (composer && probe.composerMs === undefined) {
          probe.composerMs = elapsed;
        }
        const row = composer?.querySelector('[data-row-state]');
        if (row && probe.rowState === undefined) {
          probe.rowState = row.getAttribute('data-row-state');
        }
        if (
          row?.getAttribute('data-row-state') === 'ready' &&
          probe.rowReadyMs === undefined
        ) {
          probe.rowReadyMs = elapsed;
          probe.chipsAtReady = composer.querySelectorAll(
            '[data-setup-chip]:not([data-pending])'
          ).length;
        }
        const start = composer?.querySelector('[data-agent-start-button]');
        if (start && !start.disabled && probe.startLiveMs === undefined) {
          probe.startLiveMs = elapsed;
        }
        const status = composer?.querySelector('[data-launcher-status]');
        if (status && probe.statusAtStartLive === undefined && start && !start.disabled) {
          probe.statusAtStartLive = status.textContent;
        }
        if (probe.rowReadyMs !== undefined && probe.startLiveMs !== undefined) {
          probe.done = true;
          return;
        }
        if (elapsed > 30_000) {
          probe.timeout = true;
          probe.done = true;
          return;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    };
    document.addEventListener('keydown', capture, true);
  }, name);
}

async function closeDraft(page) {
  await page.keyboard.press('Meta+KeyW');
  await page.waitForFunction(
    () => document.querySelector('[data-agent-composer]') === null
  );
}

try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_CLAUDE_PROJECTS_ROOT: emptyRoots[0],
        EXAWATT_CODEX_SESSIONS_ROOT: emptyRoots[1],
        EXAWATT_GROK_SESSIONS_ROOT: emptyRoots[2],
        EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
        EXAWATT_TEST_LOGIN_SHELL_LOG: shellLog,
        EXAWATT_WINDOW_MODE: 'inactive',
        EXAWATT_DEV_URL: `${process.env.EXA_BASE}/workspace`,
      },
    },
    async (app, page) => {
      page.setDefaultTimeout(60_000);
      report.errors = [];
      page.on('pageerror', error => report.errors.push(error.message));
      await page.locator('[data-command-altitude]').waitFor();
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [dir],
          bookmarks: [],
        });
      }, project);
      await page.keyboard.press('Meta+KeyN');
      await page.locator('[data-project-opener]').waitFor();
      const openedAt = Date.now();
      await page
        .getByRole('button', { name: 'Browse Folder', exact: true })
        .click();
      await page.locator('[data-agent-composer]').waitFor();
      await page
        .locator('[data-agent-start-button]:not([disabled])')
        .waitFor({ timeout: 120_000 });
      report.firstComposer = {
        note: 'Project open → Start live: registry cold AND every model catalog cold for this cwd.',
        startLiveMs: Date.now() - openedAt,
        loginShells: shellsLoggedAfter(openedAt),
      };
      // Leave the composer for a shell so ⌘T mounts a fresh draft composer.
      await page.keyboard.press('Meta+Alt+KeyT');
      await page.waitForFunction(() =>
        document.activeElement?.classList.contains('xterm-helper-textarea')
      );
      for (let index = 0; index < samplesWanted; index += 1) {
        // Let the in-process registry cache expire.
        await page.waitForTimeout(report.cacheExpiryWaitMs);
        await arm(page, `registry-cold-${index + 1}`);
        const pressedAt = Date.now();
        await page.keyboard.press('Meta+KeyT');
        await page.waitForTimeout(400);
        await page.screenshot({
          path: join(dirname(outputPath), `settling-${index + 1}.png`),
        });
        await page.waitForFunction(() => window.__readinessProbe?.done);
        const sample = await page.evaluate(() => window.__readinessProbe);
        // Let a background revalidation, if any, finish before counting.
        await page.waitForTimeout(8_000);
        report.samples.push({
          ...sample,
          loginShellsAfterKeyT: shellsLoggedAfter(pressedAt),
          loadavg: loadavg(),
        });
        await page.screenshot({
          path: join(dirname(outputPath), `ready-${index + 1}.png`),
        });
        await closeDraft(page);
        await page.waitForFunction(() =>
          document.activeElement?.classList.contains('xterm-helper-textarea')
        );
      }
    },
    { maxMs: 400_000, firstWindowMs: 45_000, attempts: 1 }
  );
  // A fresh PROCESS with the same profile: the in-process cache is gone and
  // only the persisted memory can paint the composer before the first probe.
  const restartLaunchedAt = Date.now();
  await withElectronApp(
    {
      args: ['.'],
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_CLAUDE_PROJECTS_ROOT: emptyRoots[0],
        EXAWATT_CODEX_SESSIONS_ROOT: emptyRoots[1],
        EXAWATT_GROK_SESSIONS_ROOT: emptyRoots[2],
        EXAWATT_TEST_QUIT_RESPONSES: 'confirm,confirm,confirm',
        EXAWATT_TEST_LOGIN_SHELL_LOG: shellLog,
        EXAWATT_WINDOW_MODE: 'inactive',
        EXAWATT_DEV_URL: `${process.env.EXA_BASE}/workspace`,
      },
    },
    async (app, page) => {
      page.setDefaultTimeout(60_000);
      // The restored layout lands on the Shell tab; ⌘T mounts a fresh draft
      // composer, which is the operator's gesture after a restart. Pressed
      // before hydration it opens the Project chooser instead (BUG-221).
      await waitForWorkspaceReady(page);
      await arm(page, 'restart-first-keyT');
      const pressedAt = Date.now();
      await page.keyboard.press('Meta+KeyT');
      await page.waitForTimeout(150);
      await page.screenshot({
        path: join(dirname(outputPath), 'restart-first-paint.png'),
      });
      await page.waitForFunction(() => window.__readinessProbe?.done);
      const sample = await page.evaluate(() => window.__readinessProbe);
      report.restart = {
        note: 'App relaunched on the same profile, first ⌘T: the composer paints from the persisted memory before this process has probed anything.',
        launchToKeyTMs: pressedAt - restartLaunchedAt,
        ...sample,
      };
      await page.screenshot({
        path: join(dirname(outputPath), 'restart-start-live.png'),
      });
      await page.waitForTimeout(8_000);
      report.restart.loginShellsWithin8s = shellsLoggedAfter(pressedAt);
      report.restart.statusAfterRevalidation = await page
        .locator('[data-launcher-status]')
        .textContent();
      // Settings → Agent Sources on the same warm memory.
      await page.evaluate(() => {
        window.location.assign('/settings');
      });
      await page
        .locator('[data-agent-source-registry-status]')
        .waitFor({ timeout: 60_000 });
      await page.screenshot({
        path: join(dirname(outputPath), 'settings-first-paint.png'),
      });
      report.restart.settingsFirstPaintStatus = await page
        .locator('[data-agent-source-registry-status]')
        .getAttribute('data-agent-source-registry-status');
      await page
        .locator('[data-agent-source-registry-status="live"]')
        .waitFor({ timeout: 60_000 });
      await page.screenshot({
        path: join(dirname(outputPath), 'settings-live.png'),
      });
    },
    { maxMs: 400_000, firstWindowMs: 45_000, attempts: 1 }
  );
} catch (error) {
  report.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  rmSync(root, { recursive: true, force: true });
}
