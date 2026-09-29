#!/usr/bin/env node
/**
 * Helper-death eval (BUG-223, incident 0028): kill this instance's own
 * renderer, GPU and network helpers at once, the set a stray machine-wide
 * `pkill` killed on 2026-09-24, and require the window to come back by itself
 * with every death on the record. Before BUG-223 the window stayed dead until
 * a force quit.
 *
 * Two more moments are covered (BUG-241): a renderer killed while the app is
 * still starting, and a renderer killed during a quit that is then cancelled.
 * Shutdown deliberately leaves a death alone while it owns the processes, so
 * before BUG-241 the cancelled quit left the window black.
 *
 * Kills by PID from `app.getAppMetrics()`, never by pattern: an eval that
 * pattern-killed would be the incident it guards against.
 *
 * Requires the dev server (`pnpm dev`) and a compiled Electron main
 * (`pnpm electron:compile`), like the spine eval.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const userData = mkdtempSync(join(tmpdir(), 'exawatt-helper-death-eval-'));
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
};

/** Re-evaluates `read` in main until `done` holds, or the deadline passes. */
async function until(app, read, done, deadlineMs = 20_000) {
  const deadline = Date.now() + deadlineMs;
  let value = await app.evaluate(read);
  while (!done(value) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    value = await app.evaluate(read);
  }
  return value;
}

/** The main window's renderer and whether it shows a ready workspace. */
async function workspaceState({ BrowserWindow }) {
  const wc = BrowserWindow.getAllWindows()[0]?.webContents;
  if (!wc || wc.isCrashed() || wc.isLoading()) return { ready: false };
  const ready = await wc
    .executeJavaScript(
      "document.querySelector('[data-workspace-stage][data-workspace-ready]') !== null"
    )
    .catch(error => String(error));
  return {
    ready: ready === true,
    detail: ready,
    url: wc.getURL().slice(0, 80),
    renderer: wc.getOSProcessId(),
  };
}

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_TEST_CHECKPOINT_FAILURE: 'cancel',
      EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
    },
  },
  async app => {
    // 1. Killed while starting, from inside main at the first window, so it
    // lands while startup is still navigating to the workspace. Before
    // BUG-241 recovery reloaded the launch screen over that navigation and
    // startup failed with "could not start its local command services".
    const starting = await app.evaluate(async ({ BrowserWindow }) => {
      const pid = BrowserWindow.getAllWindows()[0].webContents.getOSProcessId();
      process.kill(pid, 'SIGKILL');
      return pid;
    });
    // Read through main from here on: Playwright's page stays "crashed"
    // after its renderer dies, whatever the product does next.
    const started = await until(
      app,
      workspaceState,
      state => state.ready,
      45_000
    );
    check(
      'a renderer killed during start comes back and reaches the workspace',
      started.ready && started.renderer !== starting,
      JSON.stringify(started)
    );

    const before = await app.evaluate(async ({ app: a, BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      return {
        renderer: wc.getOSProcessId(),
        helpers: a
          .getAppMetrics()
          .filter(
            m =>
              m.type === 'GPU' ||
              (m.type === 'Utility' && /network/i.test(m.serviceName ?? ''))
          )
          .map(m => m.pid),
      };
    });
    check(
      'found the renderer, GPU and network helpers',
      before.helpers.length >= 2
    );

    for (const pid of [before.renderer, ...before.helpers]) {
      process.kill(pid, 'SIGKILL');
    }

    // 2. The set the stray pkill killed. Recovery is the product's job: this
    // eval never reloads.
    const after = await until(
      app,
      async ({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!wc) return { alive: false };
        const alive = !wc.isCrashed() && !wc.isLoading();
        const image = alive ? await wc.capturePage().catch(() => null) : null;
        const painted = image !== null && !image.isEmpty();
        return { alive, painted, renderer: wc.getOSProcessId() };
      },
      state => state.alive && state.painted
    );
    check(
      'the window reloaded itself onto a new renderer',
      after.alive && after.renderer !== before.renderer
    );
    check('the window paints again', after.painted === true);

    // 3. Killed during a quit the operator then cancels. The renderer is
    // frozen first so it cannot answer the quit's checkpoint; the quit waits
    // on it, the kill lands while shutdown owns the processes, the unanswered
    // checkpoint asks whether to quit anyway, and automation says Cancel
    // (EXAWATT_TEST_CHECKPOINT_FAILURE=cancel).
    const settled = await until(
      app,
      workspaceState,
      state => state.ready,
      45_000
    );
    check('the workspace is ready again before the quit', settled.ready);
    const quitting = await app.evaluate(async ({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0].webContents;
      const send = wc.send.bind(wc);
      globalThis.__helperDeathCheckpointAsked = false;
      wc.send = (channel, ...args) => {
        if (channel === 'app:checkpoint-request') {
          globalThis.__helperDeathCheckpointAsked = true;
        }
        return send(channel, ...args);
      };
      return wc.getOSProcessId();
    });
    process.kill(quitting, 'SIGSTOP');
    await app.evaluate(async ({ app: a }) => a.quit());
    // If the quit went through instead, the app is gone: say so, rather than
    // letting the harness read it as an outside kill and relaunch.
    const quitWentThrough = error => {
      throw new Error(
        `the cancelled quit exited the app instead: ${error.message}`
      );
    };
    const asked = await until(
      app,
      async () => globalThis.__helperDeathCheckpointAsked === true,
      done => done
    ).catch(quitWentThrough);
    check('the quit waits on the frozen renderer’s checkpoint', asked);
    process.kill(quitting, 'SIGKILL');
    const resumed = await until(
      app,
      async ({ BrowserWindow }) => {
        const wc = BrowserWindow.getAllWindows()[0]?.webContents;
        if (!wc) return { alive: false };
        const alive = !wc.isCrashed() && !wc.isLoading();
        const image = alive ? await wc.capturePage().catch(() => null) : null;
        const painted = image !== null && !image.isEmpty();
        return { alive, painted, renderer: wc.getOSProcessId() };
      },
      state => state.alive && state.painted && state.renderer !== quitting,
      30_000
    ).catch(quitWentThrough);
    check(
      'a renderer killed during a cancelled quit comes back when the quit is cancelled',
      resumed.alive && resumed.painted && resumed.renderer !== quitting,
      JSON.stringify(resumed)
    );

    const log = join(userData, 'logs', 'main.jsonl');
    const records = existsSync(log)
      ? readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
    const gone = records.filter(r => r.event === 'renderer.gone');
    check(
      'every renderer death is on the record with its reason and the recovery',
      gone.length === 3 &&
        gone.every(r => r.reason === 'killed') &&
        gone.map(r => r.action).join() === 'reload,reload,none',
      JSON.stringify(gone)
    );
    check(
      'the reload after the cancelled quit is on the record',
      records.some(
        r => r.event === 'renderer.reloaded' && r.after === 'cancelled-shutdown'
      )
    );
    const helpers = records.filter(r => r.event === 'child.gone');
    check(
      'every helper death is on the record',
      helpers.length >= before.helpers.length,
      `${helpers.length} of ${before.helpers.length}`
    );
  },
  // An app that disappears here is the product failing (a recovery that
  // quits, a quit that was not cancelled), never an outside kill to retry.
  { maxMs: 150_000, attempts: 1 }
);

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nhelper-death eval passed');
