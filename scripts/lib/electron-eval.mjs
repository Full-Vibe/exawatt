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
import { execFileSync } from 'node:child_process';
import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertCompiledElectronMain,
  assertNodePtyBuilt,
} from './native-preflight.mjs';
import { assertNoPackagingSnapshot } from './electron-runtime-deps.mjs';

/** Kill any orphaned playwright Electron left by a prior SIGKILLed run of THIS
 *  worktree, so a stale orphan can't poison this launch.
 *
 *  Scoped to the calling tree on purpose. The pattern used to be
 *  `exawatt.*node_modules/.pnpm/electron.*playwright-core`, which matches every
 *  sibling agent worktree's Electron too — so a second agent starting an
 *  Electron eval SIGKILLed the first agent's live app mid-run, surfacing as an
 *  unexplained "Target page, context or browser has been closed" in a run that
 *  had done nothing wrong. Four concurrent worktrees are the normal state here
 *  (see AGENTS.md), so a machine-wide sweep is never the right scope. */
export function sweepOrphans(root = process.cwd()) {
  // pkill takes an extended regex and a checkout path can contain regex
  // metacharacters, so escape the literal part. No shell: a path is data.
  const escaped = realpathOrSelf(root).replace(/[^A-Za-z0-9/_-]/g, '\\$&');
  try {
    execFileSync(
      'pkill',
      ['-9', '-f', `${escaped}/node_modules/.pnpm/electron.*playwright-core`],
      { stdio: 'ignore' }
    );
  } catch {
    /* pkill exits non-zero when nothing matched — nothing to sweep */
  }
  sweepOrphanedRendererServers();
}

/** Kill packaged-renderer `next-server` children orphaned by a SIGKILLed run.
 *
 *  A packaged app spawns its Next standalone server as a child
 *  (`electron/main/main.ts`), and shuts it down from `before-quit`. That path
 *  is correct and runs on a normal quit. It does NOT run when the Electron
 *  main is SIGKILLed, which is exactly what a force-closed or externally
 *  killed eval does: the server reparents to init and survives, holding a
 *  loopback port, ~70 MB, and — because a foreground Node process registers
 *  with LaunchServices — its own Dock icon.
 *
 *  Found 2026-08-17 with 26 such orphans alive at once, some 19 hours old,
 *  ~1.8 GB resident, 78 phantom `Exawatt Community` Dock registrations, and a
 *  load average near 300. That contention is itself a likely contributor to
 *  BUG-050's lifecycle-eval failure and to named-test flakes under load.
 *
 *  Scoped by the child's WORKING DIRECTORY, which is always inside this run's
 *  own temp tree, so it can never reach a sibling agent's live app — the same
 *  scoping lesson the Electron sweep above records. */
export function sweepOrphanedRendererServers(prefixes = ORPHAN_CWD_PREFIXES) {
  let pids;
  try {
    pids = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], {
      encoding: 'utf8',
    })
      .split('\n')
      .map(line => line.trim().split(/\s+/))
      .filter(([, ppid, ...rest]) => ppid === '1' && rest.join(' ').includes('next-server'))
      .map(([pid]) => Number(pid))
      .filter(Number.isInteger);
  } catch {
    return 0;
  }
  let swept = 0;
  for (const pid of pids) {
    let cwd = '';
    try {
      cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .split('\n')
        .find(line => line.startsWith('n')) ?? '';
    } catch {
      continue;
    }
    if (!prefixes.some(prefix => cwd.includes(prefix))) continue;
    try {
      process.kill(pid, 'SIGTERM');
      swept += 1;
    } catch {
      /* already gone */
    }
  }
  return swept;
}

/** Temp-directory markers every packaged eval uses for its scratch state. A
 *  server whose cwd is under one of these belongs to a finished eval run. */
const ORPHAN_CWD_PREFIXES = Object.freeze([
  'exawatt-lifecycle-',
  'exawatt-observatory-',
  'exawatt-electron-',
  'exawatt-packaged-',
]);

