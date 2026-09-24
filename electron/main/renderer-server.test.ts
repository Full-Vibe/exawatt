import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererServer,
  rendererServerLaunch,
  type RendererServerDependencies,
} from './renderer-server';

/**
 * A child process double built from the surface `renderer-server` and
 * `stopChildProcess` actually touch: stdio streams, exit state, `kill`, and
 * the `close` event. `kill` records the signal and closes on the next turn
 * the way a cooperative Node server does on SIGTERM.
 */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  signals: string[] = [];
  honoursSignals = true;

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (this.honoursSignals) queueMicrotask(() => this.exit(null, signal));
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
    this.emit('close', code, signal);
  }
}

interface Spawned {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
  child: FakeChild;
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
  const spawned: Spawned[] = [];
  const extracted: string[] = [];
  const served: number[] = [];
  let probes = 0;
  let answerAfter = 2;
  const deps: RendererServerDependencies = {
    resourcesPath,
    userDataPath: () => userData,
    cacheNamespace: 'community',
    execPath: '/Applications/Exawatt.app/Contents/MacOS/Exawatt',
    pid: 4242,
    isTest: true,
    childEnvironment: () => ({ AMBIENT: 'kept', PORT: 'overridden' }),
    forwardStdout: false,
    spawn: (command, args, options) => {
      const child = new FakeChild();
      spawned.push({ command, args, options, child });
      return child as unknown as ChildProcess;
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
    },
    probe: async () => ++probes >= answerAfter,
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
    answerAfter: (n: number) => {
      answerAfter = n;
    },
  };
}

const versionRoot = () =>
  path.join(userData, 'renderer-cache', 'community', HASH);

describe('createRendererServer', () => {
  it('unpacks a cold version, runs its server as Node on loopback, and reports the origin once it answers', async () => {
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
    const [{ command, args, options }] = spawned;
    const standalone = path.join(versionRoot(), 'dist-renderer');
    expect(command).toBe('/Applications/Exawatt.app/Contents/MacOS/Exawatt');
    expect(args[args.length - 1]).toBe(path.join(standalone, 'server.js'));
    expect(options.cwd).toBe(standalone);
    expect(options.env).toMatchObject({
      AMBIENT: 'kept',
      ELECTRON_RUN_AS_NODE: '1',
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

  it('stops its child with SIGTERM and releases it only once it has closed', async () => {
    const { server, spawned } = harness();
    await server.start();

    await server.stop();
    expect(spawned[0].child.signals).toEqual(['SIGTERM']);

    await server.stop();
    expect(spawned[0].child.signals).toEqual(['SIGTERM']);
  });

  it('keeps a child that will not stop owned, so the next shutdown can retry', async () => {
    const { server, spawned } = harness();
    await server.start();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const child = spawned[0].child;
    child.honoursSignals = false;

    const stopping = server.stop();
    const refused = expect(stopping).rejects.toThrow(
      'Packaged renderer did not stop during shutdown'
    );
    await vi.runAllTimersAsync();
    await refused;
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);

    child.honoursSignals = true;
    await server.stop();
    expect(child.signals).toEqual(['SIGTERM', 'SIGKILL', 'SIGTERM']);
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

    server.pruneCache();
    await vi.waitFor(() =>
      expect(
        fs.readdirSync(path.join(userData, 'renderer-cache', 'community'))
      ).toEqual([HASH])
    );
  });

  it('prunes nothing before a version has started', () => {
    const stale = path.join(userData, 'renderer-cache', 'community', 'old');
    fs.mkdirSync(stale, { recursive: true });
    const { server } = harness();

    server.pruneCache();
    expect(fs.existsSync(stale)).toBe(true);
  });
});

/**
 * BUG-070, against real processes: a killed or crashed Electron main used to
 * leave its renderer server reparented to launchd, holding its port and a
 * Dock icon. The server entry here is a stand-in for Next's `server.js` that
 * listens on loopback and reports `<pid> <port>`.
 */
describe('rendererServerLaunch', () => {
  const ENTRY = `require('net').createServer().listen(0, '127.0.0.1', function () {
  process.stdout.write(process.pid + ' ' + this.address().port + '\\n');
});`;

  // Whatever a failing assertion leaves running is ended here, by pid, so a
  // red run cannot become the orphan this suite exists to prevent.
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

  function writeEntry(): string {
    const entry = path.join(root, 'server.js');
    fs.writeFileSync(entry, ENTRY);
    return entry;
  }

  function firstLine(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffered = '';
      stream.on('data', chunk => {
        buffered += String(chunk);
        const end = buffered.indexOf('\n');
        if (end >= 0) resolve(buffered.slice(0, end));
      });
      stream.once('end', () =>
        reject(new Error(`stream ended before a line: ${buffered}`))
      );
    });
  }

  function alive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  function connects(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
  }

  it('runs the entry and keeps serving until its parent lets go of stdin', async () => {
    const launch = rendererServerLaunch(writeEntry());
    const child = spawn(process.execPath, launch.args, {
      stdio: launch.stdio,
    });
    started.push(child.pid!);
    const exited = new Promise<number | null>(resolve =>
      child.once('exit', code => resolve(code))
    );
    const [, port] = (await firstLine(child.stdout!)).split(' ').map(Number);

    expect(await connects(port)).toBe(true);
    child.stdin!.end();
    expect(await exited).toBe(0);
  });

  it('ends the server when its parent is killed outright', async () => {
    const launch = rendererServerLaunch(writeEntry());
    const parentSource = `const { spawn } = require('child_process');
const launch = JSON.parse(process.argv[1]);
const child = spawn(process.execPath, launch.args, { stdio: launch.stdio });
child.stdout.pipe(process.stdout);
setInterval(() => {}, 60000);`;
    const parent = spawn(
      process.execPath,
      ['-e', parentSource, JSON.stringify(launch)],
      { stdio: ['ignore', 'pipe', 'inherit'] }
    );
    started.push(parent.pid!);
    const [serverPid, port] = (await firstLine(parent.stdout!))
      .split(' ')
      .map(Number);
    started.push(serverPid);
    expect(await connects(port)).toBe(true);

    parent.kill('SIGKILL');

    await vi.waitFor(() => expect(alive(serverPid)).toBe(false), {
      timeout: 10_000,
      interval: 20,
    });
  });
});
