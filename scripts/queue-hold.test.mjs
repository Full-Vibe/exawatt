import assert from 'node:assert/strict';
import {
  chmodSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  finished,
  startLanding,
  waitForOutput,
} from './lib/delivery-queue-fixture.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { git } from './lib/hermetic-git.mjs';
import { enablePublicMaintenanceHold } from './lib/public-maintenance-hold.mjs';
import {
  WORKFLOW_PATH,
  createPrivateFixture,
  fixtureWorkflow,
  writeFastPnpm,
} from './lib/public-repository-fixture.mjs';
import {
  describePublicLatch,
  holdWhilePublicLatched,
  publicLatchHoldPolicy,
} from './lib/queue-hold.mjs';

/**
 * BUG-201: when public publication is latched, the queue holds instead of
 * failing tickets. 11 of September's 38 ticket deaths were the latch, 10 of
 * them on one night and 6 of those after a full re-check, and none was
 * anything the ticket's owner could fix.
 */

function clock() {
  let at = 0;
  const slept = [];
  return {
    now: () => at,
    slept,
    sleep: async milliseconds => {
      slept.push(milliseconds);
      at += milliseconds;
    },
  };
}

const POLICY = {
  holdMs: 60_000,
  retryMs: 1_000,
  maxRetryMs: 8_000,
  signalPollMs: 500,
  backstopMs: 30_000,
  statusEveryMs: 20_000,
};

const transient = describePublicLatch(
  Object.assign(
    new Error('[public-delivery] pending catch-up did not publish'),
    {
      publicLatch: { failure: 'transient', reason: 'public remote is down' },
    }
  )
);
const deterministic = describePublicLatch(
  Object.assign(new Error('[public-delivery] refused deterministically'), {
    publicLatch: {
      failure: 'deterministic',
      privateSha: 'a'.repeat(40),
      path: 'docs/x.md',
      check: 'render/seam',
      recovery: { preview: 'pnpm open-source:catchup -- --source s' },
    },
  })
);

test('the latch record decides the failure class; operator state is deterministic', () => {
  assert.equal(transient.failure, 'transient');
  assert.equal(deterministic.failure, 'deterministic');
  assert.match(
    deterministic.summary,
    /private aaaaaaaaaaaa cannot render docs\/x\.md \(check render\/seam\); recovery: pnpm open-source:catchup/u
  );
  assert.equal(
    describePublicLatch(
      new Error('[public-maintenance] held public tip moved from a to b')
    ).failure,
    'deterministic'
  );
  assert.equal(
    describePublicLatch(new Error('ls-remote: timeout')).failure,
    'transient'
  );
  assert.equal(
    publicLatchHoldPolicy({ EXAWATT_PUBLIC_LATCH_HOLD_MINUTES: '0' }).holdMs,
    0
  );
  assert.equal(publicLatchHoldPolicy({}).holdMs, 120 * 60_000);
});

test('a clear publication never holds', async () => {
  const time = clock();
  const result = await holdWhilePublicLatched({
    check: async () => null,
    signature: async () => assert.fail('no signature is read'),
    policy: POLICY,
    ...time,
  });
  assert.deepEqual(result, { outcome: 'clear', heldMs: 0 });
  assert.deepEqual(time.slept, []);
});

test('a transient latch is retried on a doubling backoff until it clears', async () => {
  const time = clock();
  const answers = [transient, transient, transient, transient, null];
  const events = [];
  const result = await holdWhilePublicLatched({
    check: async () => answers.shift(),
    signature: async () => 'same',
    policy: POLICY,
    report: async event => events.push(event),
    ...time,
  });
  assert.equal(result.outcome, 'released');
  assert.deepEqual(time.slept, [1_000, 2_000, 4_000, 8_000]);
  assert.deepEqual(events, ['held']);
});

test('a deterministic latch re-checks only when recovery moves a signal', async () => {
  const time = clock();
  let checks = 0;
  let signature = 'before';
  const result = await holdWhilePublicLatched({
    check: async () => {
      checks += 1;
      return checks === 1 ? deterministic : null;
    },
    signature: async () => {
      // The operator enables a maintenance hold ten seconds in.
      if (time.now() >= 10_000) signature = 'hold enabled';
      return signature;
    },
    policy: POLICY,
    ...time,
  });
  assert.equal(result.outcome, 'released');
  assert.equal(checks, 2, 'the projector is not re-run while nothing moved');
  assert.equal(result.heldMs, 10_000);
});

