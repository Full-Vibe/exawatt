// BUG-246. The landing owns the dev server its surface gates read.
//
// Agents point `EXA_BASE` at their worktree's `pnpm dev`, and the landing
// rebases that worktree: before admission when the author rebased by hand,
// and at the queue head whenever `origin/master` moved. Turbopack under a
// live server keeps serving what it had compiled into `.next/dev` from the
// old tree. The BUG-244 landing failed `eval:electron:delegation` on its
// second attempt and passed after a clean restart; BUG-212's work saw stale
// CSS turn `eval:navigation-paint` red after a rebase; in August a route
// deleted under a live server panicked Turbopack. Gate evidence from such a
// server describes a tree that is not the one being landed.
//
// So before a gate that reads the dev server runs, the landing asks the
// server which commit it started from (`/api/dev-identity`'s `sourceHead`)
// and compares it with HEAD. A server started on an ancestor of HEAD, with
// every path changed since then one of the change's own, is trusted: those
// edits reached it through HMR while the author worked. Anything else (a
// rebase, a merge, an unknown start commit, a dead or unhealthy server) is
// restarted: stop the listener, clear `.next/dev`, recompile the Electron
// main when its sources moved, start `pnpm dev` on the same port, and wait
// until the server names this worktree and HEAD.
//
// The landing restarts only a server it can prove is this worktree's own: a
// local port with no listener, or whose listeners run from this worktree.
// Any other server is verified and never touched, and a gate is refused
// rather than run against a server that cannot show it serves HEAD.
import { execFile, spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
} from 'node:fs';
import { readlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  DEV_IDENTITY,
  isPortFree,
  readDevServerIdentity,
  servesCheckout,
} from './dev-server-identity.mjs';

const execFileAsync = promisify(execFile);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const READY_SECONDS_ENV = 'EXAWATT_AGENT_LAND_SERVER_READY_SECONDS';
const DEFAULT_READY_MS = 240_000;
const STOP_ESCALATE_MS = 10_000;
const STOP_GIVE_UP_MS = 30_000;
const POLL_MS = 250;

/** Paths `pnpm electron:compile` reads: a move here makes `dist-electron`
 *  describe a tree that is no longer checked out. */
const ELECTRON_MAIN_INPUT = /^(?:electron|packages\/core)\/(?!.*\.test\.ts$)/u;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function git(root, ...args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

function realpathOrNull(file) {
  try {
    return realpathSync(file);
  } catch {
    return null;
  }
}

/**
 * Is a server that started at `sourceHead` stale for HEAD?
 *
 * Fresh only when it started on this exact tree, or on an ancestor of HEAD
 * with every path changed since then among `ownPaths` (the change's own
 * edits, which HMR delivered as they were written). A rebase rewrites
 * history, a merge brings in paths the change does not own, and an unknown
 * start commit proves nothing, so each of those is stale.
 */
export async function serverStaleness(root, { sourceHead, ownPaths }) {
  if (!sourceHead) {
    return { stale: true, reason: 'unstamped', movedPaths: null };
  }
  let movedPaths;
  let ancestor;
  try {
    const [from, to] = await Promise.all([
      git(root, 'rev-parse', '--verify', `${sourceHead}^{tree}`),
      git(root, 'rev-parse', '--verify', 'HEAD^{tree}'),
    ]);
    if (from === to) return { stale: false };
    movedPaths = (await git(root, 'diff', '--name-only', sourceHead, 'HEAD'))
      .split('\n')
      .filter(Boolean);
    ancestor = await git(
      root,
      'merge-base',
      '--is-ancestor',
      sourceHead,
      'HEAD'
    )
      .then(() => true)
      .catch(error => {
        if (error?.code === 1) return false;
        throw error;
      });
  } catch {
    // A start commit this checkout cannot read is not evidence of freshness.
    return { stale: true, reason: 'unknown-commit', movedPaths: null };
  }
  if (!ancestor) return { stale: true, reason: 'rebased', movedPaths };
  const own = new Set(ownPaths);
  if (movedPaths.some(file => !own.has(file))) {
    return { stale: true, reason: 'merged', movedPaths };
  }
  return { stale: false };
}

/** PIDs listening on `port`; null when that cannot be determined, which is
 *  never read as "nobody". */
async function listeningPids(port) {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ]);
    return [...new Set(stdout.split('\n').filter(Boolean).map(Number))];
  } catch (error) {
    // lsof exits 1 with no output when nothing matches: a real zero.
    if (error?.code === 1 && !String(error.stdout ?? '').trim()) return [];
    return null;
  }
}

