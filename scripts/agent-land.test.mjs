import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { parseArgs, parseWorktrees } from './agent-land.mjs';
import { acquireDeliveryLock } from './lib/delivery-lock.mjs';

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL('./agent-land.mjs', import.meta.url));

async function command(commandName, args, cwd) {
  const { stdout } = await execFileAsync(commandName, args, { cwd });
  return stdout.trim();
}

async function git(cwd, ...args) {
  return command('git', args, cwd);
}

function runStreaming(commandName, args, cwd) {
  let output = '';
  const child = spawn(commandName, args, { cwd });
  child.stdout.on('data', chunk => {
    output += chunk;
  });
  child.stderr.on('data', chunk => {
    output += chunk;
  });
  return {
    output: () => output,
    completion: new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', code => {
        if (code === 0) resolve(output);
        else reject(new Error(`command exited ${code}:\n${output}`));
      });
    }),
  };
}

async function waitFor(predicate, timeoutMs = 5_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for child process output.');
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

test('parses repeated verification and delivery options', () => {
  assert.deepEqual(
    parseArgs([
      '--',
      '--verify',
      'type-check',
      '--verify',
      'test:run',
      '--dogfood',
    ]),
    {
      dogfood: true,
      help: false,
      keepBranch: false,
      verify: ['type-check', 'test:run'],
    }
  );
});

test('parses the master checkout from worktree porcelain output', () => {
  assert.deepEqual(
    parseWorktrees(
      'worktree /repo\nHEAD abc\nbranch refs/heads/master\n\nworktree /repo-wt\nHEAD def\nbranch refs/heads/agent/test\n'
    ),
    [
      { worktree: '/repo', HEAD: 'abc', branch: 'refs/heads/master' },
      { worktree: '/repo-wt', HEAD: 'def', branch: 'refs/heads/agent/test' },
    ]
  );
});

test('lands a verified agent branch through a remote fast-forward', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'exawatt-agent-land-'));
  const remote = path.join(directory, 'remote.git');
  const main = path.join(directory, 'main');
  const agent = path.join(directory, 'agent');
  let deliveryLock;

  try {
    await git(directory, 'init', '--bare', '--initial-branch=master', remote);
    await git(directory, 'clone', remote, main);
    await git(main, 'config', 'user.name', 'Agent Test');
    await git(main, 'config', 'user.email', 'agent@example.com');
    await writeFile(
      path.join(main, 'package.json'),
      `${JSON.stringify(
        {
          name: 'agent-land-fixture',
          private: true,
          scripts: { 'verify-ok': 'node -e "process.exit(0)"' },
        },
        null,
        2
      )}\n`
    );
    await git(main, 'add', 'package.json');
    await git(main, 'commit', '-m', 'Initial');
    await git(main, 'push', '-u', 'origin', 'master');
    await git(main, 'worktree', 'add', agent, '-b', 'agent/test');
    await writeFile(path.join(agent, 'change.txt'), 'landed\n');
    await git(agent, 'add', 'change.txt');
    await git(agent, 'commit', '-m', 'Test change');
    const expected = await git(agent, 'rev-parse', 'HEAD');
    const initial = await git(main, 'rev-parse', 'HEAD');

    deliveryLock = await acquireDeliveryLock(main, { log() {} });
    const landing = runStreaming(
      process.execPath,
      [script, '--verify', 'verify-ok'],
      agent
    );
    await waitFor(() =>
      landing
        .output()
        .includes('waiting for the active master delivery transaction')
    );
    assert.equal(
      await git(main, 'rev-parse', 'HEAD'),
      initial,
      'shared master must not move while another delivery owns the lock'
    );
    assert.equal(
      await git(main, 'rev-parse', 'origin/master'),
      initial,
      'remote master must not move while another delivery owns the lock'
    );
    await deliveryLock.release();
    deliveryLock = null;
    const output = await landing.completion;

    assert.match(output, /pushed=true/);
    assert.match(output, /installed=not-requested/);
    assert.equal(await git(main, 'rev-parse', 'HEAD'), expected);
    assert.equal(await git(main, 'rev-parse', 'origin/master'), expected);
    const remoteBranch = await git(
      main,
      'ls-remote',
      '--heads',
      'origin',
      'agent/test'
    );
    assert.equal(remoteBranch, '');
    assert.equal(
      await readFile(path.join(main, 'change.txt'), 'utf8'),
      'landed\n'
    );
  } finally {
    await deliveryLock?.release();
    await rm(directory, { recursive: true, force: true });
  }
});
