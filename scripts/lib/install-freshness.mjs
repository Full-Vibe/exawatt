import { readFile } from 'node:fs/promises';
import path from 'node:path';

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
  const declared = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8').catch(
    () => null
  );
  if (declared === null) {
    return { fresh: false, reason: 'no pnpm-lock.yaml in this checkout' };
  }
  const installed = await readFile(
    path.join(root, 'node_modules', '.pnpm', 'lock.yaml'),
    'utf8'
  ).catch(() => null);
  if (installed === null) {
    return { fresh: false, reason: 'dependencies have never been installed here' };
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
