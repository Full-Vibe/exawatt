/**
 * The in-flight worktree roster (ENG-022 H14, visibility half). When an agent
 * session dies before landing, its branch becomes invisible and the fleet has
 * re-implemented that work from scratch (WP3/WP5a/WP6a, ~3,500 lines, found
 * 2026-08-19). The roster makes in-flight and orphaned work visible at the
 * exact moment a new agent starts: every `worktree:setup` prints it first.
 *
 * Read-only and advisory by contract: `printWorktreeRoster` never throws, and
 * a row whose state cannot be read says UNKNOWN with the reason — a failed
 * read must never render as a clean tree.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function git(root, args) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: root,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
}

async function listWorktrees(root) {
  const out = await git(root, ['worktree', 'list', '--porcelain']);
  const worktrees = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null };
      worktrees.push(current);
    } else if (line.startsWith('branch ') && current) {
      current.branch = line.slice('branch '.length).replace('refs/heads/', '');
    }
  }
  return worktrees;
}

async function listAgentBranches(root) {
  const out = await git(root, [
    'for-each-ref',
    'refs/heads/agent',
    '--format=%(refname:short)\t%(committerdate:iso8601)\t%(subject)',
  ]);
  return out
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [branch, committedAt, ...subject] = line.split('\t');
      return { branch, committedAt, subject: subject.join('\t') };
    });
}

async function compareBase(root) {
  try {
    await git(root, ['rev-parse', '--verify', 'origin/master']);
    return 'origin/master';
  } catch {
    return 'master';
  }
}

async function aheadBehind(root, base, branch) {
  const out = await git(root, [
    'rev-list',
    '--left-right',
    '--count',
    `${base}...${branch}`,
  ]);
  const [behind, ahead] = out.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

async function worktreeState(worktreePath) {
  try {
    const out = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: worktreePath,
      maxBuffer: 16 * 1024 * 1024,
    });
    const dirty = out.stdout.split('\n').filter(Boolean).length;
    return dirty === 0 ? 'clean' : `dirty (${dirty} files)`;
  } catch (error) {
    return `UNKNOWN (${error?.code ?? error?.message ?? 'unreadable'})`;
  }
}

function ageInDays(committedAt) {
  const committed = Date.parse(committedAt);
  if (!Number.isFinite(committed)) return null;
  return Math.floor((Date.now() - committed) / 86_400_000);
}

/**
 * Collect one row per agent branch and per non-main worktree:
 *   { branch, worktree, class: 'in-flight'|'orphaned'|'merged',
 *     ahead, behind, ageDays, subject, state }
 * Rows never omit a failed read — they carry UNKNOWN instead.
 */
export async function collectRoster(root) {
  const [worktrees, branches] = await Promise.all([
    listWorktrees(root),
    listAgentBranches(root),
  ]);
  const base = await compareBase(root);
  const mainWorktree = worktrees[0]?.path;
  const byBranch = new Map(
    worktrees
      .filter(w => w.path !== mainWorktree && w.branch)
      .map(w => [w.branch, w.path])
  );

  const rows = [];
  for (const { branch, committedAt, subject } of branches) {
    const worktree = byBranch.get(branch) ?? null;
    let ahead = null;
    let behind = null;
    try {
      ({ ahead, behind } = await aheadBehind(root, base, branch));
    } catch {
      // leave null — rendered as UNKNOWN, never as zero
    }
    rows.push({
      branch,
      worktree,
      class: worktree ? 'in-flight' : ahead === 0 ? 'merged' : 'orphaned',
      ahead,
      behind,
      ageDays: ageInDays(committedAt),
      subject,
      state: worktree ? await worktreeState(worktree) : null,
    });
  }
  const order = { 'in-flight': 0, orphaned: 1, merged: 2 };
  rows.sort(
    (a, b) =>
      order[a.class] - order[b.class] || a.branch.localeCompare(b.branch)
  );
  return rows;
}

export function renderRoster(rows) {
  if (rows.length === 0) return ['no agent branches in flight'];
  const lines = [];
  for (const row of rows) {
    const ahead = row.ahead === null ? 'UNKNOWN' : `+${row.ahead}`;
    const behind = row.behind === null ? 'UNKNOWN' : `-${row.behind}`;
    const age = row.ageDays === null ? 'age UNKNOWN' : `${row.ageDays}d`;
    const where = row.worktree
      ? `${row.worktree} [${row.state}]`
      : row.class === 'orphaned'
        ? 'NO WORKTREE — unlanded work, resume or judge before redoing it'
        : 'no worktree (merged; deletable)';
    lines.push(
      `${row.class.padEnd(9)} ${row.branch} (${ahead}/${behind} vs origin/master, ${age}) — ${row.subject}`
    );
    lines.push(`          ${where}`);
  }
  return lines;
}

/** Print the roster through `say`; never throws (advisory by contract). */
export async function printWorktreeRoster({ root = process.cwd(), say }) {
  try {
    const rows = await collectRoster(root);
    say('in-flight roster:');
    for (const line of renderRoster(rows)) say(`  ${line}`);
    return rows;
  } catch (error) {
    say(`roster unavailable: ${error?.message ?? error}`);
    return null;
  }
}