async function processCwd(pid) {
  if (process.platform === 'linux') {
    return realpathOrNull(await readlink(`/proc/${pid}/cwd`).catch(() => ''));
  }
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-a',
      '-p',
      String(pid),
      '-d',
      'cwd',
      '-Fn',
    ]);
    const line = stdout.split('\n').find(entry => entry.startsWith('n'));
    return line ? realpathOrNull(line.slice(1)) : null;
  } catch {
    return null;
  }
}

async function processGroup(pid) {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-o',
      'pgid=',
      '-p',
      String(pid),
    ]);
    const pgid = Number(stdout.trim());
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
}

function signal(target, name) {
  try {
    process.kill(target, name);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function targetExists(target) {
  try {
    // Negative targets retain the whole owned group, even after its leader
    // or HTTP listener exits. Closing a socket does not finish cache writes.
    process.kill(target, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

/** Cache removal requires both the listener and every signalled owner to stop.
 * The effect ports let the shutdown contract run without wall-clock tests. */
export async function stopServerTargets(
  port,
  targets,
  {
    portFree = isPortFree,
    exists = targetExists,
    send = signal,
    now = Date.now,
    wait = sleep,
  } = {}
) {
  for (const target of targets) send(target, 'SIGTERM');
  const startedAt = now();
  let escalated = false;
  while (true) {
    const remaining = targets.filter(exists);
    if (remaining.length === 0 && (await portFree(port))) return;
    const waited = now() - startedAt;
    if (!escalated && waited >= STOP_ESCALATE_MS) {
      escalated = true;
      for (const target of remaining) send(target, 'SIGKILL');
    }
    if (waited >= STOP_GIVE_UP_MS) {
      throw new Error(
        `server shutdown incomplete after ${STOP_GIVE_UP_MS / 1_000}s: ` +
          `port ${port}, remaining targets ${remaining.join(', ') || 'none'}`
      );
    }
    await wait(POLL_MS);
  }
}

function refusal(message) {
  const error = new Error(message);
  error.serverRefresh = { kind: 'refused' };
  return error;
}

function failure(message) {
  const error = new Error(message);
  error.serverRefresh = { kind: 'failed' };
  return error;
}

function readyBudgetMs(env) {
  const seconds = Number.parseFloat(env[READY_SECONDS_ENV] ?? '');
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1_000
    : DEFAULT_READY_MS;
}

const REASONS = {
  'not-running': 'is not running',
  unstamped: 'cannot say which commit it started from',
  'unknown-commit': 'started from a commit this checkout cannot read',
  rebased: 'started before a rebase',
  merged: 'started before commits this change does not own',
  [DEV_IDENTITY.UNREACHABLE]: 'holds the port but does not answer',
  [DEV_IDENTITY.UNHEALTHY]: 'answers unhealthy',
  [DEV_IDENTITY.UNVERIFIABLE]: 'cannot name the checkout it serves',
  'wrong-tree': 'runs from this worktree but names another checkout',
};

/**
 * The dev server one landing gates against. `ensureFresh` returns null when
 * the server already serves HEAD (or no `EXA_BASE` is set), the restart's
 * record when it had to restart it, and throws a named refusal or failure
 * otherwise.
 */
export function createLandingDevServer({
  root,
  base,
  run,
  env = process.env,
  log = message => console.log(message),
}) {
  const rootReal = realpathOrNull(root) ?? root;
  const logPath = path.join(root, '.next', 'landing-dev-server.log');

  async function ownership(port) {
    const pids = await listeningPids(port);
    if (pids === null) {
      return {
        owned: false,
        cause: `lsof could not list what listens on port ${port}`,
      };
    }
    if (pids.length === 0) return { owned: true, pids };
    for (const pid of pids) {
      const cwd = await processCwd(pid);
      if (cwd !== rootReal) {
        return {
          owned: false,
          cause: `port ${port} is held by pid ${pid}, running from ${cwd ?? 'a directory it could not read'}`,
        };
      }
    }
    return { owned: true, pids };
  }

  async function stop(port, pids) {
    // `pnpm dev` runs Next in its own process group (run-next-with-
    // distribution.mjs), and `next dev` restarts a `next-server` child that
    // dies alone, so the group is what stops. A group is signalled only when
    // its leader runs from this worktree; otherwise just the listener.
    const own = await processGroup(process.pid);
    const targets = new Set();
    for (const pid of pids) {
      const pgid = await processGroup(pid);
      if (pgid && pgid !== own && (await processCwd(pgid)) === rootReal) {
        targets.add(-pgid);
      } else targets.add(pid);
    }
    await stopServerTargets(port, [...targets]);
    return [...targets];
  }

  async function start(origin, port, head) {
    mkdirSync(path.dirname(logPath), { recursive: true });
    const fd = openSync(logPath, 'a');
    const serverEnv = { ...env };
    // The idle watch (ENG-022 H12) stays on: a gate attaches right after
    // this, and a server the landing leaves behind expires by itself.
    delete serverEnv.EXAWATT_DEV_IDLE_MINUTES;
    let exited = null;
    let child;
    try {
      child = spawn('pnpm', ['dev', '-p', String(port)], {
        cwd: root,
        detached: true,
        stdio: ['ignore', fd, fd],
        env: serverEnv,
      });
    } finally {
      closeSync(fd);
    }
    child.once('error', error => {
      exited = { cause: error.message };
    });
    child.once('exit', (code, name) => {
      exited = {
        cause: `\`pnpm dev\` exited ${name ?? code} before it served`,
      };
    });
    child.unref();
    const deadline = Date.now() + readyBudgetMs(env);
    let last = 'no answer yet';
    while (Date.now() < deadline) {
      if (exited) throw new Error(exited.cause);
      const identity = await readDevServerIdentity(origin, {
        timeoutMs: Math.max(1_000, Math.min(15_000, deadline - Date.now())),
      });
      if (servesCheckout(identity, root) && identity.sourceHead === head) {
        return child.pid;
      }
      last =
        identity.kind === DEV_IDENTITY.IDENTIFIED
          ? `serving ${identity.repoRoot} at ${identity.sourceHead ?? 'an unknown commit'}`
          : identity.kind;
      if (exited) throw new Error(exited.cause);
      await sleep(POLL_MS);
    }
    throw new Error(
      `it did not serve this worktree at ${head.slice(0, 12)} within ${readyBudgetMs(env) / 1_000}s (last: ${last})`
    );
  }

  async function refresh({
    phase,
    gate,
    origin,
    port,
    head,
    reason,
    sourceHead,
    movedPaths,
    pids,
  }) {
    const startedAt = Date.now();
    log(
      `[agent-land] ${phase}: the dev server at ${origin} ${REASONS[reason] ?? reason}; restarting it on ${head.slice(0, 12)} before ${gate}`
    );
    let stopped = [];
    let electronRecompiled = false;
    let pid;
    try {
      if (pids.length > 0) stopped = await stop(port, pids);
      await rm(path.join(root, '.next', 'dev'), {
        recursive: true,
        force: true,
      });
      if (
        existsSync(path.join(root, 'dist-electron', 'main', 'main.js')) &&
        (movedPaths === null ||
          movedPaths.some(file => ELECTRON_MAIN_INPUT.test(file)))
      ) {
        await run('pnpm', ['electron:compile'], root);
        electronRecompiled = true;
      }
      pid = await start(origin, port, head);
    } catch (error) {
      throw failure(
        `the dev server at ${origin} did not come back after the ${phase} refresh: ${error.message.split('\n')[0]}. ` +
          `Its log is ${logPath}. ${gate} did not run.`
      );
    }
    log(
      `[agent-land] ${phase}: the dev server at ${origin} serves ${head.slice(0, 12)} (pid ${pid}${electronRecompiled ? ', Electron main recompiled' : ''})`
    );
    return {
      phase,
      gate,
      reason,
      base: origin,
      fromHead: sourceHead,
      toHead: head,
      movedPaths: movedPaths?.length ?? null,
      stoppedPids: stopped,
      electronRecompiled,
      durationMs: Date.now() - startedAt,
    };
  }

  return {
    async ensureFresh({ phase, gate, ownPaths }) {
      // No base: the gate chooses its own target, exactly as before.
      if (!base) return null;
      let url;
      try {
        url = new URL(base);
      } catch {
        throw refusal(
          `refusing to run ${gate}: EXA_BASE=${base} is not a URL.`
        );
      }
      const origin = url.origin;
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      const head = await git(root, 'rev-parse', 'HEAD');
      const owner = LOCAL_HOSTS.has(url.hostname)
        ? await ownership(port)
        : { owned: false, cause: `${url.hostname} is not a local address` };

      if (!owner.owned) {
        // The fallback: verify, never restart what this worktree does not own.
        const identity = await readDevServerIdentity(origin);
        const refuse = cause =>
          refusal(
            `refusing to run ${gate} against ${origin}: ${cause}. The landing restarts only this worktree's own ` +
              `server on a local port (${owner.cause}). Point EXA_BASE at a local port this worktree serves, or ` +
              'at a free one and the landing starts the server there.'
          );
        if (!servesCheckout(identity, root)) {
          throw refuse(
            identity.kind === DEV_IDENTITY.IDENTIFIED
              ? `it serves ${identity.repoRoot}, not ${rootReal}`
              : `it cannot show it serves this worktree (${identity.kind})`
          );
        }
        const verdict = await serverStaleness(root, {
          sourceHead: identity.sourceHead,
          ownPaths,
        });
        if (verdict.stale) {
          throw refuse(
            `it started from ${identity.sourceHead?.slice(0, 12) ?? 'an unknown commit'}, which predates HEAD ${head.slice(0, 12)} (${REASONS[verdict.reason]})`
          );
        }
        return null;
      }

      if (owner.pids.length === 0) {
        return refresh({
          phase,
          gate,
          origin,
          port,
          head,
          reason: 'not-running',
          sourceHead: null,
          movedPaths: null,
          pids: [],
        });
      }
      const identity = await readDevServerIdentity(origin);
      if (
        identity.kind !== DEV_IDENTITY.IDENTIFIED ||
        !servesCheckout(identity, root)
      ) {
        return refresh({
          phase,
          gate,
          origin,
          port,
          head,
          reason:
            identity.kind === DEV_IDENTITY.IDENTIFIED
              ? 'wrong-tree'
              : identity.kind,
          sourceHead: null,
          movedPaths: null,
          pids: owner.pids,
        });
      }
      const verdict = await serverStaleness(root, {
        sourceHead: identity.sourceHead,
        ownPaths,
      });
      if (!verdict.stale) return null;
      return refresh({
        phase,
        gate,
        origin,
        port,
        head,
        reason: verdict.reason,
        sourceHead: identity.sourceHead,
        movedPaths: verdict.movedPaths,
        pids: owner.pids,
      });
    },
  };
}
