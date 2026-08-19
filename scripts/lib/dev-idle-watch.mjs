// ENG-022 H12. A dev server nobody is attached to exits on its own.
//
// AGENTS.md tells every agent touching a gated surface to start its own dev
// server (`pnpm dev -p <free-port>`), and nothing in the repo has ever stopped
// one. They are launched detached, so the root `pnpm` is already reparented to
// PID 1 the moment it starts — parent-death detection cannot see the agent
// leave. Diagnosed 2026-08-19 against a server that had served zero requests
// for two days seven hours in a landed worktree, alongside an Electron
// lifecycle eval's server whose temp userData directory was already deleted.
//
// The signal is ESTABLISHED connections to the dev port, not request logging.
// A renderer with the page open — the Electron shell, a Playwright eval, a
// browser tab — holds an HMR socket for as long as it is attached, so
// "no client has been connected for TTL" means abandoned rather than merely
// quiet. That keeps the whole mechanism inside this supervisor: `src/proxy.ts`
// is on the auth path for every request and is not worth touching for
// housekeeping.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_IDLE_TTL_MS = 45 * 60 * 1000;
export const DEFAULT_POLL_INTERVAL_MS = 60 * 1000;
export const UNKNOWN_CONNECTIONS = -1;

/** Next takes the LAST `-p`/`--port`, and `pnpm dev -p 7041` expands to
 *  `next dev -p 7000 -p 7041` because the package script hardcodes its own.
 *  Mirror Next's precedence rather than the first match. */
export function resolveDevPort(args, { fallback = 3000, env = {} } = {}) {
  let port = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '-p' || arg === '--port') {
      const candidate = Number(args[index + 1]);
      if (Number.isInteger(candidate) && candidate > 0) port = candidate;
    } else if (arg.startsWith('--port=')) {
      const candidate = Number(arg.slice('--port='.length));
      if (Number.isInteger(candidate) && candidate > 0) port = candidate;
    }
  }
  if (port !== null) return port;
  const fromEnv = Number(env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  return fallback;
}

/** `0` (or anything unparseable-but-present) disables the watch outright, so an
 *  operator running a long-lived dev server can opt out without editing code. */
export function resolveIdleTtlMs(raw, { fallback = DEFAULT_IDLE_TTL_MS } = {}) {
  if (raw === undefined || raw === '') return fallback;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return minutes * 60 * 1000;
}

export async function countEstablishedConnections(port, { run = execFileAsync } = {}) {
  try {
    const { stdout } = await run('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:ESTABLISHED',
      '-t',
    ]);
    return stdout.split('\n').filter(line => line.trim() !== '').length;
  } catch (error) {
    // lsof exits 1 with empty output when nothing matches — a real zero. A
    // missing or unrunnable lsof is NOT: reporting zero there would shut down
    // a server that is genuinely in use, so it reports UNKNOWN and the policy
    // keeps the server alive.
    if (error && (error.code === 'ENOENT' || error.code === 'EACCES')) {
      return UNKNOWN_CONNECTIONS;
    }
    return typeof error?.stdout === 'string'
      ? error.stdout.split('\n').filter(line => line.trim() !== '').length
      : 0;
  }
}

/** Pure decision so the policy is testable without sockets or clocks. */
export function nextIdleState({ connections, lastAttachedAt, now, ttlMs }) {
  if (ttlMs <= 0) return { lastAttachedAt, exit: false };
  // Unknown (probe unavailable) is treated exactly like attached: never shut a
  // server down on the strength of a measurement that did not happen.
  if (connections !== 0) return { lastAttachedAt: now, exit: false };
  return { lastAttachedAt, exit: now - lastAttachedAt >= ttlMs };
}

/** Polls until the server has had no attached client for `ttlMs`, then calls
 *  `onIdle`. Returns a stop function. */
export function watchForIdle({
  port,
  ttlMs = DEFAULT_IDLE_TTL_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  probe = countEstablishedConnections,
  onIdle,
  log = () => {},
}) {
  if (ttlMs <= 0) return () => {};
  let lastAttachedAt = now();
  let stopped = false;
  const timer = setInterval(async () => {
    if (stopped) return;
    const connections = await probe(port);
    const state = nextIdleState({
      connections,
      lastAttachedAt,
      now: now(),
      ttlMs,
    });
    lastAttachedAt = state.lastAttachedAt;
    if (state.exit) {
      stopped = true;
      clearInterval(timer);
      log(
        `[dev] no client attached to :${port} for ${Math.round(ttlMs / 60000)}m — shutting down. ` +
          `Set EXAWATT_DEV_IDLE_MINUTES=0 to disable.`
      );
      onIdle();
    }
  }, pollIntervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
