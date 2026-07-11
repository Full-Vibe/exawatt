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
  // watchdog REPLACES the external `timeout`: on a hang it force-closes and
  // exits, but from inside the process so nothing is orphaned.
  const watchdog = setTimeout(() => {
    if (!done) {
      console.error(`[harness] watchdog fired after ${maxMs}ms — force-closing`);
      hardKill();
      process.exit(2);
    }
  }, maxMs);
  const onSignal = () => {
    hardKill();
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    const page = await app.firstWindow({ timeout: firstWindowMs });
    return await body(app, page);
  } finally {
    done = true;
    clearTimeout(watchdog);
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    // graceful close, then belt-and-suspenders hard kill (app.close() can hang
    // if the renderer is wedged) + a final orphan sweep.
    await Promise.race([
      app.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 8_000)),
    ]);
    hardKill();
  }
}
