import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { probeRebase } from './lib/conflict-probe.mjs';
import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import {
  commit,
  createQueueFixture,
  finished,
  startLanding,
  waitForOutput,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { git } from './lib/hermetic-git.mjs';

/**
 * BUG-202: a waiting ticket checks for conflicts every time origin/master
 * moves. In September 20 of the 38 ticket deaths were rebase conflicts; those
 * tickets waited 2.3 hours on average and then died within a second of
 * reaching the head.
 */

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
    .sort((left, right) => left.number - right.number);
}

test('the probe replays commit by commit and changes nothing on disk', async () => {
  const fixture = createQueueFixture('exawatt-probe-unit-');
  try {
    const main = fixture.main;
    const base = git(main, ['rev-parse', 'HEAD']);
    git(main, ['checkout', '--quiet', '-b', 'topic']);
    write(main, 'src/app.ts', 'export const app = "topic";\n');
    commit(main, 'topic: app');
    write(main, 'docs/guide.md', '# Guide\n\nTopic paragraph.\n');
    const topic = commit(main, 'topic: guide');
    git(main, ['checkout', '--quiet', 'master']);
    write(main, 'docs/other.md', '# Other\n');
    const clean = commit(main, 'master: elsewhere');
    write(main, 'docs/guide.md', '# Guide\n\nMaster paragraph.\n');
    const conflicting = commit(main, 'master: guide');
    const before = [
      git(main, ['status', '--porcelain']),
      git(main, ['for-each-ref']),
      git(main, ['rev-parse', 'HEAD']),
    ];

    assert.deepEqual(await probeRebase(main, { sha: topic, onto: clean }), {
      clean: true,
    });
    assert.deepEqual(await probeRebase(main, { sha: topic, onto: base }), {
      clean: true,
    });
    const verdict = await probeRebase(main, { sha: topic, onto: conflicting });
    assert.equal(verdict.clean, false);
    assert.deepEqual(verdict.paths, ['docs/guide.md']);
    assert.equal(
      verdict.commit,
      topic,
      'the second commit is the one that conflicts'
    );
    // `git rebase` stops at the first commit that conflicts even when a
    // later one undoes it, so the probe must too: a single merge of the tip
    // would call this clean.
    git(main, ['checkout', '--quiet', '-b', 'undo', base]);
    write(main, 'docs/guide.md', '# Guide\n\nA passing edit.\n');
    commit(main, 'undo: edit');
    write(main, 'docs/guide.md', '# Guide\n\nFirst paragraph.\n');
    const undone = commit(main, 'undo: revert');
    git(main, ['checkout', '--quiet', 'master']);
    const intermediate = await probeRebase(main, {
      sha: undone,
      onto: conflicting,
    });
    assert.equal(intermediate.clean, false);
    assert.equal(intermediate.commit, git(main, ['rev-parse', `${undone}^`]));
    git(main, ['branch', '--quiet', '-D', 'undo']);
    assert.deepEqual(
      [
        git(main, ['status', '--porcelain']),
        git(main, ['for-each-ref']),
        git(main, ['rev-parse', 'HEAD']),
      ],
      before
    );
  } finally {
    fixture.cleanup();
  }
});

