import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { isDocsPath } from './docs-check.mjs';

/**
 * The docs lane of `agent:land` (BUG-200).
 *
 * In September 20 of 132 `master` commits skipped the queue, nearly all of
 * them documentation pushed straight from the shared checkout so an operator
 * answer did not wait behind a landing. They caused 13 of the 38 ticket deaths
 * and every repeat rebase at the queue head: one ticket held the head through
 * three direct pushes in 25 minutes. A direct push is cheap for its author and
 * expensive for whoever holds the head.
 *
 * So a docs change takes a queue ticket like any other, from the checkout it
 * was written in, with no agent worktree and no `worktree:setup`. It runs the
 * docs checks (`classifyDocsChecks`, seconds, not the full floor) on the exact
 * committed tree, and every git mutation happens in a temporary detached
 * checkout of that commit. The invoking checkout, often the shared `master`
 * that other sessions write in, is never rebased or required to be clean; it
 * is only moved forward afterwards, and only with `git reset --keep`, which
 * refuses rather than overwrite anyone's uncommitted edit.
 */

const execFileAsync = promisify(execFile);

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Why these changed paths cannot take the docs lane, or null when they can.
 * Anything that is not documentation owes the full floor.
 */
export function docsLaneRefusal(paths) {
  if (paths.length === 0) {
    return '--docs has nothing to land: HEAD has no changes beyond origin/master.';
  }
  const others = paths.filter(file => !isDocsPath(file));
  if (others.length === 0) return null;
  return [
    '--docs lands documentation only (*.md and docs/**). This change also touches:',
    ...others.map(file => `  ${file}`),
    'Land it from an agent/* worktree with `pnpm agent:land`, which runs the full floor.',
  ].join('\n');
}

/** The dependency directories a checkout's docs checks resolve through. */
async function dependencyDirectories(root) {
  const directories = ['.'];
  try {
    for (const entry of await readdir(path.join(root, 'packages'), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory())
        directories.push(path.join('packages', entry.name));
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return directories;
}

/**
 * A temporary detached checkout of `sha`, borrowing the invoking checkout's
 * installed dependencies through `node_modules` links (ignored by the
 * repository's `.gitignore`). `close()` unlinks them before removing the
 * checkout, so removal can never reach the dependencies they point at.
 */
export async function openDocsCheckout(invokingRoot, sha) {
  const root = path.join(
    tmpdir(),
    `exawatt-docs-lane-${randomUUID().slice(0, 8)}`
  );
  await git(invokingRoot, [
    'worktree',
    'add',
    '--quiet',
    '--detach',
    root,
    sha,
  ]);
  const links = [];
  try {
    for (const directory of await dependencyDirectories(invokingRoot)) {
      const source = path.join(invokingRoot, directory, 'node_modules');
      const target = path.join(root, directory, 'node_modules');
      if (!existsSync(source) || !existsSync(path.dirname(target))) continue;
      await symlink(source, target, 'dir');
      links.push(target);
    }
  } catch (error) {
    await closeDocsCheckout(invokingRoot, root, links);
    throw error;
  }
  return {
    root,
    close: () => closeDocsCheckout(invokingRoot, root, links),
  };
}

async function closeDocsCheckout(invokingRoot, root, links) {
  for (const link of links) await unlink(link).catch(() => {});
  try {
    await git(invokingRoot, ['worktree', 'remove', '--force', root]);
  } catch {
    await rm(root, { recursive: true, force: true });
    await git(invokingRoot, ['worktree', 'prune']).catch(() => {});
  }
}

/**
 * Moves the invoking checkout onto what was integrated, when it still points
 * at the commit that was landed. A rebased landing has a new SHA, and leaving
 * the old commits under the operator's branch would offer them to the next
 * landing a second time. `reset --keep` keeps every uncommitted edit and
 * aborts instead of overwriting one, so a shared checkout is never damaged.
 *
 * Returns what happened, for the status report.
 */
export async function syncInvokingCheckout(
  invokingRoot,
  { candidateSha, integratedSha }
) {
  const head = await git(invokingRoot, ['rev-parse', 'HEAD']);
  if (head === integratedSha) return { state: 'current' };
  if (head !== candidateSha) return { state: 'moved-on', head };
  try {
    await git(invokingRoot, ['reset', '--quiet', '--keep', integratedSha]);
    return { state: 'reset' };
  } catch (error) {
    return {
      state: 'kept',
      reason: String(error?.stderr ?? error?.message ?? error).trim(),
    };
  }
}
