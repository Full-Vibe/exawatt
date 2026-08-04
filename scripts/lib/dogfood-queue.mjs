import { execFile, spawn } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
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
const TEN_MINUTES_MS = 10 * 60_000;

async function dogfoodPaths(root) {
  const stateRoot = await deliveryStateRoot(root);
  return {
    request: path.join(stateRoot, 'dogfood-request.json'),
    requestLock: path.join(stateRoot, 'dogfood-request.lock'),
    workerLock: path.join(stateRoot, 'dogfood-worker.lock'),
  };
}

export async function readDogfoodRequest(root) {
  return readJson((await dogfoodPaths(root)).request);
}

async function masterWorktree(root) {
  const { stdout } = await execFileAsync(
    'git',
    ['worktree', 'list', '--porcelain'],
    {
      cwd: root,
    }
  );
  for (const block of stdout.trim().split(/\n\n+/)) {
    const lines = Object.fromEntries(
      block.split('\n').map(line => {
        const separator = line.indexOf(' ');
        return separator === -1
          ? [line, true]
          : [line.slice(0, separator), line.slice(separator + 1)];
      })
    );
    if (lines.branch === 'refs/heads/master') return lines.worktree;
  }
  return null;
}

export async function requestDogfoodInstall(root, sourceSha) {
  try {
    await execFileAsync(
      'git',
      ['merge-base', '--is-ancestor', sourceSha, 'origin/master'],
      { cwd: root }
    );
  } catch {
    throw new Error(
      `Dogfood source ${sourceSha} is not an integrated origin/master commit.`
    );
  }
  const paths = await dogfoodPaths(root);
  const lock = await acquireDirectoryLock(paths.requestLock, {
    description: 'dogfood request update',
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
  await appendDeliveryMetric(root, 'dogfood_requested', {
    desiredSha: sourceSha,
    sequence: request.sequence,
  });

  let workerRoot = (await masterWorktree(root)) ?? root;
  let workerScript = path.join(workerRoot, 'scripts', 'dogfood-worker.mjs');
  try {
    await access(workerScript);
  } catch {
    workerRoot = root;
    workerScript = path.join(root, 'scripts', 'dogfood-worker.mjs');
  }
  const worker = spawn(process.execPath, [workerScript], {
    cwd: workerRoot,
    detached: true,
    stdio: 'ignore',
  });
  worker.unref();
  console.log(`[agent-land] dogfood queued for ${sourceSha.slice(0, 12)}`);
  return request;
}

export async function runDogfoodWorker(
  root,
  {
    install = async (sourceSha, requestPath) => {
      await new Promise((resolve, reject) => {
        const child = spawn('pnpm', ['run', 'electron:install-dogfood'], {
          cwd: root,
          stdio: 'inherit',
          env: {
            ...process.env,
            EXAWATT_DOGFOOD_SOURCE_SHA: sourceSha,
            EXAWATT_DOGFOOD_REQUEST_STATE: requestPath,
          },
        });
        child.once('error', reject);
        child.once('exit', code =>
          code === 0
            ? resolve()
            : reject(new Error(`dogfood installer exited ${code}`))
        );
      });
    },
    queueDrained = () => isQueueDrained(root),
    now = () => Date.now(),
    wait = delay,
    pollMs = 1_000,
    maxWaitMs = TEN_MINUTES_MS,
  } = {}
) {
  const paths = await dogfoodPaths(root);
  while (true) {
    const request = await readJson(paths.request);
    if (!request) return;
    const ageMs = now() - new Date(request.firstRequestedAt).getTime();
    if (!(await queueDrained()) && ageMs < maxWaitMs) {
      await wait(Math.min(pollMs, maxWaitMs - ageMs));
      continue;
    }

    await appendDeliveryMetric(root, 'dogfood_started', {
      desiredSha: request.desiredSha,
      freshnessMs: ageMs,
    });
    try {
      await install(request.desiredSha, paths.request);
    } catch (error) {
      const latest = await readJson(paths.request);
      if (latest?.desiredSha !== request.desiredSha) {
        await appendDeliveryMetric(root, 'dogfood_superseded', {
          desiredSha: request.desiredSha,
          supersededBy: latest?.desiredSha,
        });
        continue;
      }
      throw error;
    }

    const requestLock = await acquireDirectoryLock(paths.requestLock, {
      description: 'dogfood request completion',
      timeoutMs: 30_000,
      pollMs: 20,
      log() {},
    });
    try {
      const latest = await readJson(paths.request);
      if (latest?.desiredSha === request.desiredSha) {
        await rm(paths.request, { force: true });
        await appendDeliveryMetric(root, 'dogfood_installed', {
          desiredSha: request.desiredSha,
          freshnessMs: now() - new Date(request.firstRequestedAt).getTime(),
        });
        return;
      }
    } finally {
      await requestLock.release();
    }
  }
}

export async function acquireDogfoodWorker(root) {
  const paths = await dogfoodPaths(root);
  return acquireDirectoryLock(paths.workerLock, {
    description: 'dogfood worker',
    timeoutMs: 25,
    pollMs: 10,
    log() {},
  });
}

export async function ensureDogfoodStateDirectory(root) {
  await mkdir(await deliveryStateRoot(root), { recursive: true });
}

export const dogfoodWorkerScript = fileURLToPath(
  new URL('../dogfood-worker.mjs', import.meta.url)
);
