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
 * 3. **Re-home.** The kept port has been taken for
 *    `REHOME_AFTER_CONSECUTIVE_FALLBACKS` launches in a row, or the record is
 *    missing or unreadable: choose a new port and keep it from then on. The
 *    old origin's storage is abandoned, which is honest only because it has
 *    already been unreachable that long (or was never readable at all).
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
  | { status: 'unreadable' };

type PortDecision =
  | { kind: 'kept'; port: number; record: KeptPort }
  | { kind: 'new'; port: number }
  | { kind: 'fallback'; port: number; record: KeptPort };

export interface RendererPortPolicyDependencies {
  /** Read late: `userData` may be redirected before the first launch. */
  userDataPath: () => string;
  record?: DiagnosticRecorder;
  /** Whether `127.0.0.1:<port>` can be bound right now. */
  isFree?: (port: number) => Promise<boolean>;
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

async function loopbackPortIsFree(port: number): Promise<boolean> {
  return await new Promise(resolve => {
    const probe = nodeNet.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
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
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { status: 'absent' };
    }
    return { status: 'unreadable' };
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
    // fall through: bytes that do not parse are as unreadable as bytes that
    // parse into the wrong shape.
  }
  return { status: 'unreadable' };
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
  const isFree = deps.isFree ?? loopbackPortIsFree;
  const random = deps.random ?? Math.random;
  const anyFreePort = deps.anyFreePort ?? osAssignedLoopbackPort;
  const file = () => path.join(deps.userDataPath(), RENDERER_PORT_FILE);
  let decision: PortDecision | null = null;

  async function newStablePort(): Promise<number> {
    const span = STABLE_PORT_MAX - STABLE_PORT_MIN + 1;
    for (let attempt = 0; attempt < STABLE_PORT_CANDIDATES; attempt += 1) {
      const candidate = STABLE_PORT_MIN + Math.floor(random() * span);
      if (await isFree(candidate)) return candidate;
    }
    // A machine with sixteen random ports taken in a row is not one this
    // policy can reason about; serve, and try for a stable port next launch.
    return await anyFreePort();
  }

  async function decide(): Promise<PortDecision> {
    const kept = await readKeptPort(file());
    if (kept.status === 'unreadable') {
      record('renderer.port.unreadable', { file: RENDERER_PORT_FILE });
    }
    if (kept.status === 'ok') {
      const { port, consecutiveFallbacks } = kept.value;
      if (await isFree(port)) {
        return { kind: 'kept', port, record: kept.value };
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
