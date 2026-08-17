#!/usr/bin/env node

/**
 * Prove a renderer archive can actually serve (BUG-036).
 *
 * `output: 'standalone'` produces the renderer payload by TRACING, and a trace
 * is a static approximation of a dynamic resolution. `@swc/helpers` was traced
 * under the `require` condition and loaded under `module-sync`, so the archive
 * shipped `cjs/` while Node asked for `esm/`; the standalone server exited 1 on
 * its first require and the app booted to `Command engine paused`. Nothing
 * between `next build` and a user's launch read the payload back, which is
 * incident `0010`'s class exactly, one layer over.
 *
 * Enumerating the missing files would fix one gap. Booting the archive proves
 * the whole payload, so the NEXT dependency the trace resolves under the wrong
 * condition fails the build instead of the launch. This is the proof; both the
 * archive step and the packed-bundle assertion run it.
 *
 * The archive is extracted OUTSIDE the repository on purpose. A bare specifier
 * missing from `dist-renderer` would resolve up the parent chain into the
 * checkout's own `node_modules` and boot happily, which is the false negative
 * that makes an in-tree probe worthless.
 *
 * Usage: node scripts/lib/renderer-archive.mjs <renderer.zip> [executable]
 */

import { execFile, spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** The layout `startPackagedRenderer` extracts and runs. */
const STANDALONE_DIR = 'dist-renderer';

async function freeLoopbackPort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error =>
        error ? reject(error) : resolve(address.port)
      );
    });
  });
}

async function respondsOk(url) {
  return await new Promise(resolve => {
    const request = http.get(url, response => {
      response.resume();
      resolve(response.statusCode !== undefined && response.statusCode < 400);
    });
    request.once('error', () => resolve(false));
    request.setTimeout(2_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

/**
 * Extract `archive`, start its standalone server the way the app does, and
 * resolve once it answers `/workspace`. Throws with the server's own output —
 * a module-resolution failure names the file it wanted, which is the whole
 * diagnosis.
 *
 * `executable` defaults to this Node, but callers holding a bundle should pass
 * the bundle's own Electron binary: the defect is a property of the Node
 * version that will actually run the server, so the proof should use it.
 */
export async function assertRendererArchiveServes(
  archive,
  { executable = process.execPath, timeoutMs = 90_000, label = archive } = {}
) {
  await access(archive).catch(() => {
    throw new Error(`No renderer archive at ${archive}`);
  });
  const staging = await mkdtemp(path.join(tmpdir(), 'exawatt-renderer-boot-'));
  const standaloneRoot = path.join(staging, STANDALONE_DIR);
  let server = null;
  const output = [];
  try {
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', archive, staging]);
    const entry = path.join(standaloneRoot, 'server.js');
    await access(entry).catch(() => {
      throw new Error(
        `${label} has no ${STANDALONE_DIR}/server.js; the packaged app extracts ` +
          'exactly that path and would have nothing to run.'
      );
    });

    const port = await freeLoopbackPort();
    // Absolute: the child runs with `cwd` inside the extracted archive, so a
    // relative executable would be resolved against the wrong directory.
    server = spawn(path.resolve(executable), [entry], {
      cwd: standaloneRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        HOSTNAME: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'production',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', chunk => output.push(String(chunk)));
    server.stderr?.on('data', chunk => output.push(String(chunk)));
    let exited = null;
    server.once('exit', code => {
      exited = code ?? 1;
    });
    // A spawn that never started is a failed boot like any other; without this
    // handler Node turns it into an unhandled 'error' event and the assertion
    // dies instead of reporting.
    server.once('error', error => {
      output.push(`${error.message}\n`);
      exited = exited ?? 1;
    });

    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    const url = `http://127.0.0.1:${port}/workspace`;
    for (;;) {
      if (await respondsOk(url)) {
        return { ms: Date.now() - startedAt, port };
      }
      if (exited !== null) {
        throw new Error(
          `${label} does not serve: its standalone server exited ${exited} ` +
            'before answering /workspace. The renderer never starts, so the ' +
            'app boots to `Command engine paused`.\n' +
            output.join('').trim()
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `${label} did not answer /workspace within ${timeoutMs}ms.\n` +
            output.join('').trim()
        );
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  } finally {
    if (server && server.exitCode === null) server.kill('SIGKILL');
    await rm(staging, { recursive: true, force: true });
  }
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const [archive, executable] = process.argv.slice(2);
  if (!archive) {
    console.error('usage: renderer-archive.mjs <renderer.zip> [executable]');
    process.exit(2);
  }
  try {
    const { ms } = await assertRendererArchiveServes(archive, {
      executable: executable || process.execPath,
    });
    console.log(`[renderer-archive] served /workspace in ${ms}ms`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
