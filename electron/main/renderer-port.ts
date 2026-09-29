import fs from 'fs';
import nodeNet from 'net';
import path from 'path';
import type { DiagnosticRecorder } from './diagnostics-log';

/**
 * Which loopback port the packaged renderer serves on (BUG-022).
 *
 * The renderer's origin is `http://127.0.0.1:<port>`, and Chromium scopes
 * `localStorage`, `sessionStorage` and IndexedDB by origin, port included. A
 * port picked at random on every launch therefore handed the renderer a fresh,
 * empty store every time: the account first-run card came back after every
 * relaunch, the analytics opt-out lasted one session, and the community
 * Project registry forgot itself. Each launch also left one more origin's
 * store on disk that nothing would ever read again.
 *
 * So an install keeps one port. The policy, in order:
 *
 * 1. **Kept.** The port recorded in `renderer-port.json` is free: use it. The
 *    origin, and everything stored under it, is the one the last launch had.
 * 2. **Fallback.** The kept port is taken (another program has it, or a server
 *    from a crashed launch has not finished exiting): serve this launch from
 *    an OS-assigned port and keep the record. This launch starts with empty
 *    storage and what it writes does not carry over; the kept origin's storage
 *    is untouched and comes back the next launch the port is free.
 * 3. **Temporary.** The record exists but cannot be read (a permission or I/O
 *    error), or whether the kept port is free cannot be told: serve this
 *    launch from an OS-assigned port and write nothing. A failed read is not
 *    an empty one, so it neither counts as a fallback nor replaces the record
 *    (the record IS the origin, and the storage under it, being preserved).
 * 4. **Re-home.** The kept port has been taken for
 *    `REHOME_AFTER_CONSECUTIVE_FALLBACKS` launches in a row, or the record is
 *    missing or its bytes are not a record: choose a new port and keep it from
 *    then on. The old origin's storage is abandoned, which is honest only
 *    because it has already been unreachable that long (or was never readable
 *    at all).
 *
 * "Free" means nothing answers a connection to `127.0.0.1:<port>` AND the
 * address can be bound. The bind alone is not enough: macOS lets
 * `127.0.0.1:<port>` bind while another program listens on `0.0.0.0` or `::`
 * at that port, and the more specific bind then takes that program's loopback
 * traffic.
 *
 * The record is written only once the server is answering on the port, so a
 * launch that fails to start never records a port nobody served. Size class
 * (decision `0039`): one record of two integers, bounded by construction.
 */

const RENDERER_PORT_FILE = 'renderer-port.json';

/** Below every OS ephemeral range (macOS from 49152, Linux from 32768), so the
 *  port an install keeps is never one the OS hands to an outgoing socket. */
const STABLE_PORT_MIN = 20_000;
const STABLE_PORT_MAX = 32_767;
const STABLE_PORT_CANDIDATES = 16;
const REHOME_AFTER_CONSECUTIVE_FALLBACKS = 3;

interface KeptPort {
  port: number;
  consecutiveFallbacks: number;
}

type KeptPortRead =
  | { status: 'absent' }
  | { status: 'ok'; value: KeptPort }
  /** The bytes were read and are not a record. */
  | { status: 'corrupt' }
  /** The bytes could not be read at all; what they say is unknown. */
  | { status: 'inaccessible'; code: string };

type PortDecision =
  | { kind: 'kept'; port: number; record: KeptPort }
  | { kind: 'new'; port: number }
  | { kind: 'fallback'; port: number; record: KeptPort }
  | { kind: 'temporary'; port: number };

/**
 * What a probe of one loopback port found. `unknown` is a probe that failed
 * for a reason other than the port's state, and is never read as either
 * answer.
 */
type PortProbe = 'free' | 'taken' | 'unknown';

export interface RendererPortPolicyDependencies {
  /** Read late: `userData` may be redirected before the first launch. */
  userDataPath: () => string;
  record?: DiagnosticRecorder;
  /** Whether `127.0.0.1:<port>` is free for this launch right now. */
  probe?: (port: number) => Promise<PortProbe>;
  /** An OS-assigned free loopback port, for a fallback launch. */
  anyFreePort?: () => Promise<number>;
  random?: () => number;
}

export interface RendererPortPolicy {
  /** The port this launch should serve on. */
  allocate(): Promise<number>;
  /**
   * Records the outcome once the server answers on `port`. Never throws: a
   * record that cannot be written costs the next launch its origin, which is
   * logged, not a reason to refuse this launch.
   */
  serving(port: number): Promise<void>;
}

async function osAssignedLoopbackPort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = nodeNet.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a renderer port'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}

const errorCode = (error: unknown): string =>
  String((error as NodeJS.ErrnoException | null)?.code ?? 'unknown');

/** Loopback answers or refuses at once; this bounds only a wedged listener. */
const CONNECT_PROBE_TIMEOUT_MS = 1_000;

/** Whether anything answers a connection to `127.0.0.1:<port>`. */
async function loopbackAnswers(port: number): Promise<PortProbe> {
  return await new Promise(resolve => {
    const socket = nodeNet.connect({ port, host: '127.0.0.1' });
    const settle = (result: PortProbe) => {
      socket.destroy();
      resolve(result);
    };
    socket.once('connect', () => settle('taken'));
    socket.once('error', error =>
      settle(errorCode(error) === 'ECONNREFUSED' ? 'free' : 'unknown')
    );
    socket.setTimeout(CONNECT_PROBE_TIMEOUT_MS, () => settle('unknown'));
  });
}

