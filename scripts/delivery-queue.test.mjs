import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  allocateTicket,
  claimDeadTicket,
  finishTicket,
  listTickets,
  mutateTicket,
  queueHead,
} from './lib/delivery-queue.mjs';
import { summarizeDeliveryMetrics } from './lib/delivery-state.mjs';

const execFileAsync = promisify(execFile);

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-fifo-'));
  await execFileAsync('git', ['init', '--initial-branch=master'], {
    cwd: root,
  });
  return root;
}

function candidate(index) {
  const sha = String(index).padStart(40, '0');
  return {
    branch: `agent/test-${index}`,
    baseSha: 'a'.repeat(40),
    candidateSha: sha,
    attemptSha: sha,
    attemptRef: `refs/heads/agent-attempts/test-${index}`,
  };
}

test('concurrent admissions receive a strict monotonic FIFO order', async () => {
  const root = await repository();
  try {
    const tickets = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        allocateTicket(root, candidate(index + 1))
      )
    );
    assert.deepEqual(
      tickets.map(ticket => ticket.number).sort((a, b) => a - b),
      Array.from({ length: 32 }, (_, index) => index + 1)
    );
    assert.equal((await queueHead(root)).number, 1);
    assert.deepEqual(
      (await listTickets(root)).map(ticket => ticket.number),
      Array.from({ length: 32 }, (_, index) => index + 1)
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a live owner is never taken over even with an old heartbeat', async () => {
  const root = await repository();
  try {
    const ticket = await allocateTicket(root, candidate(1));
    await assert.rejects(() => claimDeadTicket(root, ticket), /live process/);
    assert.equal((await queueHead(root)).owner.epoch, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a dead owner is fenced by a new ownership epoch and reaches one terminal result', async () => {
  const root = await repository();
  try {
    const original = await allocateTicket(root, candidate(1), {
      ownerPid: 999_999_999,
    });
    const recovered = await claimDeadTicket(root, original);
    assert.equal(recovered.owner.epoch, 2);
    assert.notEqual(recovered.owner.token, original.owner.token);
    await assert.rejects(
      () =>
        mutateTicket(
          root,
          original.id,
          { ownerToken: original.owner.token, ownerEpoch: 1 },
          current => current
        ),
      /ownership token changed/
    );
    const terminal = await finishTicket(root, recovered, 'failed', {
      preservedAttemptRef: recovered.attemptRef,
    });
    assert.equal(terminal.status, 'failed');
    await assert.rejects(
      () => finishTicket(root, recovered, 'integrated'),
      /already terminal/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the H7 metrics schema reports queue, lock, floor, Actions, and dogfood evidence', () => {
  const summary = summarizeDeliveryMetrics([
    { type: 'queue_terminal', status: 'integrated', queueWaitMs: 100 },
    { type: 'queue_terminal', status: 'integrated', queueWaitMs: 500 },
    { type: 'queue_terminal', status: 'failed', queueWaitMs: 300 },
    { type: 'integration_lock', durationMs: 40 },
    { type: 'integration_lock', durationMs: 80 },
    { type: 'stale_stop' },
    { type: 'floor_check', status: 'failed' },
    // BUG-090: a check that failed and then passed with the machine to itself.
    // It is neither a landing failure nor invisible.
    {
      type: 'floor_check',
      status: 'flaked',
      flakedFiles: [
        { file: 'src/a.test.tsx', tests: ['a > times out'] },
        { file: 'src/b.test.tsx', tests: ['b > times out'] },
      ],
    },
    {
      type: 'floor_check',
      status: 'flaked',
      flakedFiles: [{ file: 'src/b.test.tsx', tests: ['b > times out'] }],
    },
    { type: 'actions_run', minutes: 6 },
    { type: 'dogfood_installed', freshnessMs: 900 },
  ]);
  assert.deepEqual(summary, {
    schemaVersion: 1,
    landings: 2,
    failedTickets: 1,
    queueWaitP50Ms: 300,
    queueWaitP95Ms: 500,
    lockHoldP95Ms: 80,
    staleStopCount: 1,
    floorFailures: 1,
    // A file that flakes repeatedly is the shape of a real regression hiding
    // behind flakiness; contention moves around instead.
    flakedChecks: 2,
    flakedFiles: [
      { file: 'src/b.test.tsx', count: 2 },
      { file: 'src/a.test.tsx', count: 1 },
    ],
    actionsMinutes: 6,
    dogfoodFreshnessP95Ms: 900,
  });
});
