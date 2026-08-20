import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  collectRoster,
  printWorktreeRoster,
  renderRoster,
} from './lib/worktree-roster.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  await execFileAsync('git', args, { cwd });
}

async function repository(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'exawatt-roster-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'repo');
  await execFileAsync('git', ['init', '--initial-branch=master', root]);
  await git(root, 'config', 'user.email', 'test@example.com');
  await git(root, 'config', 'user.name', 'Roster Test');
  await writeFile(path.join(root, 'seed.txt'), 'seed\n');
  await git(root, 'add', 'seed.txt');
  await git(root, 'commit', '-m', 'seed');
  return { parent, root };
}

test('the roster classifies in-flight, orphaned, and merged branches', async t => {
  const { parent, root } = await repository(t);

  // merged: an agent branch pointing at master's tip
  await git(root, 'branch', 'agent/landed');
  // orphaned: unmerged work with no worktree
  await git(root, 'checkout', '-q', '-b', 'agent/orphan');
  await writeFile(path.join(root, 'orphan.txt'), 'unlanded\n');
  await git(root, 'add', 'orphan.txt');
  await git(root, 'commit', '-m', 'unlanded work');
  await git(root, 'checkout', '-q', 'master');
  // in-flight: a branch checked out in a live worktree, with a dirty file
  const worktree = path.join(parent, 'wt-active');
  await git(root, 'worktree', 'add', '-b', 'agent/active', worktree);
  await writeFile(path.join(worktree, 'wip.txt'), 'uncommitted\n');

  const rows = await collectRoster(root);
  const byBranch = Object.fromEntries(rows.map(row => [row.branch, row]));

  assert.equal(byBranch['agent/active'].class, 'in-flight');
  // git reports realpaths (macOS /var -> /private/var)
  assert.equal(byBranch['agent/active'].worktree, await realpath(worktree));
  assert.match(byBranch['agent/active'].state, /dirty \(1 files\)/);

  assert.equal(byBranch['agent/orphan'].class, 'orphaned');
  assert.equal(byBranch['agent/orphan'].ahead, 1);
  assert.equal(byBranch['agent/orphan'].subject, 'unlanded work');

  assert.equal(byBranch['agent/landed'].class, 'merged');
  assert.equal(byBranch['agent/landed'].ahead, 0);

  // in-flight sorts first: the reader's eye lands on live work
  assert.equal(rows[0].branch, 'agent/active');

  const rendered = renderRoster(rows).join('\n');
  assert.match(rendered, /agent\/orphan/);
  assert.match(
    rendered,
    /NO WORKTREE — unlanded work/,
    'orphaned work must be called out, not merely listed'
  );
});

test('a worktree whose directory vanished reads UNKNOWN, never clean', async t => {
  const { parent, root } = await repository(t);
  const worktree = path.join(parent, 'wt-vanished');
  await git(root, 'worktree', 'add', '-b', 'agent/vanished', worktree);
  await rm(worktree, { recursive: true, force: true });

  const rows = await collectRoster(root);
  const vanished = rows.find(row => row.branch === 'agent/vanished');
  assert.ok(vanished, 'the branch still appears');
  assert.match(
    vanished.state,
    /^UNKNOWN/,
    'a failed read must not report the same value as a clean tree'
  );
});

test('an empty roster says so instead of printing nothing', async t => {
  const { root } = await repository(t);
  const rows = await collectRoster(root);
  assert.deepEqual(rows, []);
  assert.deepEqual(renderRoster(rows), ['no agent branches in flight']);
});

test('printWorktreeRoster never throws, even outside a repository', async t => {
  const outside = await mkdtemp(path.join(tmpdir(), 'exawatt-no-repo-'));
  t.after(() => rm(outside, { recursive: true, force: true }));

  const said = [];
  const result = await printWorktreeRoster({
    root: outside,
    say: message => said.push(message),
  });
  assert.equal(result, null);
  assert.ok(
    said.some(message => message.startsWith('roster unavailable:')),
    'failure is visible, not silent'
  );
});
