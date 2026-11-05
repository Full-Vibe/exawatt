import { execFile } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { promisify } from 'util';
import type { RendererPortPolicy } from './renderer-port';

/**
 * The packaged renderer server: the Next standalone payload, unpacked into a
 * versioned cache under `userData` and run on loopback as an Electron utility
 * process (BUG-310). This module is its one owner. It starts the server,
 * reports the origin it serves, stops it during shutdown, and prunes versions
 * it no longer runs.
 *
 * A utility process runs from the app's helper bundle, which macOS treats as
 * a helper (`LSUIElement`), not an application. The server used to run as the
 * app's own executable in Node mode, and Next naming its process
 * (`process.title`) made macOS register that executable as a second running
 * application with the app's bundle id: two entries in every app switcher,
 * one without a window.
 *
 * Chromium also ties a utility process to main: it ends when main ends,
 * including the endings where main runs no shutdown code at all (BUG-070).
 * The reverse ending is reported rather than handled here: when the server
 * dies while main lives (killed from outside, BUG-223), `onUnexpectedExit`
 * says so and `restart` brings it back on the same port, so the origin, and
 * the storage Chromium keeps under it, survive. Chromium records the same
 * death as a `child-process-gone` of the service named here.
 *
 * Every process boundary is an argument (`fork`, the archive extractor, port
 * allocation, the readiness probe, the clock), so the lifecycle is exercised
 * with a double of the utility process rather than a packaged app.
 */

/**
 * The part of Electron's `UtilityProcess` this module uses. `kill()` asks the
 * process to end (SIGTERM) and Chromium ends it outright if it has not after
 * two seconds; it does nothing before `spawn`. `exit` carries the wait status
 * code, which is the signal's number for a process a signal ended.
 */
export interface ServerProcess {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(): boolean;
  once(event: 'spawn', listener: () => void): this;
  once(event: 'exit', listener: (code: number) => void): this;
}

/** `utilityProcess.fork`, which only works once Electron is ready. */
export type ForkServer = (
  modulePath: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: 'pipe';
    serviceName: string;
  }
) => ServerProcess;

/** The server's name in Chromium's process records (`child.gone`). */
export const RENDERER_SERVER_SERVICE = 'Renderer Server';

/** How long a stop waits for the exit, past Chromium's own forced end. */
const STOP_DEADLINE_MS = 5_000;

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
  /** Names this process's staging directory so two launches never share one. */
  pid?: number;
  /** Faster cache pruning under automation. */
  isTest: boolean;
  /** The distribution-scoped environment the server inherits. */
  childEnvironment: () => NodeJS.ProcessEnv;
  /** Mirrors the server's stdout (EXAWATT_RENDERER_LOGS=1). */
  forwardStdout: boolean;
  /** Starts the server process; call `start` only once Electron is ready. */
  fork: ForkServer;
  /** Unpacks `archive` into the empty directory `destination` (default: ditto). */
  extractArchive?: (archive: string, destination: string) => Promise<void>;
  /** Which port to serve on, told once the server answers (BUG-022). */
  ports: RendererPortPolicy;
  probe?: (url: string) => Promise<boolean>;
  clock?: RendererServerClock;
  writeStdout?: (data: unknown) => void;
  writeStderr?: (data: unknown) => void;
  warn?: (message: string, error: unknown) => void;
  /** The serving process ended without `stop()` asking it to (BUG-223). */
  onUnexpectedExit?: (details: { code: number }) => void;
}

interface RendererServer {
  /** Starts the server and resolves with the origin once it answers. */
  start(): Promise<string>;
  /** Stops the server; a rejection keeps it owned so a retry can stop it. */
  stop(): Promise<void>;
  /** Starts the server again on the port it was serving, same origin. */
  restart(): Promise<string>;
  /** True when a server has served before and none is serving now. */
  isDown(): boolean;
  /** The origin being served, or null before the first successful start. */
  readonly origin: string | null;
  /** Whether this version is already unpacked, so start can run pre-ready. */
  hasWarmCache(): boolean;
  /**
   * Removes what earlier launches left behind once startup is done: every
   * cached version except the one this launch runs, and (through the port
   * policy, BUG-170) every renderer origin's storage but the kept one.
   */
  pruneLeftovers(): void;
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

/** A server process and what this module has seen of it. */
interface ServerChild {
  readonly process: ServerProcess;
  /** The exit code once it has exited, else null. */
  exitCode: number | null;
  readonly exited: Promise<number>;
  readonly spawned: Promise<void>;
}

function track(server: ServerProcess): ServerChild {
  let markSpawned: () => void = () => {};
  const spawned = new Promise<void>(resolve => {
    markSpawned = resolve;
  });
  const child: ServerChild = {
    process: server,
    exitCode: null,
    spawned,
    exited: new Promise<number>(resolve => {
      server.once('exit', code => {
        child.exitCode = code;
        // A process that failed to launch exits without ever spawning.
        markSpawned();
        resolve(code);
      });
    }),
  };
  server.once('spawn', markSpawned);
  return child;
}

/**
 * Asks `child` to end and resolves once it has. `kill()` does nothing before
 * the process has spawned, so a stop that arrives first waits for the spawn.
 * Chromium ends a process that ignores the request after two seconds; a
 * process that has still not exited by the deadline rejects, and stays owned
 * by the caller so a later stop can try again.
 */
async function stopServerProcess(
  child: ServerChild,
  failureMessage: string
): Promise<void> {
  if (child.exitCode !== null) return;
  void child.spawned.then(() => {
    if (child.exitCode === null) child.process.kill();
  });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(
          () => reject(new Error(failureMessage)),
          STOP_DEADLINE_MS
        );
      }),
    ]);
  } finally {
    clearTimeout(deadline);
  }
}

