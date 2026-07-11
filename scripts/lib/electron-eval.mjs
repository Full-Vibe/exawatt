// Robust Electron eval harness (ENG-015 S5).
//
// WHY THIS EXISTS: bounding an Electron eval with an external `timeout N node
// eval.mjs` SIGKILLs the node harness before Playwright's app.close() runs,
// which ORPHANS the whole Electron process tree (it reparents to launchd,
// PPID=1, and keeps running). Orphans accumulate across runs and starve
// GPU/window-server resources until new launches fail with "Process failed to
// launch" / firstWindow timeouts / kill EPERM. Diagnosed 2026-07-10.
//
// RULES for Electron evals:
//   - Do NOT wrap the eval in `timeout` (or any external SIGKILL). Use the
//     in-script `maxMs` watchdog here instead — it force-closes cleanly.
//   - Always drive the app through `withElectronApp`, which GUARANTEES the
//     Electron tree is killed on success, hang, throw, or signal.
//   - Run evals SERIALLY; never overlap two Electron launches from the harness.

import { _electron as electron } from 'playwright-core';
import { execSync } from 'node:child_process';

/** Kill any orphaned exawatt/playwright Electron left by a prior SIGKILLed run,
 *  so a stale orphan can't poison this launch. Scoped to playwright-launched
 *  Electron in an exawatt checkout — never touches the operator's own app. */
export function sweepOrphans() {
  try {
    execSync(
      "pkill -9 -f 'exawatt.*node_modules/.pnpm/electron.*playwright-core' 2>/dev/null || true",
      { stdio: 'ignore' }
    );
  } catch {
    /* nothing to sweep */
  }
}

/**
 * Launch the packaged/dev Electron app, run `body(app, page)`, and GUARANTEE
 * the Electron process tree is torn down afterward — on success, throw, hang,
 * or Ctrl-C. Returns whatever `body` returns.
 *
 * @param {import('playwright-core').ElectronApplication['launch'] extends never ? never : object} launchOpts
 * @param {(app: any, page: any) => Promise<any>} body
 * @param {{ maxMs?: number, firstWindowMs?: number }} [opts]
 */
export async function withElectronApp(launchOpts, body, opts = {}) {
  const maxMs = opts.maxMs ?? 90_000;
  const firstWindowMs = opts.firstWindowMs ?? 25_000;
  const gracefulMs = opts.gracefulMs ?? 8_000;
  sweepOrphans();

  const app = await electron.launch({ timeout: 30_000, ...launchOpts });
  const pid = app.process().pid;
  let done = false;

  const hardKill = () => {
    try {
      if (pid) process.kill(pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
    sweepOrphans();
  };

  // Single teardown path for success / hang / signal. Always try a bounded
  // graceful app.close() FIRST: only the Electron main can reap its own
  // Chromium child processes (a bare SIGKILL on main is uncatchable, so the
  // helpers would reparent to launchd and our playwright-scoped sweep — which
  // matches only the main's argv — wouldn't catch them). hardKill is the
  // backstop for a wedged renderer where app.close() itself hangs.
  let watchdog;
  const shutdown = async () => {
    if (done) return;
    done = true;
    if (watchdog) clearTimeout(watchdog);
    await Promise.race([
      app.close().catch(() => {}),
      new Promise((r) => setTimeout(r, gracefulMs)),
    ]);
    hardKill();
  };

  // watchdog REPLACES the external `timeout`: on a hang it tears down from
  // inside the process (graceful-then-kill) so nothing is orphaned.
  watchdog = setTimeout(() => {
    if (done) return;
    console.error(`[harness] watchdog fired after ${maxMs}ms — force-closing`);
    void shutdown().finally(() => process.exit(2));
  }, maxMs);
  // Stay registered through teardown so a Ctrl-C mid-close still routes through
  // the graceful path instead of the default handler orphaning the tree.
  const onSignal = () => {
    void shutdown().finally(() => process.exit(130));
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const page = await app.firstWindow({ timeout: firstWindowMs });
    return await body(app, page);
  } finally {
    await shutdown();
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
