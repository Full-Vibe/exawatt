import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  CI_BATCH_MIN_INTERVAL_MS,
  CI_BATCH_REF,
  dispatchLatestCiBatch,
  isGitHubRemoteUrl,
  readCiBatchDispatchState,
  readCiBatchRequest,
  requestCiBatch,
  runCiBatchWorker,
} from './lib/ci-batch.mjs';
import { deliveryStateRoot, writeJsonAtomic } from './lib/delivery-state.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-ci-batch-'));
  await git(root, 'init', '--initial-branch=master');
  await git(root, 'config', 'user.name', 'CI Batch Test');
  await git(root, 'config', 'user.email', 'ci-batch@example.com');
  return {
    root,
    requestPath: path.join(
      await deliveryStateRoot(root),
      'ci-batch-request.json'
    ),
    dispatchPath: path.join(
      await deliveryStateRoot(root),
      'ci-batch-dispatch.json'
    ),
  };
}

async function request(requestPath, sha, timestamp, sequence = 1) {
  await writeJsonAtomic(requestPath, {
    schemaVersion: 1,
    desiredSha: sha,
    firstRequestedAt: timestamp,
    updatedAt: timestamp,
    sequence,
  });
}

test('recognises the GitHub origins that can consume the CI batch ref', () => {
  for (const url of [
    'git@github.com:Full-Vibe/exawatt.git',
    'https://github.com/Full-Vibe/exawatt.git',
    'ssh://git@github.com/Full-Vibe/exawatt.git',
  ]) {
    assert.equal(isGitHubRemoteUrl(url), true, url);
  }
  assert.equal(isGitHubRemoteUrl('/tmp/exawatt.git'), false);
  assert.equal(
    isGitHubRemoteUrl('git@gitlab.com:Full-Vibe/exawatt.git'),
    false
  );
});

test('requests supersede in one durable record and start one worker per update', async () => {
  const { root } = await fixture();
  let starts = 0;
  try {
    await git(root, 'commit', '--allow-empty', '-m', 'Initial');
    const first = await git(root, 'rev-parse', 'HEAD');
    await git(
      root,
      'remote',
      'add',
      'origin',
      'git@github.com:Full-Vibe/exawatt.git'
    );
    await git(root, 'update-ref', 'refs/remotes/origin/master', first);

    await requestCiBatch(root, first, {
      startWorker: async () => {
        starts += 1;
      },
    });
    await requestCiBatch(root, first, {
      startWorker: async () => {
        starts += 1;
      },
    });

    const pending = await readCiBatchRequest(root);
    assert.equal(pending.desiredSha, first);
    assert.equal(pending.sequence, 2);
    assert.equal(starts, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dispatch waits for queue drain, a quiet minute, and the two-hour budget interval', async () => {
  const { root, requestPath, dispatchPath } = await fixture();
  const sha = 'a'.repeat(40);
  let clock = Date.parse('2026-08-16T12:00:00.000Z');
  const dispatched = [];
  try {
    await request(requestPath, sha, new Date(clock).toISOString());
    await writeJsonAtomic(dispatchPath, {
      schemaVersion: 1,
      lastDispatchedAt: '2026-08-16T11:00:00.000Z',
      lastDispatchedSha: 'b'.repeat(40),
    });
    let queueChecks = 0;
    await runCiBatchWorker(root, {
      dispatch: async desiredSha => {
        dispatched.push({ desiredSha, at: clock });
        return { sha: desiredSha, advanced: true };
      },
      queueDrained: async () => {
        queueChecks += 1;
        return queueChecks > 1;
      },
      now: () => clock,
      wait: async milliseconds => {
        clock += milliseconds;
      },
      pollMs: 1_000,
    });

    assert.deepEqual(dispatched, [
      {
        desiredSha: sha,
        at: Date.parse('2026-08-16T13:00:00.000Z'),
      },
    ]);
    assert.equal(await readCiBatchRequest(root), null);
    assert.deepEqual(await readCiBatchDispatchState(root), {
      schemaVersion: 1,
      lastDispatchedAt: '2026-08-16T13:00:00.000Z',
      lastDispatchedSha: sha,
    });
    assert.equal(CI_BATCH_MIN_INTERVAL_MS, 2 * 60 * 60_000);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a newer landing supersedes a pending request before any hosted run starts', async () => {
  const { root, requestPath } = await fixture();
  const first = 'a'.repeat(40);
  const latest = 'b'.repeat(40);
  let clock = Date.parse('2026-08-16T12:00:00.000Z');
  const dispatched = [];
  try {
    await request(requestPath, first, new Date(clock).toISOString());
    let queueChecks = 0;
    await runCiBatchWorker(root, {
      dispatch: async desiredSha => {
        dispatched.push(desiredSha);
        return { sha: desiredSha, advanced: true };
      },
      queueDrained: async () => {
        queueChecks += 1;
        return queueChecks > 1;
      },
      now: () => clock,
      wait: async milliseconds => {
        clock += milliseconds;
        if (queueChecks === 1) {
          await request(requestPath, latest, new Date(clock).toISOString(), 2);
        }
      },
      pollMs: 1_000,
      quietMs: 0,
      minIntervalMs: 0,
    });
    assert.deepEqual(dispatched, [latest]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dispatch advances only the dedicated CI ref to current origin/master', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'exawatt-ci-ref-'));
  const remote = path.join(directory, 'remote.git');
  const root = path.join(directory, 'repo');
  try {
    await git(directory, 'init', '--bare', '--initial-branch=master', remote);
    await git(directory, 'clone', remote, root);
    await git(root, 'config', 'user.name', 'CI Batch Test');
    await git(root, 'config', 'user.email', 'ci-batch@example.com');
    await git(root, 'commit', '--allow-empty', '-m', 'Initial');
    await git(root, 'push', '-u', 'origin', 'master');
    const expected = await git(root, 'rev-parse', 'HEAD');

    assert.deepEqual(await dispatchLatestCiBatch(root), {
      sha: expected,
      advanced: true,
    });
    assert.equal(
      (await git(root, 'ls-remote', '--heads', 'origin', CI_BATCH_REF)).split(
        /\s+/
      )[0],
      expected
    );
    assert.deepEqual(await dispatchLatestCiBatch(root), {
      sha: expected,
      advanced: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