test('a deterministic latch is still re-checked on the backstop', async () => {
  const time = clock();
  let checks = 0;
  const result = await holdWhilePublicLatched({
    check: async () => (++checks === 1 ? deterministic : null),
    signature: async () => 'unchanged',
    policy: POLICY,
    ...time,
  });
  assert.equal(result.outcome, 'released');
  assert.equal(result.heldMs, POLICY.backstopMs);
});

test('the hold is bounded and reports while it waits', async () => {
  const time = clock();
  const events = [];
  const result = await holdWhilePublicLatched({
    check: async () => deterministic,
    signature: async () => String(time.now()),
    policy: POLICY,
    report: async event => events.push(event),
    ...time,
  });
  assert.equal(result.outcome, 'expired');
  assert.equal(result.heldMs, POLICY.holdMs);
  assert.equal(events[0], 'held');
  assert.ok(events.filter(event => event === 'status').length >= 2);

  const immediate = clock();
  const zero = await holdWhilePublicLatched({
    check: async () => transient,
    signature: async () => 'x',
    policy: { ...POLICY, holdMs: 0 },
    ...immediate,
  });
  assert.equal(zero.outcome, 'expired');
  assert.deepEqual(immediate.slept, []);
});

async function succeeded(landing) {
  const { code, output } = await finished(landing);
  assert.equal(code, 0, output);
  return output;
}

function rejectPushes(remote) {
  const hook = path.join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "public remote is down" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
}

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
    .sort((left, right) => left.number - right.number);
}

test('a transient latch holds the head without failing it, the waiter keeps its place, and both land when publication recovers', async () => {
  const fixture = createPrivateFixture('exawatt-hold-transient-');
  const running = [];
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const env = {
      ...writeFastPnpm(fixture.parent),
      EXAWATT_PUBLIC_LATCH_RETRY_SECONDS: '0.2',
    };
    const land = worktree => {
      const landing = startLanding(worktree, [], env);
      running.push(landing);
      return landing;
    };
    const first = fixture.agentWorktree('agent/hold-first', {
      'src/b.ts': 'export const b = 2;\n',
    });
    assert.match(await succeeded(land(first)), /public=published/u);
    rejectPushes(remote);
    const second = fixture.agentWorktree('agent/hold-second', {
      'src/c.ts': 'export const c = 3;\n',
    });
    assert.match(await succeeded(land(second)), /public=pending/u);
    const latchedMaster = git(fixture.origin, ['rev-parse', 'master']);

    const head = land(
      fixture.agentWorktree('agent/hold-head', {
        'src/d.ts': 'export const d = 4;\n',
      })
    );
    await waitForOutput(head, output =>
      /STATUS held=public-latch/u.test(output)
    );
    assert.match(head.output(), /HOLD ticket 3:/u);
    assert.match(head.output(), /failure: {2}transient/u);
    assert.match(
      head.output(),
      /STATUS held=public-latch:\S+ bound=120m transient:/u
    );
    const waiter = land(
      fixture.agentWorktree('agent/hold-waiter', {
        'src/e.ts': 'export const e = 5;\n',
      })
    );
    await waitForOutput(waiter, output =>
      /queue head 3 is holding, not failing/u.test(output)
    );
    const held = tickets(fixture.root).find(ticket => ticket.number === 3);
    assert.equal(held.status, 'integrating');
    assert.equal(held.hold.kind, 'public-latch');
    assert.equal(held.hold.failure, 'transient');
    assert.equal(git(fixture.origin, ['rev-parse', 'master']), latchedMaster);

    rmSync(path.join(remote, 'hooks', 'pre-receive'));
    const headOutput = await succeeded(head);
    assert.match(headOutput, /HOLD released after/u);
    assert.match(headOutput, /STATUS .*public=published held=public-latch:/u);
    assert.match(await succeeded(waiter), /public=published/u);

    const all = tickets(fixture.root);
    assert.deepEqual(
      all.map(ticket => [ticket.number, ticket.status]),
      [
        [1, 'integrated'],
        [2, 'integrated'],
        [3, 'integrated'],
        [4, 'integrated'],
      ],
      'no ticket failed and none was resubmitted'
    );
    assert.equal(all[2].hold, undefined);
    assert.ok(all[2].result.publicLatchHeldMs > 0);
    const metrics = await readDeliveryMetrics(fixture.root);
    assert.equal(
      metrics.find(event => event.type === 'queue_hold').failure,
      'transient'
    );
    assert.equal(
      metrics.find(event => event.type === 'queue_hold_released').outcome,
      'released'
    );
  } finally {
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});