test('a waiting ticket that would conflict leaves the queue before the head reaches it', async () => {
  const fixture = createQueueFixture('exawatt-probe-queue-');
  const running = [];
  let lock;
  try {
    const env = { EXAWATT_AGENT_LAND_PROBE_SECONDS: '0.2' };
    const land = worktree => {
      const landing = fixture.land(worktree, [], env);
      running.push(landing);
      return landing;
    };
    const one = fixture.agentWorktree('agent/one', {
      'src/one.ts': 'export const one = 1;\n',
    });
    const two = fixture.agentWorktree('agent/two', {
      'docs/guide.md': '# Guide\n\nThe ticket rewrote this paragraph.\n',
    });
    const three = fixture.agentWorktree('agent/three', {
      'src/three.ts': 'export const three = 3;\n',
    });
    // The head cannot finish while the test holds the delivery lock.
    lock = await acquireDeliveryLock(fixture.main, { log() {} });
    const head = land(one);
    await waitForOutput(head, output => /admitted ticket 1/u.test(output));
    const conflicted = land(two);
    await waitForOutput(conflicted, output =>
      /admitted ticket 2/u.test(output)
    );
    const bystander = land(three);
    await waitForOutput(bystander, output => /admitted ticket 3/u.test(output));
    await waitForOutput(head, output =>
      /waiting for the active master delivery transaction/u.test(output)
    );

    const moved = fixture.advanceMaster({
      'docs/guide.md': '# Guide\n\nAnother landing rewrote it first.\n',
    });
    const { code, output } = await finished(conflicted);
    assert.notEqual(code, 0);
    assert.match(
      output,
      new RegExp(
        `ticket 2 would conflict when rebased onto origin/master ${moved.slice(0, 12)}, in:\\n  docs/guide\\.md`,
        'u'
      )
    );
    assert.match(output, /STATUS failed=probe-conflict/u);
    const [first, second, third] = tickets(fixture.main);
    assert.equal(
      first.status,
      'integrating',
      'the verdict arrives while the head is still ahead of this ticket'
    );
    assert.equal(second.status, 'failed');
    assert.deepEqual(second.result.probeConflict.paths, ['docs/guide.md']);
    assert.equal(second.result.probeConflict.baseSha, moved);
    assert.equal(third.status, 'queued', 'a clean waiter keeps its place');
    const metric = (await readDeliveryMetrics(fixture.main)).find(
      event => event.type === 'probe_conflict'
    );
    assert.deepEqual(metric.paths, ['docs/guide.md']);

    await lock.release();
    lock = null;
    for (const landing of [head, bystander]) {
      const result = await finished(landing);
      assert.equal(result.code, 0, result.output);
    }
    assert.deepEqual(
      tickets(fixture.main).map(ticket => ticket.status),
      ['integrated', 'failed', 'integrated']
    );
  } finally {
    await lock?.release();
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});

test('the probe is off when its interval is zero', async () => {
  const fixture = createQueueFixture('exawatt-probe-off-');
  let lock;
  const running = [];
  try {
    const env = { EXAWATT_AGENT_LAND_PROBE_SECONDS: '0' };
    lock = await acquireDeliveryLock(fixture.main, { log() {} });
    const head = startLanding(
      fixture.agentWorktree('agent/one', {
        'src/one.ts': 'export const one = 1;\n',
      }),
      [],
      { ...fixture.env, ...env }
    );
    running.push(head);
    await waitForOutput(head, output => /admitted ticket 1/u.test(output));
    const waiter = startLanding(
      fixture.agentWorktree('agent/two', {
        'docs/guide.md': '# Guide\n\nThe ticket rewrote this paragraph.\n',
      }),
      [],
      { ...fixture.env, ...env }
    );
    running.push(waiter);
    await waitForOutput(waiter, output => /admitted ticket 2/u.test(output));
    fixture.advanceMaster({
      'docs/guide.md': '# Guide\n\nAnother landing rewrote it first.\n',
    });
    await lock.release();
    lock = null;
    // Without the probe the head's rebase is what refuses it, as before.
    const { code, output } = await finished(waiter);
    assert.notEqual(code, 0);
    assert.match(output, /Automatic queue-head rebase conflicted/u);
    assert.doesNotMatch(output, /failed=probe-conflict/u);
    assert.equal((await finished(head)).code, 0);
  } finally {
    await lock?.release();
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});

test('a change that already conflicts is refused before its floor runs', async () => {
  const fixture = createQueueFixture('exawatt-probe-upfront-');
  try {
    const worktree = fixture.agentWorktree('agent/late', {
      'docs/guide.md': '# Guide\n\nThe ticket rewrote this paragraph.\n',
    });
    const moved = fixture.advanceMaster({
      'docs/guide.md': '# Guide\n\nAnother landing rewrote it first.\n',
    });
    const { code, output } = await finished(fixture.land(worktree));
    assert.notEqual(code, 0);
    assert.match(
      output,
      new RegExp(
        `this change would conflict when rebased onto origin/master ${moved.slice(0, 12)}, in:\\n  docs/guide\\.md`,
        'u'
      )
    );
    assert.match(output, /nothing ran and no ticket was taken/u);
    assert.doesNotMatch(output, /candidate floor/u);
    const metrics = await readDeliveryMetrics(fixture.main);
    assert.equal(
      metrics.filter(event => event.type === 'floor_check').length,
      0
    );
    assert.equal(
      metrics.filter(event => event.type === 'queue_admitted').length,
      0
    );
    assert.equal(
      metrics.find(event => event.type === 'probe_conflict').phase,
      'candidate'
    );
  } finally {
    fixture.cleanup();
  }
});
