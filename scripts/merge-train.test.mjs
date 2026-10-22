import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseArgs } from './agent-land.mjs';
import {
  commit,
  createQueueFixture,
  finished,
  waitForOutput,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { git } from './lib/hermetic-git.mjs';
import {
  electronFacingPaths,
  firstRedCar,
  trainOptionsRefusal,
} from './lib/merge-train.mjs';

/**
 * ENG-039 M3: `agent:land --train` lands a front's packets as one train. Each
 * landing here is a real one, through this tree's agent-land.mjs, into the
 * fixture's own bare origin and queue.
 */

const QUIET = { EXAWATT_AGENT_LAND_PROBE_SECONDS: '0' };
/** A train's own integration worktree, as `git worktree list` names it. */
const INTEGRATION_TREE = /exawatt-train-\d{8}-\d{6}-/u;

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  if (!existsSync(queue)) return [];
  return readdirSync(queue)
    .filter(file => file.endsWith('.json'))
    .map(file => JSON.parse(readFileSync(path.join(queue, file), 'utf8')))
    .sort((left, right) => left.number - right.number);
}

function subjects(fixture, from) {
  const range = `${from}..${fixture.originMaster()}`;
  const log = git(fixture.main, ['log', '--reverse', '--format=%s', range]);
  return log ? log.split('\n') : [];
}

function trees(root) {
  return git(root, ['worktree', 'list', '--porcelain']);
}

function trainBranches(root) {
  return git(root, ['branch', '--list', 'agent/train-*']);
}

function runs(log, command) {
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return text.split('\n').filter(line => line === command).length;
}

function assertNothingLanded(fixture, before, landed) {
  assert.notEqual(landed.code, 0, landed.output);
  assert.equal(fixture.originMaster(), before, 'origin/master did not move');
  assert.deepEqual(tickets(fixture.main), [], 'no ticket was taken');
  assert.doesNotMatch(trees(fixture.main), INTEGRATION_TREE);
  assert.equal(trainBranches(fixture.main), '');
}

test('--train takes its cars and refuses what it cannot mean', () => {
  const options = parseArgs([
    '--',
    '--train',
    'agent/a',
    'agent/b',
    '--land-passing',
    '--verify',
    'type-check',
  ]);
  assert.deepEqual(options.train, ['agent/a', 'agent/b']);
  assert.equal(options.landPassing, true);
  assert.deepEqual(options.verify, ['type-check']);
  assert.equal(trainOptionsRefusal(options), null);
  assert.throws(() => parseArgs(['--train']), /at least one agent\/<slug>/u);
  assert.throws(
    () => parseArgs(['--train', '--verify', 'lint']),
    /at least one agent\/<slug>/u
  );
  const refuse = overrides =>
    trainOptionsRefusal({
      ...parseArgs([]),
      ...overrides,
    });
  assert.match(refuse({ landPassing: true }), /only to --train/u);
  assert.match(refuse({ train: ['agent/a'], docs: true }), /--docs/u);
  assert.match(refuse({ train: ['agent/a'], direct: true }), /--direct/u);
  assert.match(refuse({ train: ['master'] }), /agent\/<slug>/u);
  assert.match(refuse({ train: ['agent/a', 'agent/a'] }), /more than once/u);
});

test('prefix bisection names the first car that turns the stack red', async () => {
  for (const [count, guilty] of [
    [1, 0],
    [2, 0],
    [2, 1],
    [5, 3],
    [8, 0],
    [8, 7],
  ]) {
    const asked = [];
    const found = await firstRedCar(count, async prefix => {
      asked.push(prefix);
      return prefix > guilty;
    });
    assert.equal(found, guilty, `${guilty} of ${count}`);
    assert.ok(
      asked.length <= Math.ceil(Math.log2(count)),
      `${asked.length} checks for ${count} cars`
    );
    assert.ok(asked.every(prefix => prefix > 0 && prefix < count));
  }
});

test('what the packaged app contains is Electron-facing; tests and tooling are not', () => {
  assert.deepEqual(
    electronFacingPaths([
      'electron/main/a.ts',
      'electron/main/a.test.ts',
      'src/components/x.tsx',
      'src/components/x.test.tsx',
      'packages/core/src/y.ts',
      'packages/core/package.json',
      'themes/v1/dark.json',
      'pnpm-lock.yaml',
      'scripts/z.mjs',
      'docs/a.md',
    ]),
    [
      'electron/main/a.ts',
      'src/components/x.tsx',
      'packages/core/src/y.ts',
      'themes/v1/dark.json',
      'pnpm-lock.yaml',
    ]
  );
});