function realpathOrSelf(value) {
  try {
    return realpathSync(value);
  } catch {
    return value;
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
  const { repoRoot, distributionDigest } = await response.json();
  const served = realpathSync(repoRoot);
  const expected = realpathSync(evalRoot);
  if (served !== expected) {
    throw new Error(
      `WRONG TREE: the dev server at ${origin} serves\n  ${served}\n` +
        `but this eval is testing\n  ${expected}\n` +
        `Start pnpm dev from the tree under test on a free port and set EXA_BASE.`
    );
  }
  let expectedDistributionDigest;
  try {
    expectedDistributionDigest = readFileSync(
      join(evalRoot, '.exawatt-build', 'distribution.sha256'),
      'utf8'
    ).trim();
  } catch {
    throw new Error(
      `No prepared distribution exists in ${evalRoot}; start its dev server with pnpm dev before running an Electron eval.`
    );
  }
  if (distributionDigest !== expectedDistributionDigest) {
    throw new Error(
      `WRONG DISTRIBUTION: the dev server at ${origin} serves ${distributionDigest ?? 'none'}, ` +
        `but Electron is testing ${expectedDistributionDigest}. Restart pnpm dev from ${evalRoot}.`
    );
  }
}


/** ONE Electron eval at a time, ACROSS worktrees.
 *
 *  This file's own rules have always said "run evals SERIALLY; never overlap
 *  two Electron launches" — but that was only ever enforced inside a single
 *  run. With several agent worktrees on one machine (AGENTS.md), overlapping
 *  Electron evals fight over the window server and each other's orphan sweeps,
 *  which is how a healthy run dies at an arbitrary step. The lock is advisory
 *  and fail-open: a stale holder is reclaimed, and a long wait proceeds
 *  anyway rather than deadlocking a landing behind another agent. */
const ELECTRON_EVAL_LOCK = join(tmpdir(), 'exawatt-electron-eval.lock');
const LOCK_STALE_MS = 20 * 60_000;

function readLock() {
  try {
    return JSON.parse(readFileSync(ELECTRON_EVAL_LOCK, 'utf8'));
  } catch {
    return null;
  }
}

function lockIsStale(held) {
  if (!held) return true;
  if (Date.now() - (held.at ?? 0) > LOCK_STALE_MS) return true;
  try {
    process.kill(held.pid, 0);
    return false;
  } catch {
    return true; // holder is gone
  }
}

async function withElectronEvalLock(root, run, waitMs = 8 * 60_000) {
  const deadline = Date.now() + waitMs;
  let owned = false;
  for (;;) {
    try {
      const fd = openSync(ELECTRON_EVAL_LOCK, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, root, at: Date.now() }));
      closeSync(fd);
      owned = true;
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') break; // never let locking fail a run
      const held = readLock();
      if (lockIsStale(held)) {
        rmSync(ELECTRON_EVAL_LOCK, { force: true });
        continue;
      }
      if (Date.now() > deadline) {
        console.warn(
          `[harness] another Electron eval (pid ${held?.pid}, ${held?.root}) still holds ` +
            'the machine lock — proceeding anyway'
        );
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
  try {
    return await run();
  } finally {
    if (owned && readLock()?.pid === process.pid) {
      rmSync(ELECTRON_EVAL_LOCK, { force: true });
    }
  }
}

/** An Electron app that DISAPPEARS mid-run did not fail the eval's contract —
 *  something outside the run killed it. The known cause on this machine is a
 *  sibling agent worktree still running the pre-2026-08-16 machine-wide orphan
 *  sweep, which `pkill -9`s every exawatt playwright Electron including ours;
 *  it will keep happening until every checkout picks up the scoped sweep, and
 *  the same shape occurs whenever anything else kills the tree. Distinguish it
 *  so the harness retries once instead of reporting a product regression. */
function isExternalTeardown(error) {
  const message = String(error?.message ?? error);
  return (
    message.includes('Target page, context or browser has been closed') ||
    message.includes('Target closed') ||
    message.includes('browserContext.close') ||
    message.includes('Electron app is closed')
  );
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
  // The mirror of that check: `electron .` needs the compiled main to exist at
  // all. Its absence produces a bare "Process failed to launch!" that names
  // nothing, so a dev launch states the cause before it happens.
  if (!launchOpts.executablePath) assertCompiledElectronMain(evalRoot);

  const attempts = opts.attempts ?? 6;
  return withElectronEvalLock(evalRoot, async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await runElectronAttempt({
          launchOpts,
          body,
          evalRoot,
          maxMs,
          firstWindowMs,
          gracefulMs,
        });
      } catch (error) {
        if (attempt >= attempts || !isExternalTeardown(error)) throw error;
        console.error(
          `[harness] the Electron app disappeared mid-run (attempt ${attempt}/${attempts}) — ` +
            'something outside this run killed it; relaunching'
        );
        // A relaunch must start from the same state the first attempt did, or
        // the retry silently exercises a different app (a Project already open,
        // a tab already selected). Only ever reset a throwaway temp profile.
        resetThrowawayUserData(launchOpts.env?.EXAWATT_USER_DATA);
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(2_000 * 2 ** (attempt - 1), 20_000))
        );
      }
    }
  });
}

