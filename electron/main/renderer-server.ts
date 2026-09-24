import {
  execFile,
  spawn as spawnChild,
  type ChildProcess,
  type SpawnOptions,
} from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { promisify } from 'util';
import { stopChildProcess } from './child-process-lifecycle';
import type { RendererPortPolicy } from './renderer-port';

/**
 * The packaged renderer server: the Next standalone payload, unpacked into a
 * versioned cache under `userData` and run as a loopback child of Electron
 * main. This module is its one owner. It starts the child, reports the origin
 * it serves, stops it during shutdown, and prunes versions it no longer runs.
 * The child also carries a lifeline to main, so it ends with main however main
 * ends, including the endings where main runs no shutdown code at all. The
 * reverse ending is reported rather than handled here: when the child dies
 * while main lives (killed from outside, BUG-223), `onUnexpectedExit` says so
 * and `restart` brings it back on the same port, so the origin, and the
 * storage Chromium keeps under it, survive.
 *
 * Every process boundary is an argument (`spawn`, the archive extractor, port
 * allocation, the readiness probe, the clock), so the lifecycle is exercised
 * with a fake child process rather than a packaged app.
 */

type Spawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

interface RendererServerClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RendererServerDependencies {
  /** Holds `renderer/renderer.zip` and its hash (`process.resourcesPath`). */
  resourcesPath?: string;
  /** Read late: `userData` may be redirected before the first start. */
  userDataPath: () => string;
  /** The distribution's renderer-cache namespace. */
  cacheNamespace: string;
  /** The Electron binary, run as Node for the server (`process.execPath`). */
  execPath?: string;
  /** Names this process's staging directory so two launches never share one. */
  pid?: number;
  /** Faster force-stop and cache pruning under automation. */
  isTest: boolean;
  /** The distribution-scoped environment the child inherits. */
  childEnvironment: () => NodeJS.ProcessEnv;
  /** Mirrors the server's stdout (EXAWATT_RENDERER_LOGS=1). */
  forwardStdout: boolean;
  spawn?: Spawn;
  /** Unpacks `archive` into the empty directory `destination` (default: ditto). */
  extractArchive?: (archive: string, destination: string) => Promise<void>;
  /** Which port to serve on, told once the server answers (BUG-022). */
  ports: RendererPortPolicy;
  probe?: (url: string) => Promise<boolean>;
  clock?: RendererServerClock;
  writeStdout?: (data: unknown) => void;
  writeStderr?: (data: unknown) => void;
  warn?: (message: string, error: unknown) => void;
  /** The serving child ended without `stop()` asking it to (BUG-223). */
  onUnexpectedExit?: (details: {
    code: number | null;
    signal: string | null;
  }) => void;
}

interface RendererServer {
  /** Starts the child and resolves with the origin once it answers. */
  start(): Promise<string>;
  /** Stops the child; a rejection keeps it owned so a retry can stop it. */
  stop(): Promise<void>;
  /** Starts the child again on the port it was serving, same origin. */
  restart(): Promise<string>;
  /** The origin being served, or null before the first successful start. */
  readonly origin: string | null;
  /** Whether this version is already unpacked, so start can run pre-ready. */
  hasWarmCache(): boolean;
  /** Removes every cached version except the one this launch runs. */
  pruneCache(): void;
}

