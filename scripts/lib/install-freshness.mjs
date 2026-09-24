import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { nodePtyBindingPath } from './native-preflight.mjs';

/**
 * Is `node_modules` the result of installing the lockfile that is checked out?
 *
 * pnpm copies the lockfile it installed from to `node_modules/.pnpm/lock.yaml`.
 * When that copy differs from the root `pnpm-lock.yaml`, the tree on disk is
 * NOT what the repository declares — some packages the lockfile dropped are
 * still present, and some it added are missing.
 *
 * This matters far beyond a slow install. Any check that reads `node_modules`
 * reports on a tree nobody committed:
 *
 *  - `check-dependency-licenses.mjs` enumerates INSTALLED packages, so a stale
 *    tree makes it demand notice rows for dependencies the repository no longer
 *    has. That already happened here — `96a46601` exists solely to remove a
 *    notice row for an uninstalled dependency, and the message that invited it
 *    said the notices were stale when the truth was that the checkout was.
 *  - a long-lived checkout fails patched-dependency tests until it reinstalls,
 *    which once made a bisect blame an innocent commit.
 *
 * So the durable rule is that a script whose output depends on `node_modules`
 * should establish that `node_modules` is trustworthy BEFORE it reports on it,
 * and should name the real remedy rather than the apparent one.
 */
export async function installFreshness(root) {
  const declared = await readFile(
    path.join(root, 'pnpm-lock.yaml'),
    'utf8'
  ).catch(() => null);
  if (declared === null) {
    return { fresh: false, reason: 'no pnpm-lock.yaml in this checkout' };
  }
  const installed = await readFile(
    path.join(root, 'node_modules', '.pnpm', 'lock.yaml'),
    'utf8'
  ).catch(() => null);
  if (installed === null) {
    return {
      fresh: false,
      reason: 'dependencies have never been installed here',
    };
  }
  if (installed !== declared) {
    return {
      fresh: false,
      reason: 'node_modules was installed from a different lockfile',
    };
  }
  return { fresh: true, reason: null };
}

/** Throw with the real remedy when `node_modules` cannot be trusted. */
export async function assertInstallFresh(root, { task }) {
  const { fresh, reason } = await installFreshness(root);
  if (fresh) return;
  throw new Error(
    `${task} reads node_modules, and this checkout's node_modules is not the ` +
      `installed form of its lockfile (${reason}).\n` +
      'Run `pnpm install` here first. Do NOT regenerate against this tree: it ' +
      'would record dependencies the repository no longer declares.'
  );
}

/** The install a checkout owes its committed lockfile: never a new one. */
export const FROZEN_INSTALL_ARGS = Object.freeze([
  'install',
  '--frozen-lockfile',
  '--prefer-offline',
]);

/**
 * Make `node_modules` the installed form of the checked-out lockfile again,
 * when it is not, before anything reads it (BUG-219).
 *
 * The landing's automatic queue-head rebase brought `e3115004`'s jsdom
 * lockfile bump into ticket 476, nothing reinstalled, and the re-check failed
 * `test:agent-delivery` on a tree nobody committed. The same holds for a
 * worktree submitted with a stale install of its own lockfile. The lockfile
 * is the whole contract: workspace package links are its `importers`, and a
 * pnpm patch is its `patchedDependencies` hash, so one comparison covers
 * dependencies, `packages/*` links and the patched `cmdk` alike.
 *
 * Returns null when the tree was already fresh; otherwise what was stale and
 * what it took. A frozen install that fails, or that leaves the tree still
 * stale, throws: a reinstall is believed only when the comparison agrees.
 *
 * A worktree bootstrapped for Electron carries node-pty's native binding,
 * which pnpm never builds; if the install removed it, it is rebuilt the way
 * `pnpm worktree:setup` builds it, so the landing never leaves the tree less
 * ready than it found it.
 */
export async function reinstallWhenStale(root, { run }) {
  // A tree that declares no lockfile has no installed form to restore. Only
  // its absence means that; any other failure to read it is an error.
  try {
    await stat(path.join(root, 'pnpm-lock.yaml'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const before = await installFreshness(root);
  if (before.fresh) return null;
  const hadNodePty = Boolean(nodePtyBindingPath(root));
  const startedAt = Date.now();
  try {
    await run('pnpm', [...FROZEN_INSTALL_ARGS], root);
  } catch (error) {
    throw new Error(
      `node_modules is not the installed form of this tree's lockfile ` +
        `(${before.reason}), and \`pnpm ${FROZEN_INSTALL_ARGS.join(' ')}\` ` +
        `failed: ${error.message}\n` +
        'A frozen install fails when the committed pnpm-lock.yaml does not ' +
        'satisfy package.json. Run `pnpm install`, commit the lockfile it ' +
        'writes, and land again.'
    );
  }
  const after = await installFreshness(root);
  if (!after.fresh) {
    throw new Error(
      `\`pnpm ${FROZEN_INSTALL_ARGS.join(' ')}\` exited 0 and node_modules ` +
        `still is not the installed form of the lockfile (${after.reason}).`
    );
  }
  let nodePtyRebuilt = false;
  if (hadNodePty && !nodePtyBindingPath(root)) {
    await run('pnpm', ['electron:rebuild'], root);
    if (!nodePtyBindingPath(root)) {
      throw new Error(
        "the reinstall removed node-pty's native binding and " +
          '`pnpm electron:rebuild` did not restore it; every PTY spawn in an ' +
          'Electron gate would fail.'
      );
    }
    nodePtyRebuilt = true;
  }
  return {
    reason: before.reason,
    durationMs: Date.now() - startedAt,
    nodePtyRebuilt,
  };
}
