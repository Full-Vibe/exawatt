import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { spawn } from 'child_process';
import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererServerSupervisor,
  type RecoveryChoice,
} from './process-recovery';
import {
  createRendererServer,
  RENDERER_SERVER_SERVICE,
  type ForkServer,
  type RendererServerDependencies,
  type ServerProcess,
} from './renderer-server';

// @scans none: reads only its own temporary directory (the __dirname is the stand-in server's)

/**
 * A double of Electron's `UtilityProcess`, built from its surface: `pid`,
 * stdout and stderr, `kill()`, and the `spawn` and `exit` events. As in
 * Electron, the process spawns on a later turn, `kill()` does nothing (and
 * returns false) before it has spawned or after it has exited, a process that
 * honours the kill exits with code 0, and `exit` carries only a code: a
 * process a signal ended reports the signal's number.
 */
class FakeServer extends EventEmitter implements ServerProcess {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid: number | undefined = undefined;
  kills = 0;
  honoursKill = true;
  private spawned = false;
  private exited = false;

  /** Spawns on the next turn, or only when `spawn()` is called. */
  constructor(spawnsItself = true) {
    super();
    if (spawnsItself) queueMicrotask(() => this.spawn());
  }

  spawn(): void {
    if (this.spawned || this.exited) return;
    this.spawned = true;
    this.pid = 90_000;
    this.emit('spawn');
  }

  kill(): boolean {
    if (!this.spawned || this.exited) return false;
    this.kills += 1;
    if (this.honoursKill) queueMicrotask(() => this.exit(0));
    return true;
  }

  get alive(): boolean {
    return !this.exited;
  }

  exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.pid = undefined;
    this.emit('exit', code);
  }
}

/** The exit code of a process SIGKILL ended, as `UtilityProcess` reports it. */
const SIGKILLED = 9;

interface Forked {
  modulePath: string;
  args: string[];
  options: Parameters<ForkServer>[2];
  child: FakeServer;
}

let root: string;
let resourcesPath: string;
let userData: string;
const HASH = 'abc123';

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-server-'));
  resourcesPath = path.join(root, 'Resources');
  userData = path.join(root, 'userData');
  fs.mkdirSync(path.join(resourcesPath, 'renderer'), { recursive: true });
  fs.writeFileSync(
    path.join(resourcesPath, 'renderer', 'renderer.sha256'),
    `${HASH}\n`
  );
  fs.writeFileSync(path.join(resourcesPath, 'renderer', 'renderer.zip'), '');
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(root, { recursive: true, force: true });
});

function harness(overrides: Partial<RendererServerDependencies> = {}) {
  const spawned: Forked[] = [];
  const extracted: string[] = [];
  const served: number[] = [];
  const sweeps: string[] = [];
  let probes = 0;
  let answerAfter = 2;
  const deps: RendererServerDependencies = {
    resourcesPath,
    userDataPath: () => userData,
    cacheNamespace: 'community',
    pid: 4242,
    isTest: true,
    childEnvironment: () => ({ AMBIENT: 'kept', PORT: 'overridden' }),
    forwardStdout: false,
    fork: (modulePath, args, options) => {
      const child = new FakeServer();
      spawned.push({ modulePath, args, options, child });
      return child;
    },
    extractArchive: async (_archive, destination) => {
      extracted.push(destination);
      fs.mkdirSync(path.join(destination, 'dist-renderer'), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(destination, 'dist-renderer', 'server.js'),
        ''
      );
    },
    ports: {
      allocate: async () => 34567,
      serving: async port => {
        served.push(port);
      },
      sweepDeadOrigins: async () => {
        sweeps.push('sweep');
      },
    },
    // Like the real port: only a live child of ours answers on it.
    probe: async () => {
      const child = spawned.at(-1)?.child;
      if (!child?.alive) return false;
      return ++probes >= answerAfter;
    },
    // Never advances, so only the child's exit or an answer ends the wait;
    // each sleep yields a full event-loop turn so other work can run.
    clock: {
      now: () => 0,
      sleep: () => new Promise(resolve => setImmediate(resolve)),
    },
    writeStderr: () => {},
    ...overrides,
  };
  return {
    server: createRendererServer(deps),
    spawned,
    extracted,
    served,
    sweeps,
    answerAfter: (n: number) => {
      answerAfter = n;
    },
  };
}

const versionRoot = () =>
  path.join(userData, 'renderer-cache', 'community', HASH);