/** One readiness probe: any non-5xx answer means the server is serving. */
async function probeRenderer(url: string): Promise<boolean> {
  return await new Promise<boolean>(resolve => {
    const request = http.get(url, response => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 500);
    });
    request.once('error', () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

/**
 * The first thing the renderer server child runs, before Next's `server.js`
 * (BUG-070). It is passed as `-e` source, so what the child executes is
 * exactly this text.
 *
 * The child's stdin is a pipe whose only writer is Electron main, and main
 * never writes to it or closes it. However main ends (quit, crash, SIGKILL,
 * Force Quit) the kernel closes that writer, and the child reads end of file.
 * That is the one signal that still arrives when the parent is in no state to
 * cooperate, and without it the server reparented to launchd and kept its
 * port, its memory, and a Dock icon of its own. A normal quit still stops
 * the child first through `stop()`; this is what makes every other ending
 * behave the same way.
 */
const RENDERER_SERVER_LIFELINE = [
  "process.stdin.once('end', () => process.exit(0));",
  "process.stdin.once('error', () => process.exit(0));",
  'process.stdin.resume();',
  'require(process.argv[1]);',
].join('\n');

/** How the renderer server child is launched: the lifeline, then the entry. */
export function rendererServerLaunch(serverEntry: string): {
  args: string[];
  stdio: ['pipe', 'pipe', 'pipe'];
} {
  return {
    args: ['-e', RENDERER_SERVER_LIFELINE, serverEntry],
    // stdin MUST be a pipe held by main: 'ignore' would hand the child
    // /dev/null, which reads as end of file at once and ends the server.
    stdio: ['pipe', 'pipe', 'pipe'],
  };
}

const realClock: RendererServerClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export function createRendererServer(
  deps: RendererServerDependencies
): RendererServer {
  const probe = deps.probe ?? probeRenderer;
  const spawn = deps.spawn ?? spawnChild;
  const extractArchive =
    deps.extractArchive ??
    (async (archive: string, destination: string) => {
      await promisify(execFile)('/usr/bin/ditto', [
        '-x',
        '-k',
        archive,
        destination,
      ]);
    });
  const clock = deps.clock ?? realClock;
  const writeStdout =
    deps.writeStdout ?? (data => process.stdout.write(data as Buffer));
  const writeStderr =
    deps.writeStderr ?? (data => process.stderr.write(data as Buffer));
  const warn = deps.warn ?? ((message, error) => console.warn(message, error));
  const packagedRenderer = path.join(
    deps.resourcesPath ?? process.resourcesPath,
    'renderer'
  );
  const execPath = deps.execPath ?? process.execPath;
  const pid = deps.pid ?? process.pid;

  let rendererServer: ChildProcess | null = null;
  let rendererOrigin: string | null = null;
  let activeRendererCacheKey: string | null = null;
  /** What the serving child was launched from, for a same-port restart. */
  let served: { standaloneRoot: string; port: number } | null = null;
  /** Set once `stop()` is asked: every exit after that is expected. */
  let stopping = false;

  const cacheRoot = () =>
    path.join(deps.userDataPath(), 'renderer-cache', deps.cacheNamespace);

  async function waitForRenderer(url: string): Promise<void> {
    const deadline = clock.now() + 30_000;
    while (clock.now() < deadline) {
      const ready = await probe(url);
      if (ready) return;
      // A child killed by a signal has a null exit code and a signal code.
      const child = rendererServer;
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(
          `Packaged renderer exited with ${child?.exitCode ?? child?.signalCode}`
        );
      }
      await clock.sleep(40);
    }
    throw new Error('Timed out starting the packaged renderer');
  }

  async function startPackagedRenderer(): Promise<string> {
    const port = await deps.ports.allocate();
    const archive = path.join(packagedRenderer, 'renderer.zip');
    const archiveHash = (
      await fs.promises.readFile(
        path.join(packagedRenderer, 'renderer.sha256'),
        'utf8'
      )
    ).trim();
    activeRendererCacheKey = archiveHash;
    const versionRoot = path.join(cacheRoot(), archiveHash);
    const standaloneRoot = path.join(versionRoot, 'dist-renderer');
    try {
      await fs.promises.access(path.join(standaloneRoot, 'server.js'));
    } catch {
      const staging = `${versionRoot}.staging-${pid}`;
      await fs.promises.rm(staging, { recursive: true, force: true });
      await fs.promises.mkdir(staging, { recursive: true });
      await extractArchive(archive, staging);
      await fs.promises.mkdir(cacheRoot(), { recursive: true });
      await fs.promises.rename(staging, versionRoot).catch(async error => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        await fs.promises.rm(staging, { recursive: true, force: true });
      });
    }
    const origin = await serve(standaloneRoot, port);
    await deps.ports.serving(port);
    return origin;
  }

  /** Spawns the server child on `port` and resolves once it answers. */
  async function serve(standaloneRoot: string, port: number): Promise<string> {
    const serverEntry = path.join(standaloneRoot, 'server.js');
    const launch = rendererServerLaunch(serverEntry);
    const child = spawn(execPath, launch.args, {
      cwd: standaloneRoot,
      env: {
        ...deps.childEnvironment(),
        ELECTRON_RUN_AS_NODE: '1',
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'production',
      },
      stdio: launch.stdio,
    });
    rendererServer = child;
    // A child that dies while starting is reported by the start that launched
    // it, so only an exit after it answered is unexpected.
    let answered = false;
    const reportExit = (code: number | null, signal: string | null) => {
      if (!answered || stopping || rendererServer !== child) return;
      deps.onUnexpectedExit?.({ code, signal });
    };
    child.once('exit', reportExit);
    child.stdout?.on('data', data => {
      if (deps.forwardStdout) writeStdout(data);
    });
    child.stderr?.on('data', data => writeStderr(data));
    const origin = `http://127.0.0.1:${port}`;
    await waitForRenderer(`${origin}/workspace`);
    rendererOrigin = origin;
    served = { standaloneRoot, port };
    answered = true;
    // The exit may have landed during the last readiness probe.
    if (child.exitCode !== null || child.signalCode !== null) {
      reportExit(child.exitCode, child.signalCode);
    }
    return origin;
  }

  async function restartRendererServer(): Promise<string> {
    if (!served) throw new Error('The packaged renderer has not served yet');
    if (stopping) throw new Error('The packaged renderer is stopping');
    return await serve(served.standaloneRoot, served.port);
  }

  function pruneRendererCache(): void {
    const root = cacheRoot();
    const keep = activeRendererCacheKey;
    if (!keep) return;
    const delay = deps.isTest ? 250 : 15_000;
    setTimeout(() => {
      void fs.promises
        .readdir(root, { withFileTypes: true })
        .then(entries =>
          Promise.all(
            entries
              .filter(entry => entry.name !== keep)
              .map(entry =>
                fs.promises.rm(path.join(root, entry.name), {
                  recursive: true,
                  force: true,
                })
              )
          )
        )
        .catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            warn('[startup] could not prune renderer cache', error);
          }
        });
    }, delay).unref?.();
  }

  function hasWarmRendererCache(): boolean {
    try {
      const key = fs
        .readFileSync(path.join(packagedRenderer, 'renderer.sha256'), 'utf8')
        .trim();
      return fs.existsSync(
        path.join(cacheRoot(), key, 'dist-renderer', 'server.js')
      );
    } catch {
      return false;
    }
  }

  async function stopRendererServer(): Promise<void> {
    stopping = true;
    const server = rendererServer;
    if (!server) return;
    await stopChildProcess(server, {
      forceAfterMs: deps.isTest ? 250 : 1_500,
      failAfterMs: deps.isTest ? 2_000 : 5_000,
      failureMessage: 'Packaged renderer did not stop during shutdown',
    });
    // Clear ownership only after the process is truthfully stopped. A rejection
    // leaves the same handle available to the next shutdown attempt.
    if (rendererServer === server) rendererServer = null;
  }

  return {
    start: startPackagedRenderer,
    stop: stopRendererServer,
    restart: restartRendererServer,
    get origin() {
      return rendererOrigin;
    },
    hasWarmCache: hasWarmRendererCache,
    pruneCache: pruneRendererCache,
  };
}
