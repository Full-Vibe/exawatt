import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';

function secure(pathname) {
  chmodSync(pathname, 0o600);
}

function snapshotsMatch(left, right) {
  return (
    existsSync(left) &&
    existsSync(right) &&
    readFileSync(left).equals(readFileSync(right))
  );
}

export function syncWorktreeEnvSnapshot({ root, mainCheckout }) {
  const target = path.join(root, '.env.local');
  const source = path.join(mainCheckout, '.env.local');
  if (path.resolve(root) === path.resolve(mainCheckout)) {
    if (!existsSync(target)) return { status: 'missing-source', target };
    secure(target);
    return { status: 'main-current', target };
  }
  if (!existsSync(source)) return { status: 'missing-source', target };
  if (snapshotsMatch(source, target)) {
    secure(target);
    return { status: 'current', target };
  }
  const status = existsSync(target) ? 'refreshed' : 'copied';
  copyFileSync(source, target);
  secure(target);
  return { status, target };
}

/**
 * Locate a command without executing it. pnpm adds node_modules/.bin to PATH,
 * so this covers both project-local and global Vercel CLI installations.
 */
export function findExecutableOnPath(
  command,
  { pathValue = process.env.PATH ?? '', access = accessSync } = {}
) {
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking. An absent optional CLI must not fail community setup.
    }
  }
  return null;
}

/**
 * Prefer a linked Vercel Development environment. A linked checkout may use
 * its own last-good .env.local when the CLI, access, or network is unavailable.
 * An unlinked checkout never copies the main checkout's snapshot: this is the
 * fail-closed boundary that keeps a public/community clone from inheriting a
 * stale private environment.
 */
export function prepareWorktreeEnv({ root, mainCheckout, pullDevelopmentEnv }) {
  const target = path.join(root, '.env.local');
  const rootLink = path.join(root, '.vercel', 'project.json');
  const mainLink = path.join(mainCheckout, '.vercel', 'project.json');
  const linkedCheckout = existsSync(rootLink)
    ? root
    : existsSync(mainLink)
      ? mainCheckout
      : null;

  if (!linkedCheckout) {
    return {
      status: 'skipped-unconfigured',
      target,
      pullStatus: 'not-configured',
    };
  }

  if (typeof pullDevelopmentEnv === 'function') {
    const pullTarget = `${target}.vercel-pull-${process.pid}`;
    try {
      rmSync(pullTarget, { force: true });
      pullDevelopmentEnv({ cwd: linkedCheckout, target: pullTarget });
      if (!existsSync(pullTarget)) {
        throw new Error('Vercel env pull did not create its target');
      }
      secure(pullTarget);
      renameSync(pullTarget, target);
      return { status: 'pulled', target, pullStatus: 'pulled' };
    } catch {
      rmSync(pullTarget, { force: true });
      return {
        ...syncWorktreeEnvSnapshot({ root, mainCheckout: linkedCheckout }),
        pullStatus: 'failed',
        snapshotSource: linkedCheckout,
      };
    }
  }

  return {
    ...syncWorktreeEnvSnapshot({ root, mainCheckout: linkedCheckout }),
    pullStatus: 'cli-unavailable',
    snapshotSource: linkedCheckout,
  };
}
