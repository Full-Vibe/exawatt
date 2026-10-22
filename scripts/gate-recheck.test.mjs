import assert from 'node:assert/strict';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import { surfaceGateRecheck } from './lib/delivery-policy.mjs';
import {
  addsLandingCheck,
  createQueueFixture,
  finished,
  waitForOutput,
} from './lib/delivery-queue-fixture.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { TREE_POLICY_FILE } from './lib/tree-policy.mjs';

/**
 * BUG-205: after a queue-head rebase, a declared surface gate re-runs on the
 * rebased tree when the commits rebased over touched its surface. Ticket 466
 * integrated with gate evidence from its pre-rebase tree although the landing
 * it rebased over changed `workspace-client.tsx`.
 */

const GATES = {
  'eval:roadmap:rail': 'node -e "process.exit(0)"',
  'eval:theme-system': 'node -e "process.exit(0)"',
};
const RAIL_FILE = 'src/components/roadmap/rail.tsx';
const THEME_FILE = 'themes/v1/dark.json';
const DECLARE = [
  '--verify',
  'eval:roadmap:rail',
  '--verify',
  'eval:theme-system',
];

function runs(log, gate) {
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return text.split('\n').filter(line => line === `run ${gate}`).length;
}

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
    .sort((left, right) => left.number - right.number);
}

test('only declared gates whose surface the upstream commits touched re-run', () => {
  assert.deepEqual(
    surfaceGateRecheck(
      ['eval:roadmap:rail', 'eval:theme-system', 'type-check'],
      ['src/components/roadmap/other.tsx', 'docs/a.md']
    ),
    {
      rerun: [
        {
          gate: 'eval:roadmap:rail',
          paths: ['src/components/roadmap/other.tsx'],
        },
      ],
      stood: ['eval:theme-system'],
    }
  );
  assert.deepEqual(
    surfaceGateRecheck([], ['src/components/roadmap/other.tsx']),
    { rerun: [], stood: [] },
    'an undeclared gate is not added by an upstream change'
  );
});

async function landGated(upstream) {
  const fixture = createQueueFixture('exawatt-gate-recheck-', {
    scripts: GATES,
  });
  const log = fixture.at('pnpm.log');
  const worktree = fixture.agentWorktree('agent/gated', {
    [RAIL_FILE]: 'export const rail = 1;\n',
    [THEME_FILE]: '{"name":"dark"}\n',
  });
  // Another landing reaches master after this ticket's landing-check base.
  fixture.advanceMaster(upstream);
  const landed = await finished(
    fixture.land(worktree, DECLARE, {
      FIXTURE_PNPM_LOG: log,
      EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
    })
  );
  return { fixture, log, landed };
}

test('a gate whose surface changed under the ticket re-runs on the rebased tree; the other stands', async () => {
  const { fixture, log, landed } = await landGated({
    'src/components/roadmap/other.tsx': 'export const other = 1;\n',
  });
  try {
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.equal(runs(log, 'eval:roadmap:rail'), 2, 'candidate and rebase');
    assert.equal(runs(log, 'eval:theme-system'), 1, 'candidate only');
    assert.match(
      landed.output,
      /surface gate eval:roadmap:rail re-runs on the rebased tree: \S+ changed src\/components\/roadmap\/other\.tsx/u
    );
    assert.match(
      landed.output,
      /STATUS .* gates=rerun:eval:roadmap:rail,stood:eval:theme-system/u
    );
    const [ticket] = tickets(fixture.main);
    assert.deepEqual(
      ticket.gateRechecks.map(entry => entry.rerun),
      [['eval:roadmap:rail']]
    );
    const metrics = await readDeliveryMetrics(fixture.main);
    const rebased = metrics.filter(
      event =>
        event.type === 'landing_check' &&
        event.phase === 'rebase' &&
        event.id === 'eval:roadmap:rail'
    );
    assert.equal(rebased.length, 1);
    assert.equal(rebased[0].status, 'passed');
  } finally {
    fixture.cleanup();
  }
});

