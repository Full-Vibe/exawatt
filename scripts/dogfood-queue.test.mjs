import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { runDogfoodWorker } from './lib/dogfood-queue.mjs';
import { deliveryStateRoot, writeJsonAtomic } from './lib/delivery-state.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-dogfood-queue-'));
  await execFileAsync('git', ['init', '--initial-branch=master'], {
    cwd: root,
  });
  const requestPath = path.join(
    await deliveryStateRoot(root),
    'dogfood-request.json'
  );
  return { root, requestPath };
}

async function request(requestPath, sha, firstRequestedAt, sequence = 1) {
  await writeJsonAtomic(requestPath, {
    schemaVersion: 1,
    desiredSha: sha,
    firstRequestedAt,
    updatedAt: firstRequestedAt,
    sequence,
  });
}

test('dogfood waits for queue drain but cannot starve past its ceiling', async () => {
  const { root, requestPath } = await fixture();
  let clock = Date.parse('2026-08-03T12:00:00.000Z');
  const installed = [];
  try {
    await request(requestPath, 'a'.repeat(40), new Date(clock).toISOString());
    await runDogfoodWorker(root, {
      install: async sha => installed.push(sha),
      queueDrained: async () => false,
      now: () => clock,
      wait: async milliseconds => {
        clock += milliseconds;
      },
      pollMs: 60_000,
      maxWaitMs: 10 * 60_000,
    });
    assert.deepEqual(installed, ['a'.repeat(40)]);
    assert.equal(clock, Date.parse('2026-08-03T12:10:00.000Z'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a superseded build never replaces the newer requested snapshot', async () => {
  const { root, requestPath } = await fixture();
  const first = 'a'.repeat(40);
  const latest = 'b'.repeat(40);
  const attempted = [];
  try {
    await request(requestPath, first, '2026-08-03T12:00:00.000Z');
    await runDogfoodWorker(root, {
      install: async sha => {
        attempted.push(sha);
        if (sha === first) {
          await request(requestPath, latest, '2026-08-03T12:00:00.000Z', 2);
          throw new Error('superseded before commit');
        }
      },
      queueDrained: async () => true,
      now: () => Date.parse('2026-08-03T12:01:00.000Z'),
    });
    assert.deepEqual(attempted, [first, latest]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the installer is detached from the master delivery lock and accepts an immutable SHA', async () => {
  const source = await readFile(
    path.join(repositoryRoot, 'scripts/install-dogfood.mjs'),
    'utf8'
  );
  assert.doesNotMatch(source, /acquireDeliveryLock/);
  assert.match(source, /EXAWATT_DOGFOOD_SOURCE_SHA/);
  assert.match(source, /assertStillRequested/);
});