test('a deterministic latch fails only past its bound, with the latch in its terminal record, and a maintenance hold releases a held head', async () => {
  const fixture = createPrivateFixture('exawatt-hold-deterministic-');
  const running = [];
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const env = {
      ...writeFastPnpm(fixture.parent),
      EXAWATT_PUBLIC_LATCH_RETRY_SECONDS: '0.2',
    };
    const land = (worktree, extra = {}) => {
      const landing = startLanding(worktree, [], { ...env, ...extra });
      running.push(landing);
      return landing;
    };
    const first = fixture.agentWorktree('agent/latch-first', {
      'src/b.ts': 'export const b = 2;\n',
    });
    assert.match(await succeeded(land(first)), /public=published/u);
    const publicTip = git(remote, ['rev-parse', 'master']);

    // The 2026-09-24 shape: an unrenderable direct commit, then its repair.
    git(fixture.root, ['pull', '--quiet', '--ff-only', 'origin', 'master']);
    const workflow = path.join(fixture.root, WORKFLOW_PATH);
    writeFileSync(
      workflow,
      fixtureWorkflow().replace('on:\n', 'on:\n  pull_request_target:\n')
    );
    git(fixture.root, ['commit', '--quiet', '-am', 'direct: unrenderable']);
    const unrenderable = git(fixture.root, ['rev-parse', 'HEAD']);
    writeFileSync(workflow, fixtureWorkflow());
    git(fixture.root, ['commit', '--quiet', '-am', 'direct: repair the tree']);
    git(fixture.root, ['push', '--quiet', 'origin', 'master']);
    const privateMaster = git(fixture.origin, ['rev-parse', 'master']);
    const candidate = fixture.agentWorktree('agent/latch-candidate', {
      'src/c.ts': 'export const c = 3;\n',
    });
    const cause =
      `private ${unrenderable.slice(0, 12)} cannot render ${WORKFLOW_PATH} ` +
      '(check render-public-ci/forbidden-reference)';
    const preview =
      `pnpm open-source:catchup -- --source ${privateMaster} ` +
      `--expected-public-sha ${publicTip}`;

    const expired = await finished(
      land(candidate, { EXAWATT_PUBLIC_LATCH_HOLD_MINUTES: '0.01' })
    );
    assert.notEqual(expired.code, 0);
    assert.ok(
      expired.output.includes(`deterministic: ${cause}; recovery: ${preview}`),
      expired.output
    );
    // The status line carries every fact of the latch, whatever the hold
    // lasted on this machine.
    const status = expired.output
      .split('\n')
      .find(line => line.includes('STATUS failed=public-latch'));
    assert.ok(status, expired.output);
    assert.ok(
      status.endsWith(
        ` failure=deterministic private=${unrenderable.slice(0, 12)} path=${WORKFLOW_PATH} check=render-public-ci/forbidden-reference recovery="${preview}"`
      ),
      status
    );
    const [, failed] = tickets(fixture.root);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.result.publicLatch.failure, 'deterministic');
    assert.equal(failed.result.publicLatch.privateSha, unrenderable);
    assert.equal(failed.result.queueHold.outcome, 'expired');
    const terminal = (await readDeliveryMetrics(fixture.root))
      .filter(event => event.type === 'queue_terminal')
      .at(-1);
    assert.equal(terminal.publicLatch.path, WORKFLOW_PATH);
    assert.equal(git(fixture.origin, ['rev-parse', 'master']), privateMaster);

    const head = land(candidate);
    await waitForOutput(head, output =>
      /STATUS held=public-latch/u.test(output)
    );
    assert.ok(head.output().includes(`deterministic: ${cause}`), head.output());
    assert.equal(git(fixture.origin, ['rev-parse', 'master']), privateMaster);
    // The operator starts the reviewed recovery; its maintenance hold lets
    // verified private work through while publication is owed.
    await enablePublicMaintenanceHold(fixture.root, {
      expectedPublicSha: publicTip,
      reason: 'reviewed catch-up of the unrenderable direct commit',
    });
    const output = await succeeded(head);
    assert.match(output, /HOLD released after/u);
    assert.match(output, /public=held/u);
    assert.equal(
      git(fixture.origin, ['rev-parse', 'master']),
      git(candidate, ['rev-parse', 'HEAD'])
    );
    assert.equal(git(remote, ['rev-parse', 'master']), publicTip);
  } finally {
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});