test('unrelated upstream paths leave every gate’s pre-rebase evidence standing, and say so', async () => {
  const { fixture, log, landed } = await landGated({
    'docs/unrelated.md': '# Unrelated\n',
  });
  try {
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.equal(runs(log, 'eval:roadmap:rail'), 1);
    assert.equal(runs(log, 'eval:theme-system'), 1);
    assert.match(
      landed.output,
      /STATUS .* gates=stood:eval:roadmap:rail,stood:eval:theme-system/u
    );
    const [ticket] = tickets(fixture.main);
    assert.deepEqual(ticket.gateRechecks[0].rerun, []);
    assert.deepEqual(ticket.gateRechecks[0].stood, [
      'eval:roadmap:rail',
      'eval:theme-system',
    ]);
    const metric = (await readDeliveryMetrics(fixture.main)).find(
      event => event.type === 'gate_recheck'
    );
    assert.deepEqual(metric.rerun, []);
  } finally {
    fixture.cleanup();
  }
});

// With EXA_BASE set, the landing restarts a server that went away while the
// ticket waited (BUG-246, landing-dev-server.test.mjs). Without one it leaves
// each gate to choose its own target, and a gate that then fails on the
// rebased tree must still name itself, the range that forced it, and the base.
test('a re-run gate that fails on the rebased tree fails the ticket naming the gate, the range and EXA_BASE', async () => {
  const fixture = createQueueFixture('exawatt-gate-server-', {
    scripts: GATES,
  });
  const running = [];
  let lock;
  try {
    const server = fixture.at('dev-server-alive');
    writeFileSync(server, 'up\n');
    const env = {
      FIXTURE_DEV_SERVER: server,
      EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
    };
    lock = await acquireDeliveryLock(fixture.main, { log() {} });
    const head = fixture.land(
      fixture.agentWorktree('agent/head', { 'src/head.ts': 'export {};\n' }),
      [],
      env
    );
    running.push(head);
    await waitForOutput(head, output =>
      /waiting for the active master delivery transaction/u.test(output)
    );
    const gated = fixture.land(
      fixture.agentWorktree('agent/gated', {
        [RAIL_FILE]: 'export const rail = 1;\n',
        [THEME_FILE]: '{"name":"dark"}\n',
      }),
      DECLARE,
      env
    );
    running.push(gated);
    await waitForOutput(gated, output => /admitted ticket 2/u.test(output));
    fixture.advanceMaster({
      'src/components/roadmap/other.tsx': 'export const other = 1;\n',
    });
    // Whatever the gate reads is gone by the time the head re-runs it.
    rmSync(server);
    await lock.release();
    lock = null;
    assert.equal((await finished(head)).code, 0);
    const { code, output } = await finished(gated);
    assert.notEqual(code, 0);
    assert.match(output, /no dev server answering at \(unset\)/u);
    assert.match(
      output,
      /surface gate eval:roadmap:rail re-ran on the rebased tree because \S+ changed src\/components\/roadmap\/other\.tsx on its surface, and failed/u
    );
    assert.match(output, /EXA_BASE=\(unset\)/u);
    assert.equal(tickets(fixture.main)[1].status, 'failed');
  } finally {
    await lock?.release();
    await Promise.all(running.map(landing => landing.stop()));
    fixture.cleanup();
  }
});

/** The test files each `vitest run` the landing ran named, in order. */
function vitestSelections(log) {
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(line => line.startsWith('exec vitest run '))
    .map(line =>
      line
        .split(' ')
        .filter(argument => /\.test\.tsx?$/u.test(argument))
        .join(' ')
    );
}