const realClock: RendererServerClock = {
  now: () => Date.now(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

export function createRendererServer(
  deps: RendererServerDependencies
): RendererServer {
  const probe = deps.probe ?? probeRenderer;
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
  const pid = deps.pid ?? process.pid;

  let rendererServer: ServerChild | null = null;
  let rendererOrigin: string | null = null;
  let activeRendererCacheKey: string | null = null;
  /** What the serving process was launched from, for a same-port restart. */
  let served: { standaloneRoot: string; port: number } | null = null;
  /**
   * True while a `stop()` is in flight: the exit it asks for is expected, and
   * nothing may start a replacement under it. Cleared when the stop settles,
   * so after a shutdown that is abandoned a later death is reported and a
   * restart is allowed again.
   */
  let stopping = false;

  const cacheRoot = () =>
    path.join(deps.userDataPath(), 'renderer-cache', deps.cacheNamespace);

  /**
   * Resolves once `child` answers. An answer is only ever read as the child's
   * while the child is alive: the port can also be answered by another
   * program (one that took it, or one on the wildcard address the child's
   * loopback bind shadows), and a child that died on its bind leaves exactly
   * that program answering.
   */
  async function waitForRenderer(
    url: string,
    child: ServerChild
  ): Promise<void> {
    const deadline = clock.now() + 30_000;
    while (clock.now() < deadline) {
      const ready = await probe(url);
      if (child.exitCode !== null) {
        throw new Error(`Packaged renderer exited with ${child.exitCode}`);
      }
      if (ready) return;
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

  /** Forks the server on `port` and resolves once it answers. */
  async function serve(standaloneRoot: string, port: number): Promise<string> {
    const origin = `http://127.0.0.1:${port}`;
    // Nothing of ours serves yet, so an answer now is another program's.
    if (await probe(`${origin}/workspace`)) {
      throw new Error(
        `Packaged renderer port ${port} is answered by another program`
      );
    }
    const server = deps.fork(path.join(standaloneRoot, 'server.js'), [], {
      cwd: standaloneRoot,
      env: {
        ...deps.childEnvironment(),
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
      serviceName: RENDERER_SERVER_SERVICE,
    });
    const child = track(server);
    rendererServer = child;
    // A server that dies while starting is reported by the start that
    // launched it (the promise rejects), so only an exit after it answered is
    // unexpected.
    let answered = false;
    void child.exited.then(code => {
      if (!answered || stopping || rendererServer !== child) return;
      deps.onUnexpectedExit?.({ code });
    });
    server.stdout?.on('data', data => {
      if (deps.forwardStdout) writeStdout(data);
    });
    server.stderr?.on('data', data => writeStderr(data));
    try {
      await waitForRenderer(`${origin}/workspace`, child);
      // The exit may have landed after the last readiness check: a server
      // that is already gone was never handed over.
      if (child.exitCode !== null) {
        throw new Error(`Packaged renderer exited with ${child.exitCode}`);
      }
    } catch (error) {
      await discard(child, error);
      throw error;
    }
    rendererOrigin = origin;
    served = { standaloneRoot, port };
    answered = true;
    return origin;
  }

  /**
   * Ends a child whose start failed. One that never answered still holds its
   * port, and the next start on that port would fail behind it, so it is
   * stopped before the failure is reported. If it will not stop, it stays
   * owned so shutdown can try again, and the failure says so.
   */
  async function discard(child: ServerChild, cause: unknown): Promise<void> {
    try {
      await stopServerProcess(
        child,
        'Packaged renderer did not stop after a failed start'
      );
    } catch (stopError) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `${reason}; ${stopError instanceof Error ? stopError.message : String(stopError)}`
      );
    }
    if (rendererServer === child) rendererServer = null;
  }

  async function restartRendererServer(): Promise<string> {
    if (!served) throw new Error('The packaged renderer has not served yet');
    if (stopping) throw new Error('The packaged renderer is stopping');
    return await serve(served.standaloneRoot, served.port);
  }

  function pruneLeftovers(): void {
    void deps.ports.sweepDeadOrigins();
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
    const server = rendererServer;
    if (!server) return;
    stopping = true;
    try {
      await stopServerProcess(
        server,
        'Packaged renderer did not stop during shutdown'
      );
      // Clear ownership only after the process is truthfully stopped. A
      // rejection leaves the same handle available to the next shutdown.
      if (rendererServer === server) rendererServer = null;
    } finally {
      stopping = false;
    }
  }

  function isRendererServerDown(): boolean {
    if (!served) return false;
    const child = rendererServer;
    return !child || child.exitCode !== null;
  }

  return {
    start: startPackagedRenderer,
    stop: stopRendererServer,
    restart: restartRendererServer,
    isDown: isRendererServerDown,
    get origin() {
      return rendererOrigin;
    },
    hasWarmCache: hasWarmRendererCache,
    pruneLeftovers,
  };
}