test('cars stack in order and land linearly as one ticket and one push', async () => {
  const fixture = createQueueFixture('exawatt-train-');
  try {
    const a = fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    write(a, 'docs/a-more.md', '# More A\n');
    commit(a, 'a: a second commit');
    fixture.agentWorktree('agent/b', { 'docs/b.md': '# B\n' });
    const before = fixture.originMaster();

    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b'], QUIET)
    );
    assert.equal(landed.code, 0, landed.output);
    assert.deepEqual(subjects(fixture, before), [
      'agent: agent/a',
      'a: a second commit',
      'agent: agent/b',
    ]);
    assert.match(landed.output, /STATUS .* train=agent\/a:2,agent\/b:1/u);
    assert.match(landed.output, /lane=train/u);

    const all = tickets(fixture.main);
    assert.equal(all.length, 1, 'one ticket for the whole train');
    const [ticket] = all;
    assert.equal(ticket.lane, 'train');
    assert.match(ticket.branch, /^agent\/train-/u);
    assert.deepEqual(
      ticket.train.cars.map(car => [car.branch, car.commits.length]),
      [
        ['agent/a', 2],
        ['agent/b', 1],
      ]
    );
    const landedShas = git(fixture.main, [
      'rev-list',
      '--reverse',
      `${before}..${fixture.originMaster()}`,
    ]).split('\n');
    assert.deepEqual(
      ticket.result.train.flatMap(car =>
        car.commits.map(entry => entry.integrated)
      ),
      landedShas,
      'each car commit maps to the integrated commit that carries it'
    );
    const metrics = await readDeliveryMetrics(fixture.main);
    assert.equal(
      metrics.filter(event => event.type === 'integration_lock').length,
      1,
      'one push'
    );

    assert.doesNotMatch(trees(fixture.main), INTEGRATION_TREE);
    assert.equal(trainBranches(fixture.main), '');
    // The cars are their owners' to remove.
    assert.ok(git(fixture.main, ['rev-parse', '--verify', 'agent/a']));
    assert.match(trees(fixture.main), /agent-a/u);
  } finally {
    fixture.cleanup();
  }
});

test('a car that conflicts with an earlier car is refused, naming both and the path', async () => {
  const fixture = createQueueFixture('exawatt-train-conflict-');
  try {
    fixture.agentWorktree('agent/a', {
      'src/app.ts': 'export const app = 2;\n',
    });
    fixture.agentWorktree('agent/b', {
      'src/app.ts': 'export const app = 3;\n',
    });
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b'], QUIET)
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /train refused: agent\/b conflicts with agent\/a when stacked after it/u
    );
    assert.match(landed.output, /src\/app\.ts \(also changed by agent\/a\)/u);
  } finally {
    fixture.cleanup();
  }
});

test('a red train is bisected to the car that broke it, and nothing lands', async () => {
  const fixture = createQueueFixture('exawatt-train-red-');
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    fixture.agentWorktree('agent/b', { RED: 'breaks lint\n' });
    fixture.agentWorktree('agent/c', { 'docs/c.md': '# C\n' });
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b', 'agent/c'], {
        ...QUIET,
        FIXTURE_FAIL_CHECK: 'lint',
      })
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /TRAIN red: agent\/b broke lint; agent\/a passed without it/u
    );
    assert.match(
      landed.output,
      /STATUS failed=train guilty=agent\/b check=lint passed=agent\/a/u
    );
    assert.match(landed.output, /train bisect: agent\/a passed/u);
    assert.match(landed.output, /Nothing landed/u);
  } finally {
    fixture.cleanup();
  }
});

test('--land-passing lands the cars that pass and leaves the guilty one out', async () => {
  const fixture = createQueueFixture('exawatt-train-passing-');
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    fixture.agentWorktree('agent/c', { 'docs/c.md': '# C\n' });
    fixture.agentWorktree('agent/b', { RED: 'breaks lint\n' });
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(
        fixture.main,
        ['--train', 'agent/a', 'agent/c', 'agent/b', '--land-passing'],
        { ...QUIET, FIXTURE_FAIL_CHECK: 'lint' }
      )
    );
    assert.equal(landed.code, 0, landed.output);
    assert.deepEqual(subjects(fixture, before), [
      'agent: agent/a',
      'agent: agent/c',
    ]);
    assert.match(
      landed.output,
      /train=agent\/a:1,agent\/c:1 excluded=agent\/b/u
    );
    assert.match(landed.output, /train left out agent\/b: broke lint/u);
    // The stack it lands is the bisection's green prefix, checked in the same
    // worktree, so its recorded passes stand in for a re-run.
    assert.match(landed.output, /STATUS .* reused=/u);
    const [ticket] = tickets(fixture.main);
    assert.deepEqual(ticket.train.excluded, [
      { branch: 'agent/b', reason: 'broke lint' },
    ]);
    assert.deepEqual(
      ticket.train.bisect.map(step => [step.cars.join(','), step.result]),
      [
        ['agent/a,agent/c,agent/b', 'failed'],
        ['agent/a', 'passed'],
        ['agent/a,agent/c', 'passed'],
      ]
    );
  } finally {
    fixture.cleanup();
  }
});

