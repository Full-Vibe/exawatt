import assert from 'node:assert/strict';
import test from 'node:test';

import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import {
  createQueueFixture,
  finished,
  waitForOutput,
} from './lib/delivery-queue-fixture.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { acquireMachineSlot } from './lib/machine-slots.mjs';

/**
 * BUG-204: in September the queue head waited for a machine slot in 9 of 36
 * rebases, 30 minutes in total, behind candidates' first checks, while every
 * ticket behind it waited on the head. One slot is now reserved for the head.
 */

test('the head re-checks its rebased tree while candidates hold every pool slot', async () => {
  const fixture = createQueueFixture('exawatt-head-slot-');
  const running = [];
  let lock;
  let candidateSlot;
  try {
    const env = {
      EXAWATT_MACHINE_SLOTS: '1',
      EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
    };
    const land = worktree => {
      const landing = fixture.land(worktree, [], env);
      running.push(landing);
      return landing;
    };
    lock = await acquireDeliveryLock(fixture.main, { log() {} });
    const head = land(
      fixture.agentWorktree('agent/head', {
        'src/head.ts': 'export const h = 1;\n',
      })
    );
    await waitForOutput(head, output =>
      /waiting for the active master delivery transaction/u.test(output)
    );
    // Master moves, so the head must rebase and re-check; and a candidate's
    // first check takes the machine's only pool slot.
    fixture.advanceMaster({ 'src/other.ts': 'export const o = 1;\n' });
    candidateSlot = await acquireMachineSlot({
      root: fixture.main,
      slotCount: 1,
      env: {},
      log() {},
      label: 'a candidate first check',
      deadlineMs: 0,
    });
    assert.equal(candidateSlot.mode, 'acquired');
    const candidate = land(
      fixture.agentWorktree('agent/candidate', {
        'src/candidate.ts': 'export const c = 1;\n',
      })
    );
    await waitForOutput(candidate, output =>
      /agent-land floor \(candidate\) is waiting/u.test(output)
    );

    await lock.release();
    lock = null;
    await waitForOutput(
      head,
      output =>
        /STATUS implemented=/u.test(output) ||
        /agent-land floor \(rebase\) is waiting/u.test(output)
    );
    assert.doesNotMatch(head.output(), /floor \(rebase\) is waiting/u);
    const landed = await finished(head);
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.doesNotMatch(
      candidate.output(),
      /admitted ticket/u,
      'the candidate is still waiting for a pool slot'
    );
    const rebaseChecks = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'floor_check' && event.phase === 'rebase'
    );
    assert.ok(rebaseChecks.length > 0);
    for (const check of rebaseChecks) assert.equal(check.slotMode, 'acquired');

    await candidateSlot.release();
    candidateSlot = null;
    const later = await finished(candidate);
    assert.equal(later.code, 0, later.output);
  } finally {
    await lock?.release();
    await candidateSlot?.release();
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});
