import { execFile, spawn } from 'node:child_process';
import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { acquireDirectoryLock } from './delivery-lock.mjs';
import { isQueueDrained } from './delivery-queue.mjs';
import {
  appendDeliveryMetric,
  delay,
  deliveryStateRoot,
  readJson,
  writeJsonAtomic,
} from './delivery-state.mjs';

const execFileAsync = promisify(execFile);

export const CI_BATCH_REF = 'refs/heads/ci-batches/master';
export const CI_BATCH_MIN_INTERVAL_MS = 2 * 60 * 60_000;
export const CI_BATCH_QUIET_MS = 60_000;

async function execute(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function git(cwd, ...args) {
  return execute('git', args, cwd);
}

async function ciBatchPaths(root) {
  const stateRoot = await deliveryStateRoot(root);
  return {
    request: path.join(stateRoot, 'ci-batch-request.json'),
    requestLock: path.join(stateRoot, 'ci-batch-request.lock'),
    dispatchState: path.join(stateRoot, 'ci-batch-dispatch.json'),
    workerLock: path.join(stateRoot, 'ci-batch-worker.lock'),
  };
}

export function isGitHubRemoteUrl(url) {
  return (
    /^git@github\.com:[^/]+\/.+/.test(url) ||
    /^https:\/\/github\.com\/[^/]+\/.+/.test(url) ||
    /^ssh:\/\/git@github\.com\/[^/]+\/.+/.test(url)
  );
}

export async function readCiBatchRequest(root) {
  return readJson((await ciBatchPaths(root)).request);
}

export async function readCiBatchDispatchState(root) {
  return readJson((await ciBatchPaths(root)).dispatchState);
}

async function masterWorktree(root) {
  const output = await git(root, 'worktree', 'list', '--porcelain');
  for (const block of output.trim().split(/\n\n+/)) {
    const entry = Object.fromEntries(
      block.split('\n').map(line => {
        const separator = line.indexOf(' ');
        return separator === -1
          ? [line, true]
          : [line.slice(0, separator), line.slice(separator + 1)];
      })
    );
    if (entry.branch === 'refs/heads/master') return entry.worktree;
  }
  return null;
}

export async function startCiBatchWorker(root) {
  const workerRoot = (await masterWorktree(root)) ?? root;
  let workerScript = path.join(workerRoot, 'scripts', 'ci-batch-worker.mjs');
  try {
    await access(workerScript);
  } catch {
    workerScript = path.join(root, 'scripts', 'ci-batch-worker.mjs');
    try {
      await access(workerScript);
    } catch {
      workerScript = ciBatchWorkerScript;
    }
  }

  const worker = spawn(process.execPath, [workerScript], {
    cwd: workerRoot,
    detached: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    const onError = error => reject(error);
    worker.once('error', onError);
    worker.once('spawn', () => {
      worker.off('error', onError);
      resolve();
    });
  });
  worker.unref();
}

export async function requestCiBatch(
  root,
  sourceSha,
  { startWorker = startCiBatchWorker } = {}
) {
  const origin = await git(root, 'remote', 'get-url', 'origin');
  if (!isGitHubRemoteUrl(origin)) {
    return { status: 'unsupported-remote', desiredSha: sourceSha };
  }

  try {
    await git(root, 'merge-base', '--is-ancestor', sourceSha, 'origin/master');
  } catch {
    throw new Error(
      `CI source ${sourceSha} is not an integrated origin/master commit.`
    );
  }

  const paths = await ciBatchPaths(root);
  const lock = await acquireDirectoryLock(paths.requestLock, {
    description: 'CI batch request update',
    timeoutMs: 30_000,
    pollMs: 20,
    log() {},
  });
  let request;
  try {
    const previous = await readJson(paths.request);
    const now = new Date().toISOString();
    request = {
      schemaVersion: 1,
      desiredSha: sourceSha,
      firstRequestedAt: previous?.firstRequestedAt ?? now,
      updatedAt: now,
      sequence: (previous?.sequence ?? 0) + 1,
    };
    await writeJsonAtomic(paths.request, request);
  } finally {
    await lock.release();
  }

  await appendDeliveryMetric(root, 'ci_batch_requested', {
    desiredSha: sourceSha,
    sequence: request.sequence,
  });
  await startWorker(root);
  console.log(`[agent-land] CI batch queued for ${sourceSha.slice(0, 12)}`);
  return { ...request, status: 'queued' };
}

export async function dispatchLatestCiBatch(root) {
  await git(root, 'fetch', 'origin', 'master');
  const sourceSha = await git(root, 'rev-parse', 'origin/master');
  const current = await git(
    root,
    'ls-remote',
    '--heads',
    'origin',
    CI_BATCH_REF
  );
  if (current.split(/\s+/)[0] === sourceSha) {
    return { sha: sourceSha, advanced: false };
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      ['push', 'origin', `${sourceSha}:${CI_BATCH_REF}`],
      { cwd: root, stdio: 'inherit' }
    );
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve()
        : reject(new Error(`CI batch ref push exited ${code}`))
    );
  });
  return { sha: sourceSha, advanced: true };
}

