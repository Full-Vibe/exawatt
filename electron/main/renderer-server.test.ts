import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import type { ChildProcess, SpawnOptions } from 'child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRendererServer,
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
    allocatePort: async () => 34567,
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
    probeCount: () => probes,
    answerAfter: (n: number) => {
      answerAfter = n;
    },
  };
}

const versionRoot = () =>
  path.join(userData, 'renderer-cache', 'community', HASH);

describe('createRendererServer', () => {
  it('unpacks a cold version, runs its server as Node on loopback, and reports the origin once it answers', async () => {
    const { server, spawned, extracted } = harness();
    expect(server.hasWarmCache()).toBe(false);
    expect(server.origin).toBeNull();

    const origin = await server.start();

    expect(origin).toBe('http://127.0.0.1:34567');
    expect(server.origin).toBe(origin);
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
    const { server, spawned, answerAfter } = harness();
    answerAfter(Number.POSITIVE_INFINITY);
    const started = server.start();
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    spawned[0].child.exit(1);

    await expect(started).rejects.toThrow('Packaged renderer exited with 1');
    expect(server.origin).toBeNull();
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