describe('createRendererServer', () => {
  it('unpacks a cold version, runs its server as a utility process on loopback, and reports the origin once it answers', async () => {
    const { server, spawned, extracted, served } = harness();
    expect(server.hasWarmCache()).toBe(false);
    expect(server.origin).toBeNull();

    const origin = await server.start();

    expect(origin).toBe('http://127.0.0.1:34567');
    expect(server.origin).toBe(origin);
    // The port policy hears about the port only once something answers on it.
    expect(served).toEqual([34567]);
    expect(extracted).toEqual([`${versionRoot()}.staging-4242`]);
    expect(fs.existsSync(`${versionRoot()}.staging-4242`)).toBe(false);
    expect(server.hasWarmCache()).toBe(true);
    expect(spawned).toHaveLength(1);
    const [{ modulePath, args, options }] = spawned;
    const standalone = path.join(versionRoot(), 'dist-renderer');
    expect(modulePath).toBe(path.join(standalone, 'server.js'));
    expect(args).toEqual([]);
    expect(options.cwd).toBe(standalone);
    expect(options.serviceName).toBe(RENDERER_SERVER_SERVICE);
    expect(options.env).toEqual({
      AMBIENT: 'kept',
      HOSTNAME: '127.0.0.1',
      PORT: '34567',
      NODE_ENV: 'production',
    });
  });

  it('starts a warm version without unpacking it again', async () => {
    fs.mkdirSync(path.join(versionRoot(), 'dist-renderer'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(versionRoot(), 'dist-renderer', 'server.js'),
      ''
    );
    const { server, extracted } = harness();

    expect(server.hasWarmCache()).toBe(true);
    await server.start();
    expect(extracted).toEqual([]);
  });

  it('fails the start when the server exits before it ever answers', async () => {
    const { server, spawned, served, answerAfter } = harness();
    answerAfter(Number.POSITIVE_INFINITY);
    const started = server.start();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].child.exit(1);

    await expect(started).rejects.toThrow('Packaged renderer exited with 1');
    expect(server.origin).toBeNull();
    expect(served).toEqual([]);
  });

  // The port can be answered by another program: one on the wildcard
  // address, or one bound to loopback that made our child's bind fail. Its
  // answer must never read as our renderer being ready.
  it('never reads another program’s answer as the renderer being ready', async () => {
    const { server, spawned, served } = harness({
      probe: async () => true,
    });

    await expect(server.start()).rejects.toThrow('answered by another program');
    expect(spawned).toEqual([]);
    expect(served).toEqual([]);
    expect(server.origin).toBeNull();
  });

  it('fails the start when its server died, even though the port answers', async () => {
    let spawnedChild: FakeServer | null = null;
    const { server, served } = harness({
      fork: () => {
        spawnedChild = new FakeServer();
        return spawnedChild;
      },
      // Another program answers the moment our child is gone.
      probe: async () => {
        const child = spawnedChild;
        if (!child) return false;
        child.exit(1);
        return true;
      },
    });

    await expect(server.start()).rejects.toThrow(
      'Packaged renderer exited with 1'
    );
    expect(served).toEqual([]);
    expect(server.origin).toBeNull();
  });

  it('stops its server and releases it only once it has exited', async () => {
    const { server, spawned } = harness();
    await server.start();

    await server.stop();
    expect(spawned[0].child.kills).toBe(1);
    expect(spawned[0].child.alive).toBe(false);

    await server.stop();
    expect(spawned[0].child.kills).toBe(1);
  });

  it('keeps a server that will not stop owned, so the next shutdown can retry', async () => {
    const { server, spawned } = harness();
    await server.start();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = spawned[0].child;
    child.honoursKill = false;

    const stopping = server.stop();
    const refused = expect(stopping).rejects.toThrow(
      'Packaged renderer did not stop during shutdown'
    );
    await vi.runAllTimersAsync();
    await refused;
    expect(child.kills).toBe(1);

    child.honoursKill = true;
    await server.stop();
    expect(child.kills).toBe(2);
    expect(child.alive).toBe(false);
  });

  // `kill()` does nothing before the process has spawned (Electron returns
  // false), so a stop that arrives first must wait for the spawn rather than
  // leave a server running that nothing owns.
  it('stops a server whose stop arrived before it had spawned', async () => {
    let child: FakeServer | null = null;
    const { server, answerAfter } = harness({
      fork: () => (child = new FakeServer(false)),
    });
    answerAfter(Number.POSITIVE_INFINITY);
    const started = server.start().catch(error => error as Error);
    await vi.waitFor(() => expect(child).not.toBeNull());
    const late = child as unknown as FakeServer;

    const stopping = server.stop();
    await new Promise(resolve => setImmediate(resolve));
    expect(late.kills).toBe(0);
    late.spawn();
    await stopping;

    expect(late.kills).toBe(1);
    expect(late.alive).toBe(false);
    expect(String(await started)).toContain('Packaged renderer exited with 0');
  });

  it('is a no-op to stop a server that never started', async () => {
    const { server } = harness();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  it('prunes every cached version except the one this launch runs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const stale = path.join(userData, 'renderer-cache', 'community', 'old');
    fs.mkdirSync(stale, { recursive: true });
    const { server } = harness();
    await server.start();

    server.pruneLeftovers();
    await vi.waitFor(() =>
      expect(
        fs.readdirSync(path.join(userData, 'renderer-cache', 'community'))
      ).toEqual([HASH])
    );
  });

  it('asks the port policy to sweep dead origins with the leftovers (BUG-170)', async () => {
    const { server, sweeps } = harness();
    await server.start();
    expect(sweeps).toEqual([]);

    server.pruneLeftovers();
    expect(sweeps).toEqual(['sweep']);
  });

  it('prunes nothing before a version has started', () => {
    const stale = path.join(userData, 'renderer-cache', 'community', 'old');
    fs.mkdirSync(stale, { recursive: true });
    const { server } = harness();

    server.pruneLeftovers();
    expect(fs.existsSync(stale)).toBe(true);
  });

  describe('when the child dies while main lives (BUG-223)', () => {
    it('reports a serving child killed from outside, once', async () => {
      const exits: unknown[] = [];
      const { server, spawned } = harness({
        onUnexpectedExit: details => exits.push(details),
      });
      await server.start();

      spawned[0].child.exit(SIGKILLED);

      await vi.waitFor(() => expect(exits).toEqual([{ code: SIGKILLED }]));
    });

    it('does not report the exit a stop asked for', async () => {
      const exits: unknown[] = [];
      const { server } = harness({
        onUnexpectedExit: details => exits.push(details),
      });
      await server.start();

      await server.stop();

      expect(exits).toEqual([]);
    });

    it('leaves a child that dies while starting to the start that launched it', async () => {
      const exits: unknown[] = [];
      const { server, spawned, answerAfter } = harness({
        onUnexpectedExit: details => exits.push(details),
      });
      answerAfter(Number.POSITIVE_INFINITY);
      const started = server.start();
      await vi.waitFor(() => expect(spawned).toHaveLength(1));
      spawned[0].child.exit(SIGKILLED);

      await expect(started).rejects.toThrow(
        `Packaged renderer exited with ${SIGKILLED}`
      );
      expect(exits).toEqual([]);
    });

    it('restarts on the port it was serving, so the origin and its storage survive', async () => {
      let allocations = 0;
      const exits: unknown[] = [];
      const { server, spawned, served } = harness({
        ports: {
          // A second allocation would hand out a different port.
          allocate: async () => (++allocations === 1 ? 34567 : 45678),
          serving: async port => {
            served.push(port);
          },
          sweepDeadOrigins: async () => {},
        },
        onUnexpectedExit: details => exits.push(details),
      });
      const origin = await server.start();
      spawned[0].child.exit(SIGKILLED);

      const restarted = await server.restart();

      expect(restarted).toBe(origin);
      expect(server.origin).toBe(origin);
      expect(allocations).toBe(1);
      expect(spawned).toHaveLength(2);
      expect(spawned[1].options.env).toMatchObject({ PORT: '34567' });
      expect(spawned[1].options.cwd).toBe(spawned[0].options.cwd);

      // The restarted server is supervised the same way.
      spawned[1].child.exit(15);
      await vi.waitFor(() =>
        expect(exits).toEqual([{ code: SIGKILLED }, { code: 15 }])
      );
    });

    it('refuses to restart a server that never served, or while a stop is in flight', async () => {
      const { server, spawned } = harness();
      await expect(server.restart()).rejects.toThrow('has not served yet');
      await server.start();
      spawned[0].child.honoursKill = false;
      const stopping = server.stop().catch(() => {});

      await expect(server.restart()).rejects.toThrow('stopping');

      spawned[0].child.exit(15);
      await stopping;
      expect(server.isDown()).toBe(true);
      await expect(server.restart()).resolves.toBe('http://127.0.0.1:34567');
      expect(server.isDown()).toBe(false);
    });

    it('reports a later death after a stop that failed, and restarts (an abandoned shutdown)', async () => {
      const exits: unknown[] = [];
      const { server, spawned } = harness({
        onUnexpectedExit: details => exits.push(details),
      });
      await server.start();
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const child = spawned[0].child;
      child.honoursKill = false;
      const stopping = server.stop();
      const refused = expect(stopping).rejects.toThrow('did not stop');
      await vi.runAllTimersAsync();
      await refused;
      vi.useRealTimers();

      // The shutdown was abandoned; the server dies later on its own.
      child.exit(SIGKILLED);

      await vi.waitFor(() => expect(exits).toEqual([{ code: SIGKILLED }]));
      await expect(server.restart()).resolves.toBe('http://127.0.0.1:34567');
    });

    it('stops a child that never answers before failing its start, so it cannot keep the port', async () => {
      let now = 0;
      const { server, spawned, answerAfter } = harness({
        // Each probe moves the clock a second: the 30 s deadline passes on
        // the thirty-first, whatever the host's speed.
        clock: {
          now: () => (now += 1_000),
          sleep: () => new Promise(resolve => setImmediate(resolve)),
        },
      });
      answerAfter(Number.POSITIVE_INFINITY);

      await expect(server.start()).rejects.toThrow(
        'Timed out starting the packaged renderer'
      );

      expect(spawned[0].child.kills).toBe(1);
      expect(spawned[0].child.alive).toBe(false);
      // Nothing is left owned: a stop has nothing to do.
      await server.stop();
      expect(spawned[0].child.kills).toBe(1);
    });

    it('treats a server that died during the last readiness probe as a failed start', async () => {
      const exits: unknown[] = [];
      const { server, spawned } = harness({
        probe: async () => {
          // Nothing answers before the child exists; then it answers and is
          // gone before the answer is handed over.
          if (spawned.length === 0) return false;
          spawned[0].child.exit(SIGKILLED);
          return true;
        },
        onUnexpectedExit: details => exits.push(details),
      });

      await expect(server.start()).rejects.toThrow(
        `Packaged renderer exited with ${SIGKILLED}`
      );
      expect(server.origin).toBeNull();
      expect(exits).toEqual([]);
    });
  });
});

/**
 * `utilityProcess.fork` played by a Node child process, for the tests that need
 * a real server listening, dying or hanging. It offers exactly the
 * `ServerProcess` surface with Electron's semantics: `kill()` asks with
 * SIGTERM and ends the process outright two seconds later, as Chromium does,
 * and `exit` carries a code: 0 for a process that honoured `kill()`, the
 * signal's number for one another signal ended. That Chromium also ends the
 * process with main (BUG-070) is the packaged gate's to prove: no double can.
 */
class NodeServer extends EventEmitter implements ServerProcess {
  private readonly child;
  private exited = false;
  private killed = false;

  constructor(modulePath: string, options: Parameters<ForkServer>[2]) {
    super();
    this.child = spawn(process.execPath, [modulePath], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.once('spawn', () => this.emit('spawn'));
    this.child.once('exit', (code, signal) => {
      this.exited = true;
      const honoured = this.killed && signal === 'SIGTERM';
      this.emit(
        'exit',
        code ?? (honoured ? 0 : os.constants.signals[signal ?? 'SIGKILL'])
      );
    });
  }

  get pid(): number | undefined {
    return this.exited ? undefined : this.child.pid;
  }

  get stdout(): NodeJS.ReadableStream | null {
    return this.child.stdout;
  }

  get stderr(): NodeJS.ReadableStream | null {
    return this.child.stderr;
  }

  kill(): boolean {
    if (this.exited || this.child.pid === undefined) return false;
    this.killed = true;
    this.child.kill('SIGTERM');
    setTimeout(() => {
      if (!this.exited) this.child.kill('SIGKILL');
    }, 2_000).unref();
    return true;
  }
}

const nodeFork: ForkServer = (modulePath, _args, options) =>
  new NodeServer(modulePath, options);

/** The renderer server against real processes (BUG-223). */
describe('createRendererServer with a real server', () => {
  // Whatever a failing assertion leaves running is ended here, by pid, so a
  // red run cannot leave an orphan behind.
  const started: number[] = [];
  afterEach(() => {
    for (const pid of started.splice(0)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }
  });

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  it('brings a server killed from outside back on the same origin (BUG-223)', async () => {
    // A stand-in for Next's server that answers with its own pid, so the test
    // can kill exactly it and tell the restarted process apart.
    const standalone = path.join(versionRoot(), 'dist-renderer');
    fs.mkdirSync(standalone, { recursive: true });
    fs.writeFileSync(
      path.join(standalone, 'server.js'),
      `require('http').createServer((req, res) => res.end(String(process.pid)))
  .listen(Number(process.env.PORT), process.env.HOSTNAME);`
    );
    const port = await new Promise<number>(resolve => {
      const probe = net.createServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(free));
      });
    });
    const pidAt = async (origin: string) =>
      Number(await (await fetch(`${origin}/workspace`)).text());
    const exits: unknown[] = [];
    const server = createRendererServer({
      resourcesPath,
      userDataPath: () => userData,
      cacheNamespace: 'community',
      fork: nodeFork,
      isTest: true,
      childEnvironment: () => ({ PATH: process.env.PATH }),
      forwardStdout: false,
      ports: { allocate: async () => port, serving: async () => {} },
      writeStderr: () => {},
      onUnexpectedExit: details => exits.push(details),
    });
    try {
      const origin = await server.start();
      const firstPid = await pidAt(origin);
      started.push(firstPid);

      process.kill(firstPid, 'SIGKILL');
      await vi.waitFor(() => expect(exits).toEqual([{ code: SIGKILLED }]), {
        timeout: 10_000,
        interval: 20,
      });

      expect(await server.restart()).toBe(origin);
      const secondPid = await pidAt(origin);
      started.push(secondPid);
      expect(secondPid).not.toBe(firstPid);
    } finally {
      await server.stop();
    }
    expect(exits).toHaveLength(1);
  });

  describe('recovery when the restarted server dies or hangs while starting', () => {
    /**
     * A stand-in for Next's server that follows a script, one step per start:
     * `serve` answers with its pid, `die` exits before listening, and `hang`
     * stays alive without ever listening (and says so in `hung`).
     */
    const SCRIPTED_SERVER = `const fs = require('fs');
const path = require('path');
const at = name => path.join(__dirname, name);
const plan = JSON.parse(fs.readFileSync(at('plan.json'), 'utf8'));
const n = fs.existsSync(at('starts')) ? Number(fs.readFileSync(at('starts'), 'utf8')) : 0;
fs.writeFileSync(at('starts'), String(n + 1));
fs.appendFileSync(at('pids'), process.pid + '\\n');
const step = plan[n] ?? 'serve';
if (step === 'die') process.exit(3);
if (step === 'hang') {
  fs.writeFileSync(at('hung'), String(process.pid));
  setInterval(() => {}, 60000);
} else {
  require('http')
    .createServer((req, res) => res.end(String(process.pid)))
    .listen(Number(process.env.PORT), process.env.HOSTNAME);
}`;

    async function freePort(): Promise<number> {
      return await new Promise<number>(resolve => {
        const probe = net.createServer().listen(0, '127.0.0.1', () => {
          const { port } = probe.address() as net.AddressInfo;
          probe.close(() => resolve(port));
        });
      });
    }

    async function scripted(plan: string[]) {
      const standalone = path.join(versionRoot(), 'dist-renderer');
      fs.mkdirSync(standalone, { recursive: true });
      fs.writeFileSync(path.join(standalone, 'server.js'), SCRIPTED_SERVER);
      fs.writeFileSync(
        path.join(standalone, 'plan.json'),
        JSON.stringify(plan)
      );
      const pids = () =>
        fs.existsSync(path.join(standalone, 'pids'))
          ? fs
              .readFileSync(path.join(standalone, 'pids'), 'utf8')
              .split('\n')
              .filter(Boolean)
              .map(Number)
          : [];
      pids().forEach(pid => started.push(pid));
      const hungMarker = path.join(standalone, 'hung');
      const port = await freePort();
      const events: Array<[string, unknown]> = [];
      const answers: Array<(choice: RecoveryChoice) => void> = [];
      let quitting = false;
      let reloads = 0;
      const server = createRendererServer({
        resourcesPath,
        userDataPath: () => userData,
        cacheNamespace: 'community',
        fork: nodeFork,
        isTest: true,
        childEnvironment: () => ({ PATH: process.env.PATH }),
        forwardStdout: false,
        ports: { allocate: async () => port, serving: async () => {} },
        // The readiness deadline passes the moment a hung server has said it
        // is up, never on the host's clock: a slow host only waits longer.
        clock: {
          now: () => {
            if (!fs.existsSync(hungMarker)) return 0;
            fs.rmSync(hungMarker);
            return Number.MAX_SAFE_INTEGER;
          },
          sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
        },
        writeStderr: () => {},
        onUnexpectedExit: details => supervisor.exited(details),
      });
      const supervisor = createRendererServerSupervisor({
        record: (event, fields) => events.push([event, fields?.action]),
        isQuitting: () => quitting,
        restart: () => server.restart(),
        isDown: () => server.isDown(),
        reloadWorkspace: () => {
          reloads += 1;
        },
        ask: () => new Promise(resolve => answers.push(resolve)),
        quit: () => {},
      });
      return {
        server,
        supervisor,
        events,
        answers,
        pids: () => {
          const all = pids();
          all.forEach(pid => started.push(pid));
          return all;
        },
        reloads: () => reloads,
        quitting: (value: boolean) => {
          quitting = value;
        },
        pidAt: async (origin: string) =>
          Number(await (await fetch(`${origin}/workspace`)).text()),
      };
    }

    const waitLong = { timeout: 10_000, interval: 20 };

    it('retries a restarted server that dies while starting, on the same origin', async () => {
      const h = await scripted(['serve', 'die', 'serve']);
      try {
        const origin = await h.server.start();
        process.kill(await h.pidAt(origin), 'SIGKILL');

        await vi.waitFor(() => expect(h.reloads()).toBe(1), waitLong);

        expect(h.events).toEqual([
          ['renderer-server.exited', 'restart'],
          ['renderer-server.restart-failed', 'retry'],
          ['renderer-server.restarted', undefined],
        ]);
        expect(await h.pidAt(origin)).toBe(h.pids()[2]);
      } finally {
        await h.server.stop();
      }
    });

    it('kills a restarted server that never answers, then serves again on the port it held', async () => {
      const h = await scripted(['serve', 'hang', 'serve']);
      try {
        const origin = await h.server.start();
        process.kill(await h.pidAt(origin), 'SIGKILL');

        await vi.waitFor(() => expect(h.reloads()).toBe(1), waitLong);

        const [, hung, serving] = h.pids();
        expect(alive(hung)).toBe(false);
        expect(await h.pidAt(origin)).toBe(serving);
        expect(h.events[1]).toEqual([
          'renderer-server.restart-failed',
          'retry',
        ]);
      } finally {
        await h.server.stop();
      }
    });

    it('asks the operator once restarts keep failing, and serves again on Reload Window', async () => {
      const h = await scripted(['serve', 'die', 'die', 'die', 'serve']);
      try {
        const origin = await h.server.start();
        process.kill(await h.pidAt(origin), 'SIGKILL');

        await vi.waitFor(() => expect(h.answers).toHaveLength(1), waitLong);
        expect(h.reloads()).toBe(0);
        expect(h.events[h.events.length - 1]).toEqual([
          'renderer-server.restart-failed',
          'ask',
        ]);

        h.answers[0]('reload');
        await vi.waitFor(() => expect(h.reloads()).toBe(1), waitLong);
        expect(await h.pidAt(origin)).toBe(h.pids()[4]);
      } finally {
        await h.server.stop();
      }
    });

    it('serves again when a quit that stopped or lost the server is cancelled', async () => {
      const h = await scripted(['serve', 'serve', 'serve']);
      try {
        const origin = await h.server.start();

        // Killed from outside while shutdown owns the processes: left down.
        h.quitting(true);
        process.kill(await h.pidAt(origin), 'SIGKILL');
        await vi.waitFor(
          () => expect(h.events).toEqual([['renderer-server.exited', 'none']]),
          waitLong
        );
        h.quitting(false);
        h.supervisor.shutdownCancelled();
        await vi.waitFor(() => expect(h.reloads()).toBe(1), waitLong);
        expect(await h.pidAt(origin)).toBe(h.pids()[1]);

        // Stopped by the quit's own cleanup, then the quit is cancelled.
        h.quitting(true);
        await h.server.stop();
        h.quitting(false);
        h.supervisor.shutdownCancelled();
        await vi.waitFor(() => expect(h.reloads()).toBe(2), waitLong);
        expect(await h.pidAt(origin)).toBe(h.pids()[2]);
      } finally {
        await h.server.stop();
      }
    });
  });
});
