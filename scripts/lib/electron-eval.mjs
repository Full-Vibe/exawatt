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
import { realpathSync } from 'node:fs';
import { assertNodePtyBuilt } from './native-preflight.mjs';
import { assertNoPackagingSnapshot } from './electron-runtime-deps.mjs';

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
/** With parallel agent worktrees, the port an eval points at may serve a
 *  DIFFERENT checkout — the eval then silently exercises the wrong code.
 *  Every dev-server-backed launch verifies /api/dev-identity (dev-only
 *  route) against the tree under test and refuses a mismatch. */
export async function assertDevServerServesTree(devUrl, evalRoot) {
  let origin;
  try {
    origin = new URL(devUrl).origin;
  } catch {
    return; // not a URL (packaged-app eval) — nothing to verify
  }
  let response;
  try {
    // generous timeout: next dev compiles the route on first hit
    response = await fetch(`${origin}/api/dev-identity`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      `No dev server is answering at ${origin} — start one from ` +
        `${evalRoot} (pnpm dev -p <port>) and point EXA_BASE at it.`
    );
  }
  if (response.status === 404) {
    // an older tree without the identity route (or a prod server): the
    // one legitimately unverifiable case — tolerate with a warning
    console.warn(
      `[harness] ${origin}/api/dev-identity returned 404 — ` +
        'cannot verify which checkout this dev server serves'
    );
    return;
  }
  if (!response.ok) {
    throw new Error(
      `The dev server at ${origin} is unhealthy ` +
        `(/api/dev-identity returned ${response.status}) — often a stale ` +
        `server whose worktree was deleted. Kill the listener on that ` +
        `port and start pnpm dev from ${evalRoot}.`
    );
  }
  const { repoRoot } = await response.json();
  const served = realpathSync(repoRoot);
  const expected = realpathSync(evalRoot);
  if (served !== expected) {
    throw new Error(
      `WRONG TREE: the dev server at ${origin} serves\n  ${served}\n` +
        `but this eval is testing\n  ${expected}\n` +
        `Start pnpm dev from the tree under test on a free port and set EXA_BASE.`
    );
  }
}

export async function withElectronApp(launchOpts, body, opts = {}) {
  const maxMs = opts.maxMs ?? 90_000;
  const firstWindowMs = opts.firstWindowMs ?? 25_000;
  const gracefulMs = opts.gracefulMs ?? 8_000;
  const evalRoot = launchOpts.cwd ?? process.cwd();
  // fail BEFORE launch with the real cause, not a per-spawn
  // "posix_spawnp failed." banner deep inside the app
  assertNodePtyBuilt(evalRoot);
  const devUrl = launchOpts.env?.EXAWATT_DEV_URL;
  if (devUrl) {
    await assertDevServerServesTree(devUrl, evalRoot);
    // A dev launch must resolve THIS checkout's @exawatt/core, not a packaging
    // snapshot left behind by an earlier build (BUG-016). Fail before launch
    // with the real cause instead of after it, as a paused command engine.
    await assertNoPackagingSnapshot(evalRoot);
  }
  sweepOrphans();

  let app;
  try {
    app = await electron.launch({ timeout: 30_000, ...launchOpts });
  } catch (error) {
    if (!String(error?.message ?? error).includes('Process failed to launch')) {
      throw error;
    }
    // a prior SIGKILLed run's orphans can poison the next launch even
    // after one sweep — sweep again and retry ONCE before failing
    console.error(
      '[harness] Electron failed to launch — sweeping orphans and retrying once'
    );
    sweepOrphans();
    await new Promise(resolve => setTimeout(resolve, 1500));
    app = await electron.launch({ timeout: 30_000, ...launchOpts });
  }
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

/**
 * Open a shell Session through the CURRENT launcher contract (ENG-016 D49):
 * the composer's "All engines and models" catalog lists Shell as an explicit
 * Project tool ("Shell in <project>"). The pre-D49 "Open shell in <project>"
 * button this replaced no longer exists in src.
 *
 * Expects the Agent composer to be reachable on the page; expands it from the
 * summon toggle when collapsed.
 */
export async function openShellFromLauncher(page) {
  if ((await page.locator('[data-agent-composer]').count()) === 0) {
    await page.locator('[data-composer-toggle][aria-expanded="false"]').click();
    await page.locator('[data-agent-composer]').waitFor();
  }
  // The catalog trigger stays DISABLED until the agent-source registry
  // answers. On a cold launch that enumeration can outlast a page's default
  // timeout, which surfaces as an opaque "element is not enabled" click
  // failure rather than "the registry is still loading".
  await page
    .locator('[data-setup-catalog-trigger]:not([disabled])')
    .waitFor({ timeout: 90_000 });
  await page.getByRole('button', { name: 'All engines and models' }).click();
  await page.locator('[data-all-launch-configurations]').waitFor();
  await page.getByRole('button', { name: /^Shell in / }).click();
}