// 2026-10-19 review: the head's re-check classified the rebased tree with
// the scanning-test declarations it read before the rebase, from the tree the
// landing script lives in. The rebase here adds a scanning test and widens
// another; the re-check owes both, and the candidate owed neither.
test('the head re-check runs the scanning tests the rebased tree declares', async () => {
  const fixture = createQueueFixture('exawatt-scan-recheck-', {
    files: {
      'src/kept.test.ts': '// @scans src/app.ts\n',
      'src/widened.test.ts': '// @scans src/other.ts\n',
    },
  });
  try {
    const log = fixture.at('pnpm.log');
    const worktree = fixture.agentWorktree('agent/scanned', {
      'src/app.ts': 'export const app = 2;\n',
    });
    fixture.advanceMaster({
      'src/added.test.ts': '// @scans src/**\n',
      'src/widened.test.ts': '// @scans src/app.ts src/other.ts\n',
    });
    const landed = await finished(
      fixture.land(worktree, [], {
        FIXTURE_PNPM_LOG: log,
        EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
      })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.deepEqual(vitestSelections(log), [
      'src/kept.test.ts',
      'src/added.test.ts src/kept.test.ts src/widened.test.ts',
    ]);
  } finally {
    fixture.cleanup();
  }
});

// BUG-317: a landing classified every tree with the code of the checkout that
// ran it. A gate a change adds for its own surface is owed by that change.
test('a candidate that adds a gate for its own surface owes it in its own landing', async () => {
  const fixture = createQueueFixture('exawatt-own-gate-', {
    scripts: { 'eval:fixture:owned': 'node -e "process.exit(0)"' },
  });
  try {
    const log = fixture.at('pnpm.log');
    const before = fixture.originMaster();
    const worktree = fixture.agentWorktree('agent/owned', {
      'src/owned.ts': 'export const owned = 1;\n',
      [TREE_POLICY_FILE]: fixture.policyWith(
        `
SURFACE_GATES.push({
  gate: 'eval:fixture:owned',
  why: 'the surface this change adds',
  match: file => file === 'src/owned.ts',
});
`
      ),
    });
    const env = {
      FIXTURE_PNPM_LOG: log,
      EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
    };
    const refused = await finished(fixture.land(worktree, [], env));
    assert.notEqual(refused.code, 0, refused.output);
    assert.match(
      refused.output,
      /touches surfaces that own eval gates[\s\S]*eval:fixture:owned . the surface this change adds\n\s+src\/owned\.ts/u
    );
    assert.equal(fixture.originMaster(), before);
    assert.equal(runs(log, 'eval:fixture:owned'), 0);

    const landed = await finished(
      fixture.land(worktree, ['--verify', 'eval:fixture:owned'], env)
    );
    assert.equal(landed.code, 0, landed.output);
    assert.equal(runs(log, 'eval:fixture:owned'), 1);
  } finally {
    fixture.cleanup();
  }
});

test('the head re-check owes the checks the rebased tree’s own policy adds', async () => {
  for (const red of [false, true]) {
    const fixture = createQueueFixture('exawatt-policy-recheck-');
    try {
      const log = fixture.at('pnpm.log');
      const worktree = fixture.agentWorktree('agent/earlier', {
        'src/app.ts': 'export const app = 2;\n',
      });
      // Master gains a landing check after this candidate's base.
      fixture.advanceMaster({
        [TREE_POLICY_FILE]: fixture.policyWith(
          addsLandingCheck('fixture:added')
        ),
      });
      const landed = await finished(
        fixture.land(worktree, [], {
          FIXTURE_PNPM_LOG: log,
          EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
          ...(red ? { FIXTURE_FAILS: 'fixture:added=src/app.ts' } : {}),
        })
      );
      assert.match(landed.output, /rebase onto/u);
      assert.equal(
        runs(log, 'fixture:added'),
        1,
        'the rebased tree owes it; the candidate did not'
      );
      const rechecked = (await readDeliveryMetrics(fixture.main)).filter(
        event => event.type === 'landing_check' && event.id === 'fixture:added'
      );
      assert.deepEqual(
        rechecked.map(event => [event.phase, event.status]),
        [['rebase', red ? 'failed' : 'passed']]
      );
      if (red) {
        assert.notEqual(landed.code, 0, landed.output);
        assert.equal(tickets(fixture.main)[0].status, 'failed');
      } else {
        assert.equal(landed.code, 0, landed.output);
      }
    } finally {
      fixture.cleanup();
    }
  }
});
