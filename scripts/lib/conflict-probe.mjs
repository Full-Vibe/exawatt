import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * The waiting ticket's conflict probe (BUG-202).
 *
 * In September a ticket whose rebase would conflict waited 2.3 hours on
 * average in the queue and then died within a second of reaching the head:
 * 20 of the 38 deaths were rebase conflicts. The verdict was knowable the
 * moment the conflicting commit reached `origin/master`; the queue only asked
 * when it was the ticket's turn.
 *
 * So a waiting ticket asks every time `origin/master` moves. It replays its
 * admitted commits onto the new master in memory, one at a time, the way the
 * head's `git rebase` will: `git merge-tree --write-tree` against each
 * commit's own parent as the merge base, chaining the resulting trees. Nothing
 * in the worktree, the index or any ref changes. A conflict is the same
 * verdict the head would reach, only hours earlier.
 */

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * Runs one `git merge-tree` and reads its verdict. Exit 0 is clean and exit 1
 * is a conflict; anything else is an error of the probe, never a verdict.
 */
async function mergeTree(root, gitArgs, { mergeBase, ours, theirs }) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      [
        ...gitArgs,
        'merge-tree',
        '--write-tree',
        '--name-only',
        '--no-messages',
        `--merge-base=${mergeBase}`,
        ours,
        theirs,
      ],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 }
    );
    return { clean: true, tree: stdout.trim().split('\n')[0] };
  } catch (error) {
    if (error?.code !== 1) throw error;
    const [tree, ...paths] = String(error.stdout ?? '')
      .trim()
      .split('\n')
      .filter(Boolean);
    return { clean: false, tree, paths: [...new Set(paths)].sort() };
  }
}

/**
 * Replays `sha`'s commits since its merge base with `onto` onto `onto`.
 * Returns `{ clean: true }`, or `{ clean: false, commit, paths }` naming the
 * first commit that conflicts and the paths it conflicts in. Merge commits are
 * skipped, as `git rebase` linearizes them.
 *
 * `gitArgs` are global options for every merge (configuration the head's
 * rebase is given too, such as a merge driver).
 */
export async function probeRebase(root, { sha, onto, gitArgs = [] }) {
  const base = await git(root, ['merge-base', onto, sha]);
  const commits = (
    await git(root, ['rev-list', '--reverse', '--no-merges', `${base}..${sha}`])
  )
    .split('\n')
    .filter(Boolean);
  let tree = await git(root, ['rev-parse', `${onto}^{tree}`]);
  for (const commit of commits) {
    const merged = await mergeTree(root, gitArgs, {
      mergeBase: `${commit}^`,
      ours: tree,
      theirs: commit,
    });
    if (!merged.clean) return { clean: false, commit, paths: merged.paths };
    tree = merged.tree;
  }
  return { clean: true };
}

/**
 * Reads where origin's `master` is now without touching any shared ref: the
 * fetch writes only this checkout's own FETCH_HEAD (`--refmap=` stops the
 * opportunistic `origin/master` update), so a waiter never contends with the
 * head, or with another waiter, for the lock on a remote-tracking ref.
 */
export async function peekOriginMaster(root) {
  await git(root, [
    'fetch',
    '--quiet',
    '--no-tags',
    '--refmap=',
    'origin',
    'refs/heads/master',
  ]);
  return git(root, ['rev-parse', 'FETCH_HEAD']);
}

/**
 * What the author reads when the probe refuses the change: before its floor
 * (no ticket yet) or while its ticket waited.
 */
export function probeConflictMessage({ ticketNumber, onto, commit, paths }) {
  const subject =
    ticketNumber === undefined ? 'this change' : `ticket ${ticketNumber}`;
  return [
    `${subject} would conflict when rebased onto origin/master ${onto.slice(0, 12)}, in:`,
    ...paths.map(file => `  ${file}`),
    `(first conflicting commit: ${commit.slice(0, 12)})`,
    ticketNumber === undefined
      ? 'The head would refuse it after the whole floor, so nothing ran and no ticket was taken.'
      : 'The head would reach the same verdict when this ticket got there, so it leaves the queue now and stops holding a place; its attempt ref is preserved.',
    'Rebase onto origin/master, resolve, re-verify, and land again.',
  ].join('\n');
}
