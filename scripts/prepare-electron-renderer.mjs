import {
  access,
  cp,
  lstat,
  mkdir,
  opendir,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

import { assertRendererArchiveServes } from './lib/renderer-archive.mjs';

const execFileAsync = promisify(execFile);

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');
const renderer = path.join(root, 'dist-renderer');
const archiveDir = path.join(root, 'dist-renderer-archive');
const archive = path.join(archiveDir, 'renderer.zip');
const staticSource = path.join(root, '.next', 'static');
const staticTarget = path.join(renderer, '.next', 'static');
const publicSource = path.join(root, 'public');
const publicTarget = path.join(renderer, 'public');

await access(path.join(standalone, 'server.js')).catch(() => {
  throw new Error('Missing .next/standalone/server.js; run `pnpm build` first.');
});

async function removeDanglingSymlinks(directory) {
  for await (const entry of await opendir(directory)) {
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      try {
        await realpath(entryPath);
      } catch {
        await rm(entryPath, { force: true });
      }
    } else if (stats.isDirectory()) {
      await removeDanglingSymlinks(entryPath);
    }
  }
}

async function relocateSymlinks(directory) {
  for await (const entry of await opendir(directory)) {
    const entryPath = path.join(directory, entry.name);
    const stats = await lstat(entryPath);
    if (stats.isSymbolicLink()) {
      const target = await readlink(entryPath);
      if (path.isAbsolute(target) && target.startsWith(`${standalone}${path.sep}`)) {
        const relocatedTarget = path.join(renderer, path.relative(standalone, target));
        await rm(entryPath);
        await symlink(path.relative(path.dirname(entryPath), relocatedTarget), entryPath);
      }
    } else if (stats.isDirectory()) {
      await relocateSymlinks(entryPath);
    }
  }
}

await rm(renderer, { recursive: true, force: true });
// Next standalone output uses relative pnpm links within this directory. Keep
// valid links compact, but remove dangling optional links before packaging.
await removeDanglingSymlinks(standalone);
await cp(standalone, renderer, { recursive: true });
await relocateSymlinks(renderer);
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true });

try {
  await access(publicSource);
  await rm(publicTarget, { recursive: true, force: true });
  await cp(publicSource, publicTarget, { recursive: true });
} catch {
  // The app currently has no public/ directory. Keep this future-safe.
}

await rm(archiveDir, { recursive: true, force: true });
await mkdir(archiveDir, { recursive: true });
await execFileAsync('/usr/bin/ditto', [
  '-c',
  '-k',
  '--sequesterRsrc',
  '--keepParent',
  renderer,
  archive,
]);

// Nothing is sealed until it has been booted (BUG-036). `output: 'standalone'`
// builds this payload by TRACING, and the trace resolves export conditions the
// runtime does not use — `@swc/helpers` was traced as CJS and required as ESM,
// so the server exited 1 on its first require and the packaged app showed
// `Command engine paused` with no build-time signal at all. The archive is
// extracted outside the repository and actually started, because a payload
// nobody runs is a payload nobody checks (incident `0010`).
//
// renderer.sha256 is written LAST and only on success: it is the cache key the
// main process reads, so an archive without it can never be served, and a
// failed boot leaves no half-valid pair behind.
try {
  const { ms } = await assertRendererArchiveServes(archive, {
    label: 'the standalone renderer archive',
  });
  console.log(`[electron-renderer] archive served /workspace in ${ms}ms`);
} catch (error) {
  await rm(archiveDir, { recursive: true, force: true });
  throw error;
}

const hash = createHash('sha256');
for await (const chunk of createReadStream(archive)) hash.update(chunk);
await writeFile(
  path.join(archiveDir, 'renderer.sha256'),
  `${hash.digest('hex')}\n`
);

console.log('[electron-renderer] prepared standalone Next archive');
