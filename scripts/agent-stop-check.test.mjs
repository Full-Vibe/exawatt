import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { inspectDelivery } from './agent-stop-check.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

test('advises once for dirty or unintegrated agent work', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-stop-check-'));

  try {
    await git(root, 'init', '--initial-branch=master');
    await git(root, 'config', 'user.name', 'Agent Test');
    await git(root, 'config', 'user.email', 'agent@example.com');
    await writeFile(path.join(root, 'base.txt'), 'base\n');
    await git(root, 'add', 'base.txt');
    await git(root, 'commit', '-m', 'Initial');
    await git(root, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    await git(root, 'switch', '-c', 'agent/test');

    await writeFile(path.join(root, 'change.txt'), 'dirty\n');
    assert.match(inspectDelivery({ cwd: root }).reason, /uncommitted/);

    await git(root, 'add', 'change.txt');
    await git(root, 'commit', '-m', 'Agent change');
    assert.match(inspectDelivery({ cwd: root }).reason, /not reachable/);

    await git(root, 'update-ref', 'refs/remotes/origin/master', 'HEAD');
    assert.deepEqual(inspectDelivery({ cwd: root }), { continue: true });
    assert.deepEqual(inspectDelivery({ cwd: root, stopHookActive: true }), {
      continue: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