async function loopbackBinds(port: number): Promise<PortProbe> {
  return await new Promise(resolve => {
    const probe = nodeNet.createServer();
    probe.once('error', error =>
      resolve(errorCode(error) === 'EADDRINUSE' ? 'taken' : 'unknown')
    );
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve('free'));
    });
  });
}

/** Free only when nothing answers on the port AND it binds. */
async function probeLoopbackPort(port: number): Promise<PortProbe> {
  const answered = await loopbackAnswers(port);
  if (answered !== 'free') return answered;
  return await loopbackBinds(port);
}

function isStablePort(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    (value as number) >= STABLE_PORT_MIN &&
    (value as number) <= STABLE_PORT_MAX
  );
}

async function readKeptPort(file: string): Promise<KeptPortRead> {
  let text: string;
  try {
    text = await fs.promises.readFile(file, 'utf8');
  } catch (error) {
    const code = errorCode(error);
    // Both mean no record can exist at that path, which is an answer.
    if (code === 'ENOENT' || code === 'ENOTDIR') return { status: 'absent' };
    return { status: 'inaccessible', code };
  }
  try {
    const value = JSON.parse(text) as Partial<KeptPort> | null;
    if (
      value &&
      isStablePort(value.port) &&
      Number.isInteger(value.consecutiveFallbacks) &&
      (value.consecutiveFallbacks as number) >= 0
    ) {
      return {
        status: 'ok',
        value: {
          port: value.port,
          consecutiveFallbacks: value.consecutiveFallbacks as number,
        },
      };
    }
  } catch {
    // fall through: bytes that do not parse are as corrupt as bytes that
    // parse into the wrong shape.
  }
  return { status: 'corrupt' };
}

async function writeKeptPort(file: string, value: KeptPort): Promise<void> {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.promises.writeFile(temp, `${JSON.stringify(value)}\n`, {
    mode: 0o600,
  });
  await fs.promises.rename(temp, file);
}

export function createRendererPortPolicy(
  deps: RendererPortPolicyDependencies
): RendererPortPolicy {
  const record = deps.record ?? (() => {});
  const probe = deps.probe ?? probeLoopbackPort;
  const random = deps.random ?? Math.random;
  const anyFreePort = deps.anyFreePort ?? osAssignedLoopbackPort;
  const file = () => path.join(deps.userDataPath(), RENDERER_PORT_FILE);
  let decision: PortDecision | null = null;

  async function newStablePort(): Promise<number> {
    const span = STABLE_PORT_MAX - STABLE_PORT_MIN + 1;
    for (let attempt = 0; attempt < STABLE_PORT_CANDIDATES; attempt += 1) {
      const candidate = STABLE_PORT_MIN + Math.floor(random() * span);
      // A candidate that cannot be judged is skipped, never kept.
      if ((await probe(candidate)) === 'free') return candidate;
    }
    // A machine with sixteen random ports taken in a row is not one this
    // policy can reason about; serve, and try for a stable port next launch.
    return await anyFreePort();
  }

  async function decide(): Promise<PortDecision> {
    const kept = await readKeptPort(file());
    if (kept.status === 'inaccessible') {
      record('renderer.port.inaccessible', {
        file: RENDERER_PORT_FILE,
        code: kept.code,
      });
      return { kind: 'temporary', port: await anyFreePort() };
    }
    if (kept.status === 'corrupt') {
      record('renderer.port.unreadable', { file: RENDERER_PORT_FILE });
    }
    if (kept.status === 'ok') {
      const { port, consecutiveFallbacks } = kept.value;
      const state = await probe(port);
      if (state === 'free') {
        return { kind: 'kept', port, record: kept.value };
      }
      if (state === 'unknown') {
        record('renderer.port.probe-failed', { keptPort: port });
        return { kind: 'temporary', port: await anyFreePort() };
      }
      const fallbacks = consecutiveFallbacks + 1;
      if (fallbacks < REHOME_AFTER_CONSECUTIVE_FALLBACKS) {
        record('renderer.port.fallback', {
          keptPort: port,
          consecutiveFallbacks: fallbacks,
        });
        return {
          kind: 'fallback',
          port: await anyFreePort(),
          record: { port, consecutiveFallbacks: fallbacks },
        };
      }
      record('renderer.port.rehome', {
        keptPort: port,
        consecutiveFallbacks: fallbacks,
      });
    }
    return { kind: 'new', port: await newStablePort() };
  }

  return {
    async allocate() {
      decision = await decide();
      return decision.port;
    },
    async serving(port) {
      const settled = decision;
      decision = null;
      if (!settled || settled.port !== port) return;
      // A temporary launch writes nothing: the record it could not read may
      // still name the origin whose storage is being preserved.
      if (settled.kind === 'temporary') return;
      let next: KeptPort | null = null;
      if (settled.kind === 'new') {
        next = isStablePort(port) ? { port, consecutiveFallbacks: 0 } : null;
      } else if (settled.kind === 'fallback') {
        next = settled.record;
      } else if (settled.record.consecutiveFallbacks !== 0) {
        next = { port, consecutiveFallbacks: 0 };
      }
      if (!next) return;
      try {
        await writeKeptPort(file(), next);
      } catch (error) {
        record('renderer.port.persist-failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