function resetThrowawayUserData(userData) {
  if (!userData) return;
  const temp = realpathOrSelf(tmpdir());
  if (!realpathOrSelf(userData).startsWith(`${temp}/`)) return;
  rmSync(userData, { recursive: true, force: true });
}

async function runElectronAttempt({
  launchOpts,
  body,
  evalRoot,
  maxMs,
  firstWindowMs,
  gracefulMs,
}) {
  sweepOrphans(evalRoot);

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
    sweepOrphans(evalRoot);
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
    sweepOrphans(evalRoot);
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
      new Promise(r => setTimeout(r, gracefulMs)),
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
 * The New Agent launcher's DRIVING CONTRACT, stated once (ENG-016 D49).
 *
 * Nine eval scripts used to reach into the composer with their own selectors.
 * D49 redrew that surface and the scripts rotted one at a time, silently: the
 * pre-D49 Agent Source `Select` was left in the DOM behind `hidden` instead of
 * being deleted, so `getByLabel('Agent Source')` kept RESOLVING — to dead UI —
 * and failed 25 seconds later on visibility, far from the cause (BUG-010,
 * BUG-011, BUG-014). Every driver an eval needs now lives here, so the next
 * launcher change breaks ONE helper loudly instead of rotting nine scripts
 * quietly.
 *
 * The product's own hooks are the contract: `[data-agent-composer]`,
 * `[data-setup-drawer-handle]`, `[data-setup-detail]`, `[data-detail-axis]`,
 * `[data-option-menu-trigger]`, `[data-all-launch-configurations]`,
 * `[data-launcher-start]`. An eval that hand-rolls its own selector around
 * them is the defect this module exists to prevent.
 */

/** The composer is summoned, not permanent (D18) — expand it when collapsed.
 *  Matched by its own hook rather than its name: the collapsed toggle does not
 *  always carry `aria-expanded`, and "New Agent" also matches a TAB called
 *  "New agent" plus that tab's close button, so a name query is three ways
 *  ambiguous the moment a draft tab exists. */
export async function summonComposer(page) {
  if ((await page.locator('[data-agent-composer]').count()) > 0) return;
  const toggle = page.locator('[data-composer-toggle]').first();
  if ((await toggle.count()) > 0) await toggle.click();
  else
    await page.getByRole('button', { name: 'New Agent', exact: true }).click();
  await page.locator('[data-agent-composer]').waitFor();
}

/**
 * Open the launcher's "All engines and models" catalog. D49 made it the home
 * for every setup outside the recommended row AND for the launch options —
 * worktree, branch, roadmap item, Name setup… — that used to sit in the second
 * control row it replaced.
 */
export async function openLaunchCatalog(page) {
  await summonComposer(page);
  const catalog = page.locator('[data-all-launch-configurations]');
  if (await catalog.isVisible().catch(() => false)) return catalog;
  await waitForLauncherToSettle(page);
  await page.getByRole('button', { name: 'All engines and models' }).click();
  await catalog.waitFor();
  return catalog;
}

/**
 * Wait for the launcher to stop settling.
 *
 * Its controls stay DISABLED until the Agent Source registry answers for every
 * installed harness. On a cold launch — or a machine running two dozen agent
 * worktrees — that enumeration outlasts a page's default timeout, and the
 * failure surfaces as an opaque "element is not enabled" rather than "the
 * registry is still loading". One explicit, generously bounded wait, in the
 * one place every launcher driver goes through.
 */
export async function waitForLauncherToSettle(page) {
  await page
    .locator('[data-setup-catalog-trigger]:not([disabled])')
    .waitFor({ timeout: 90_000 });
}

/**
 * Open a shell Session through the CURRENT launcher contract: the catalog
 * lists Shell as an explicit Project tool ("Shell in <project>"). The pre-D49
 * "Open shell in <project>" button this replaced no longer exists in src.
 */
export async function openShellFromLauncher(page) {
  await openLaunchCatalog(page);
  await page.getByRole('button', { name: /^Shell in / }).click();
}

/** Declare the roadmap item a launch will work on (ENG-017 S4). The control
 *  moved into the catalog when D49 deleted the second control row. */
export async function declareRoadmapItem(page, itemId) {
  await openLaunchCatalog(page);
  await page.selectOption(
    '[data-all-launch-configurations] select[aria-label="Roadmap item this session will work on"]',
    itemId
  );
}

/** Open the setup drawer that ribbons out of the selected chip, where Engine,
 *  Model, Thinking and Permission live. Idempotent. */
export async function openSetupDrawer(page) {
  await summonComposer(page);
  const open = page.locator('[data-setup-detail][data-open="true"]');
  if (await open.isVisible().catch(() => false)) return open;
  // The handle is disabled until the launcher settles on a selectable setup,
  // so waiting for it to be ENABLED is what keeps an Agent Source registry
  // problem from surfacing as an unexplained click timeout.
  await waitForLauncherToSettle(page);
  await page
    .locator('[data-setup-drawer-handle]:not([disabled])')
    .waitFor({ timeout: 90_000 });
  const handle = page.locator('[data-setup-drawer-handle]');
  if ((await handle.getAttribute('aria-expanded')) !== 'true') {
    await handle.click();
  }
  await open.waitFor({ state: 'visible' });
  return open;
}

/** One drawer axis's OptionMenu trigger. Its accessible name is
 *  `<Axis>: <selected>`, which is what an assertion should read. */
export function launcherAxis(page, axisId) {
  return page.locator(
    `[data-detail-axis="${axisId}"] [data-option-menu-trigger]`
  );
}

/** The label currently selected on an axis, e.g. `Claude Code` for `engine`. */
export async function launcherAxisValue(page, axisId) {
  await openSetupDrawer(page);
  const trigger = launcherAxis(page, axisId);
  await trigger.waitFor({ state: 'visible' });
  return (await trigger.innerText()).trim();
}

/** Choose an option on a drawer axis by its visible label. */
export async function chooseLauncherAxis(page, axisId, optionName) {
  await openSetupDrawer(page);
  const trigger = launcherAxis(page, axisId);
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  await page.getByRole('option', { name: optionName }).first().click();
  await trigger.waitFor({ state: 'visible' });
}

/** Select the engine a new Agent will run on. Replaces the pre-D49
 *  `getByLabel('Agent Source')` Select, which D49 left hidden and dead. */
export function selectLauncherEngine(page, engineLabel) {
  return chooseLauncherAxis(page, 'engine', engineLabel);
}

/** The selected setup chip. Its accessible name states the whole setup —
 *  role, engine, model, variant, vendor, thinking — which is what "the
 *  composer opened preselected on X" should actually assert. */
export function selectedLauncherSetup(page) {
  return page.locator('[data-setup-chip][data-selected]');
}

/**
 * Start an Agent through the shipped launcher: pick the engine when one is
 * named, type the first task when one is given, then Start.
 *
 * Start is blocked — with a stated reason — for an engine whose source
 * publishes no model (D49 finding 13). A fixture harness that answers only
 * `--version` therefore cannot launch, and that is the product being correct,
 * not the eval being wrong: the fixture owes the model-catalog probe. See
 * `scripts/lib/harness-probe-fixture.mjs`. Reporting the stated reason here is
 * what keeps that from arriving as a bare disabled-button timeout.
 */
export async function startAgentFromLauncher(page, options = {}) {
  const { engine = null, task = '' } = options;
  await summonComposer(page);
  if (engine) await selectLauncherEngine(page, engine);
  if (task) {
    await page.getByLabel('Initial task for the new Agent').fill(task);
  }
  const start = page.locator('[data-launcher-start]');
  await start.waitFor({ state: 'visible' });
  if (await start.isDisabled()) {
    const reason = await page
      .locator('[data-agent-launcher] [role="status"]')
      .first()
      .innerText()
      .catch(() => '');
    throw new Error(
      `The launcher refuses to start${engine ? ` ${engine}` : ''}: ` +
        `${reason || 'Start is disabled and stated no reason'}`
    );
  }
  await start.click();
}
