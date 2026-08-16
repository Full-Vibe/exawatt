// The Electron main process's runtime dependency snapshot (BUG-016).
//
// `dist-electron/node_modules` is a PACKAGING SNAPSHOT. electron-builder ships
// `dist-electron/**/*` and excludes `node_modules/**/*`, so the packed app can
// only require what has been copied under `dist-electron` first. Nothing in
// development needs it: Node resolution from `dist-electron/main/main.js` walks
// up to the checkout's own `node_modules`, where pnpm links `@exawatt/core`
// straight at `packages/core` — the same graph the renderer, the tests and the
// evals read.
//
// That is exactly what made BUG-016 possible. A snapshot written by one
// packaging or eval run stays on disk, and from then on it SHADOWS the
// workspace package for every later dev launch. `electron:compile` rebuilds
// `@exawatt/core` and never refreshed the copy, so main ran a four-day-old
// build of a package the renderer had current: main threw
// `WindowObservationAccumulator is not a constructor` mid-bootstrap and the
// app booted to a paused command engine.
//
// So the snapshot is now created only by the packaging step that consumes it
// immediately, and `electron:compile` — the step that rebuilds the workspace
// package — discards it. A snapshot that does not exist during development
// cannot be stale during development.
import { cp, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Runtime packages the packed main process requires but electron-builder
 *  will not ship from `node_modules`. Transitive `dependencies` are staged
 *  with them. */
export const RUNTIME_PACKAGES = [
  'node-pty',
  'electron-updater',
  '@supabase/ssr',
  '@supabase/supabase-js',
  '@exawatt/core',
];

export function snapshotRoot(root) {
  return path.join(root, 'dist-electron', 'node_modules');
}

async function resolvePackageManifest(name, localRequire) {
  try {
    return localRequire.resolve(`${name}/package.json`);
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;

    let directory = path.dirname(await realpath(localRequire.resolve(name)));
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      try {
        const parsed = JSON.parse(await readFile(candidate, 'utf8'));
        if (parsed.name === name) return candidate;
      } catch (candidateError) {
        if (candidateError?.code !== 'ENOENT') throw candidateError;
      }
      directory = path.dirname(directory);
    }
    throw error;
  }
}

/**
 * Write the packaging snapshot from the CURRENT workspace. Call it from the
 * packaging step, immediately before electron-builder reads it — never as a
 * durable artifact that a later run inherits.
 */
export async function stageRuntimeDependencies(root) {
  const dependencyRoot = snapshotRoot(root);
  await rm(dependencyRoot, { recursive: true, force: true });
  await mkdir(dependencyRoot, { recursive: true });

  const staged = new Set();

  async function stagePackage(name, resolveFrom = path.join(root, 'package.json')) {
    if (staged.has(name)) return;
    staged.add(name);
    const localRequire = createRequire(resolveFrom);
    const manifest = await resolvePackageManifest(name, localRequire);
    const source = await realpath(path.dirname(manifest));
    const target = path.join(dependencyRoot, ...name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, dereference: true });
    const parsed = JSON.parse(await readFile(manifest, 'utf8'));
    for (const dependency of Object.keys(parsed.dependencies ?? {})) {
      await stagePackage(dependency, manifest);
    }
  }

  for (const name of RUNTIME_PACKAGES) await stagePackage(name);
  return staged;
}

/** Remove the packaging snapshot so development resolves the workspace. */
export async function discardRuntimeDependencies(root) {
  const dependencyRoot = snapshotRoot(root);
  await rm(dependencyRoot, { recursive: true, force: true });
  return dependencyRoot;
}

/**
 * Refuse to launch a DEVELOPMENT Electron against a packaging snapshot.
 *
 * The invariant `electron:compile` establishes is checked here rather than
 * assumed, because the failure it prevents is silent: main runs a package the
 * rest of the tree has already rebuilt, and the only evidence is a stderr line
 * behind a splash screen (BUG-016, incident `0010`'s class).
 */
export async function assertNoPackagingSnapshot(root) {
  const dependencyRoot = snapshotRoot(root);
  const present = await stat(dependencyRoot).then(
    entry => entry.isDirectory(),
    () => false
  );
  if (!present) return;
  throw new Error(
    `A packaging snapshot exists at ${path.relative(root, dependencyRoot)}. ` +
      'The Electron main process would load ITS copy of @exawatt/core instead ' +
      'of this checkout\'s, and a stale copy boots to a paused command engine. ' +
      'Run: pnpm electron:compile'
  );
}