const DEV_SERVER = `import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { git } from '${new URL('./lib/hermetic-git.mjs', import.meta.url).href}';

const args = process.argv.slice(2);
let port = 0;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '-p') port = Number(args[index + 1]);
}
const sourceHead = git(process.cwd(), ['rev-parse', 'HEAD']);
appendFileSync(process.env.FIXTURE_DEV_PIDS, process.pid + '\\n');
http
  .createServer((request, response) => {
    if (request.url !== '/api/dev-identity') {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({ repoRoot: process.cwd(), distributionDigest: null, sourceHead })
    );
  })
  .listen(port);
`;

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('every gate the stack owes runs once, against a dev server the train starts and stops', async () => {
  const fixture = createQueueFixture('exawatt-train-gates-', {
    scripts: {
      'eval:roadmap:rail': 'node -e "process.exit(0)"',
      'eval:theme-system': 'node -e "process.exit(0)"',
    },
    files: { '.gitignore': 'node_modules/\n.next/\ndist-electron/\n' },
  });
  try {
    fixture.agentWorktree('agent/rail', {
      'src/components/roadmap/rail.tsx': 'export const rail = 1;\n',
    });
    fixture.agentWorktree('agent/theme', {
      'themes/v1/dark.json': '{"name":"dark"}\n',
    });
    const log = fixture.at('pnpm.log');
    const pids = fixture.at('dev-pids.log');
    const server = fixture.at('dev-server.mjs');
    writeFileSync(server, DEV_SERVER);
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/rail', 'agent/theme'], {
        ...QUIET,
        FIXTURE_PNPM_LOG: log,
        FIXTURE_DEV_SERVER_SCRIPT: server,
        FIXTURE_DEV_PIDS: pids,
      })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.match(
      landed.output,
      /train declares the gates it owes: .*eval:roadmap:rail/u
    );
    assert.match(
      landed.output,
      /train declares the gates it owes: .*eval:theme-system/u
    );
    assert.equal(runs(log, 'run eval:roadmap:rail'), 1);
    assert.equal(runs(log, 'run eval:theme-system'), 1);
    assert.equal(runs(log, 'worktree:setup'), 1);
    assert.match(
      landed.output,
      /the landing starts its own at http:\/\/localhost:\d+/u
    );
    const started = readFileSync(pids, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(Number);
    assert.ok(started.length > 0, 'the landing started a dev server');
    assert.deepEqual(
      started.filter(alive),
      [],
      'the train stopped its server before removing the worktree it served'
    );
    assert.doesNotMatch(trees(fixture.main), INTEGRATION_TREE);
  } finally {
    fixture.cleanup();
  }
});

test('one dogfood build when a car is Electron-facing, none when no car is', async () => {
  for (const [files, expected] of [
    [{ 'electron/main/feature.ts': 'export const feature = 1;\n' }, 1],
    [{ 'docs/feature.md': '# Feature\n' }, 0],
  ]) {
    const fixture = createQueueFixture('exawatt-train-dogfood-');
    try {
      fixture.agentWorktree('agent/a', files);
      fixture.agentWorktree('agent/b', { 'docs/b.md': '# B\n' });
      const landed = await finished(
        fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b'], QUIET)
      );
      assert.equal(landed.code, 0, landed.output);
      const requested = (await readDeliveryMetrics(fixture.main)).filter(
        event => event.type === 'dogfood_requested'
      );
      assert.equal(requested.length, expected, landed.output);
      assert.match(
        landed.output,
        expected ? /installed=queued/u : /installed=not-requested/u
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test('a car whose local and pushed tips differ is refused', async () => {
  const fixture = createQueueFixture('exawatt-train-diverged-');
  try {
    const a = fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    git(a, ['push', '--quiet', 'origin', 'agent/a']);
    write(a, 'docs/a.md', '# A, edited after the push\n');
    commit(a, 'a: not pushed');
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a'], QUIET)
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /train refused: agent\/a is [0-9a-f]{12} here and [0-9a-f]{12} on origin/u
    );
  } finally {
    fixture.cleanup();
  }
});

test('a train whose base moves while it waits rebases at the head and still maps every car', async () => {
  const fixture = createQueueFixture('exawatt-train-rebase-');
  let lock;
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    fixture.agentWorktree('agent/b', { 'docs/b.md': '# B\n' });
    lock = await acquireDeliveryLock(fixture.main, { log() {} });
    const landing = fixture.land(
      fixture.main,
      ['--train', 'agent/a', 'agent/b'],
      QUIET
    );
    await waitForOutput(landing, output => output.includes('admitted ticket'));
    const upstream = fixture.advanceMaster({ 'docs/other.md': '# Other\n' });
    await lock.release();
    lock = null;
    const landed = await finished(landing);
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.deepEqual(subjects(fixture, upstream), [
      'agent: agent/a',
      'agent: agent/b',
    ]);
    const [ticket] = tickets(fixture.main);
    const integrated = git(fixture.main, [
      'rev-list',
      '--reverse',
      `${upstream}..${fixture.originMaster()}`,
    ]).split('\n');
    assert.deepEqual(
      ticket.result.train.flatMap(car =>
        car.commits.map(entry => entry.integrated)
      ),
      integrated
    );
  } finally {
    await lock?.release();
    fixture.cleanup();
  }
});
