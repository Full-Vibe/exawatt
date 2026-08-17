// The Electron main process's runtime payload (BUG-016, BUG-030).
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
//
// ---------------------------------------------------------------------------
//
// WHAT IS IN THE SNAPSHOT IS DECLARED HERE, not inherited from the workspace
// (BUG-030). The snapshot used to be a wholesale `cp --dereference` of each
// package directory, so its contents were whatever the workspace happened to
// contain. `packages/core/node_modules` links this package's devDependencies,
// so every user downloaded the TypeScript compiler and vitest inside
// `app.asar`, inside the code signature, on every update.
//
// A named ignore list for `typescript` and `vitest` would be the monkey-patch:
// the next devDependency ships too. The payload is therefore STATED — the
// production dependency closure of `RUNTIME_PACKAGES`, staged flat, each
// package reduced to the files it can actually load on the target platform:
//
//   1. A package's nested `node_modules` is the WORKSPACE'S INSTALL LAYOUT,
//      not the package. Dependencies come from the closure below and are
//      staged flat beside it, so nothing can enter the payload except by
//      being a declared production dependency.
//   2. `prebuilds/<platform>-<arch>` for a platform this build does not
//      target is unreachable code. node-pty resolves exactly
//      `prebuilds/${process.platform}-${process.arch}` (`lib/utils.js`), so
//      the Windows triplets were 4.9 MB of `app.asar` that no macOS build
//      could ever open, next to 2.8 MB of Windows ConPTY/winpty build inputs.
//
// `assertRuntimePayload` in `scripts/release-package.mjs` holds the packed
// bundle to this, so a bundle that drifts from the declaration is refused
// before it becomes a release artifact.
import { readFileSync, realpathSync } from 'node:fs';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Runtime packages the packed main process requires but electron-builder
 *  will not ship from `node_modules`. Their transitive production
 *  `dependencies` are staged with them; nothing else is. */
export const RUNTIME_PACKAGES = [
  'node-pty',
  'electron-updater',
  '@supabase/ssr',
  '@supabase/supabase-js',
  '@exawatt/core',
];

/**
 * Build toolchains that must never reach a user's download. The closure check
 * already refuses them — they are not production dependencies of anything —
 * but a payload assertion that names the compiler it is looking for reports
 * BUG-030 in its own words instead of as an anonymous set difference.
 */
export const BUILD_TOOLCHAIN = ['typescript', 'vitest', 'esbuild', 'rollup', '@swc/core'];

export function snapshotRoot(root) {
  return path.join(root, 'dist-electron', 'node_modules');
}

/** The path of the staged tree inside a packed bundle's `app.asar`. */
export const ASAR_SNAPSHOT_PREFIX = 'dist-electron/node_modules/';

/** `prebuilds/<platform>-<arch>` is the prebuildify/node-gyp-build layout. */
const PREBUILD_TRIPLET = /^prebuilds\/([a-z0-9]+)-[a-z0-9]+(\/|$)/;

/**
 * Whether a path inside a staged package is part of the runtime payload.
 * `relative` is POSIX-separated and relative to the package's own root.
 *
 * Two rules, both about the shape of a package rather than its name, so a
 * package added tomorrow is covered without editing a list:
 *
 * - ANY `node_modules` segment is the install layout, not the package. At the
 *   package root it is where pnpm links devDependencies (this is how the
 *   TypeScript compiler shipped); deeper in it is node-gyp's build stamps.
 * - `prebuilds/<platform>-<arch>` for another platform can never be opened by
 *   this build.
 */
export function isRuntimePayloadPath(relative, platform = process.platform) {
  if (relative === '') return true;
  if (relative.split('/').includes('node_modules')) return false;
  const triplet = PREBUILD_TRIPLET.exec(relative);
  return !triplet || triplet[1] === platform;
}

function resolvePackageManifest(name, localRequire) {
  try {
    return localRequire.resolve(`${name}/package.json`);
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error;

    let directory = path.dirname(realpathSync(localRequire.resolve(name)));
    while (directory !== path.dirname(directory)) {
      const candidate = path.join(directory, 'package.json');
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8'));
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
 * The production dependency closure of `RUNTIME_PACKAGES`: the complete and
 * exclusive list of packages the packed app may carry.
 *
 * The closure is FLAT, so a name resolving to two different package
 * directories is a real ambiguity about what the app would load. That throws
 * rather than picking one, because the alternative is the failure mode this
 * whole file exists for: a payload whose contents are an accident of the
 * install layout.
 *
 * Resolution is synchronous so that the release assertions that read it stay
 * synchronous like the rest of `release-package.mjs`.
 */
export function resolveRuntimeClosure(root) {
  const closure = new Map();

  function visit(name, resolveFrom) {
    const localRequire = createRequire(resolveFrom);
    const manifest = resolvePackageManifest(name, localRequire);
    const directory = realpathSync(path.dirname(manifest));
    const existing = closure.get(name);
    if (existing) {
      if (existing.directory !== directory) {
        throw new Error(
          `${name} resolves to two different packages in the runtime closure ` +
            `(${existing.directory} and ${directory}). The packed app stages one ` +
            'flat tree, so one of them would silently win. Deduplicate the ' +
            'dependency before packaging.'
        );
      }
      return;
    }
    const parsed = JSON.parse(readFileSync(manifest, 'utf8'));
    closure.set(name, { name, version: parsed.version, directory });
    for (const dependency of Object.keys(parsed.dependencies ?? {})) {
      visit(dependency, manifest);
    }
  }

  for (const name of RUNTIME_PACKAGES) {
    visit(name, path.join(root, 'package.json'));
  }
  return closure;
}

/**
 * Write the packaging snapshot from the CURRENT workspace. Call it from the
 * packaging step, immediately before electron-builder reads it — never as a
 * durable artifact that a later run inherits.
 */
export async function stageRuntimeDependencies(root, { platform = process.platform } = {}) {
  const dependencyRoot = snapshotRoot(root);
  await rm(dependencyRoot, { recursive: true, force: true });
  await mkdir(dependencyRoot, { recursive: true });

  const closure = resolveRuntimeClosure(root);
  for (const { name, directory } of closure.values()) {
    const target = path.join(dependencyRoot, ...name.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await cp(directory, target, {
      recursive: true,
      dereference: true,
      filter: source =>
        isRuntimePayloadPath(
          path.relative(directory, source).split(path.sep).join('/'),
          platform
        ),
    });
  }
  return closure;
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

/**
 * The staged package a bundle path belongs to, or `null` if the path is not
 * inside the staged tree. Scoped packages own two path segments.
 */
export function stagedPackageOf(entryPath) {
  if (!entryPath.startsWith(ASAR_SNAPSHOT_PREFIX)) return null;
  const segments = entryPath.slice(ASAR_SNAPSHOT_PREFIX.length).split('/');
  if (segments.length < 2) return null;
  return segments[0].startsWith('@') ? `${segments[0]}/${segments[1]}` : segments[0];
}

/**
 * Every package name a bundle path passes through, at any depth.
 *
 * `stagedPackageOf` answers "whose payload is this", which for a NESTED tree
 * is the outer package — the TypeScript compiler shipped as
 * `@exawatt/core/node_modules/typescript/...`, so asking only the outer name
 * never sees it. This answers "what is in here", which is what a toolchain
 * check has to ask.
 */
export function packagesAlongPath(entryPath) {
  return [
    ...entryPath.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)(?:\/|$)/g),
  ].map(match => match[1]);
}