export async function runCiBatchWorker(
  root,
  {
    dispatch = () => dispatchLatestCiBatch(root),
    queueDrained = () => isQueueDrained(root),
    now = () => Date.now(),
    wait = delay,
    pollMs = 1_000,
    quietMs = CI_BATCH_QUIET_MS,
    minIntervalMs = CI_BATCH_MIN_INTERVAL_MS,
  } = {}
) {
  const paths = await ciBatchPaths(root);
  while (true) {
    const request = await readJson(paths.request);
    if (!request) return;

    if (!(await queueDrained())) {
      await wait(pollMs);
      continue;
    }

    const quietRemaining =
      quietMs - (now() - new Date(request.updatedAt).getTime());
    if (quietRemaining > 0) {
      await wait(Math.min(pollMs, quietRemaining));
      continue;
    }

    const dispatchState = await readJson(paths.dispatchState);
    const intervalRemaining = dispatchState?.lastDispatchedAt
      ? minIntervalMs -
        (now() - new Date(dispatchState.lastDispatchedAt).getTime())
      : 0;
    if (intervalRemaining > 0) {
      await wait(Math.min(60_000, intervalRemaining));
      continue;
    }

    await appendDeliveryMetric(root, 'ci_batch_started', {
      desiredSha: request.desiredSha,
      sequence: request.sequence,
      freshnessMs: now() - new Date(request.firstRequestedAt).getTime(),
    });

    let result;
    try {
      result = await dispatch(request.desiredSha);
    } catch (error) {
      const latest = await readJson(paths.request);
      if (latest?.sequence !== request.sequence) {
        await appendDeliveryMetric(root, 'ci_batch_superseded', {
          desiredSha: request.desiredSha,
          supersededBy: latest?.desiredSha,
        });
        continue;
      }
      throw error;
    }

    const dispatchedSha =
      typeof result === 'string' ? result : (result?.sha ?? request.desiredSha);
    const advanced =
      typeof result === 'object' && result !== null
        ? result.advanced !== false
        : true;
    const dispatchedAt = new Date(now()).toISOString();
    if (advanced) {
      await writeJsonAtomic(paths.dispatchState, {
        schemaVersion: 1,
        lastDispatchedAt: dispatchedAt,
        lastDispatchedSha: dispatchedSha,
      });
    }
    await appendDeliveryMetric(root, 'ci_batch_dispatched', {
      desiredSha: request.desiredSha,
      dispatchedSha,
      advanced,
      freshnessMs: now() - new Date(request.firstRequestedAt).getTime(),
    });

    const requestLock = await acquireDirectoryLock(paths.requestLock, {
      description: 'CI batch request completion',
      timeoutMs: 30_000,
      pollMs: 20,
      log() {},
    });
    try {
      const latest = await readJson(paths.request);
      if (
        latest?.sequence === request.sequence ||
        latest?.desiredSha === dispatchedSha
      ) {
        await rm(paths.request, { force: true });
      } else if (latest) {
        await appendDeliveryMetric(root, 'ci_batch_superseded', {
          desiredSha: request.desiredSha,
          dispatchedSha,
          supersededBy: latest.desiredSha,
        });
      }
    } finally {
      await requestLock.release();
    }
  }
}

export async function acquireCiBatchWorker(root) {
  const paths = await ciBatchPaths(root);
  return acquireDirectoryLock(paths.workerLock, {
    description: 'CI batch worker',
    timeoutMs: 5_000,
    pollMs: 25,
    log() {},
  });
}

export const ciBatchWorkerScript = fileURLToPath(
  new URL('../ci-batch-worker.mjs', import.meta.url)
);
