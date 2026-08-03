import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
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
 * Prefer the linked Vercel Development environment, then fall back to the
 * main checkout's last good snapshot. Pulling directly to the requesting
 * worktree avoids races between concurrent worktree bootstraps.
 */
export function prepareWorktreeEnv({ root, mainCheckout, pullDevelopmentEnv }) {
  const target = path.join(root, '.env.local');
  const linkedProject = path.join(mainCheckout, '.vercel', 'project.json');
  if (existsSync(linkedProject)) {
    try {
      pullDevelopmentEnv({ cwd: mainCheckout, target });
      if (!existsSync(target)) {
        throw new Error('Vercel env pull did not create its target');
      }
      secure(target);
      return { status: 'pulled', target, pullFailed: false };
    } catch {
      return {
        ...syncWorktreeEnvSnapshot({ root, mainCheckout }),
        pullFailed: true,
      };
    }
  }
  return {
    ...syncWorktreeEnvSnapshot({ root, mainCheckout }),
    pullFailed: false,
  };
}
