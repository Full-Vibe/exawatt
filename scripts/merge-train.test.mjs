import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { parseArgs } from './agent-land.mjs';
import {
  addsLandingCheck,
  commit,
  createQueueFixture,
  finished,
  waitForOutput,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { acquireDeliveryLock } from './lib/delivery-lock.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import { git } from './lib/hermetic-git.mjs';
import { classifyDeliveryPolicy } from './lib/delivery-policy.mjs';
import {
  bisectChecks,
  electronFacingPaths,
  firstRedCar,
  trainOptionsRefusal,
} from './lib/merge-train.mjs';
import { TREE_POLICY_FILE } from './lib/tree-policy.mjs';

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

/** How many times each `pnpm run <script>` ran, by script. */
function scriptRuns(log) {
  const counts = {};
  let text = '';
  try {
    text = readFileSync(log, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  for (const line of text.split('\n')) {
    const script = /^run (\S+)/u.exec(line)?.[1];
    if (script) counts[script] = (counts[script] ?? 0) + 1;
  }
  return counts;
}

/** Every script but `except` ran exactly once: on the full stack. */
function assertRanOnce(counts, except) {
  for (const [script, count] of Object.entries(counts)) {
    if (script !== except)
      assert.equal(count, 1, `${script} ran ${count} times`);
  }
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

test('a bisect step runs the check that failed and what it needs, in landing order', () => {
  // A train's own classification: the whole-repository checks.
  const checks = classifyDeliveryPolicy(['scripts/agent-land.mjs'], [], {
    wholeRepo: true,
  });
  const ids = id => bisectChecks(checks, id).map(check => check.id);
  // type-check builds the @exawatt/core runtime the delivery suite loads.
  assert.deepEqual(ids('test:agent-delivery'), [
    'type-check',
    'test:agent-delivery',
  ]);
  assert.deepEqual(ids('lint'), ['lint']);
  // A tree that does not owe the check has nothing to run for it.
  assert.deepEqual(ids('eval:spatial:pointer'), []);
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

test('a red train is bisected with only the check that failed, and nothing lands', async () => {
  const fixture = createQueueFixture('exawatt-train-red-');
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    fixture.agentWorktree('agent/b', { RED: 'breaks lint\n' });
    fixture.agentWorktree('agent/c', { 'docs/c.md': '# C\n' });
    const log = fixture.at('pnpm.log');
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b', 'agent/c'], {
        ...QUIET,
        FIXTURE_FAILS: 'lint=RED',
        FIXTURE_PNPM_LOG: log,
      })
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /TRAIN red: agent\/b broke lint; agent\/a passed without it\. The other cars pass lint without it\./u
    );
    assert.match(
      landed.output,
      /STATUS failed=train guilty=agent\/b check=lint passed=agent\/a rest=passed/u
    );
    assert.match(landed.output, /train bisect: agent\/a passed lint/u);
    assert.match(landed.output, /Nothing landed/u);
    // Twice on the full stack (the failure and its recheck), once on each
    // prefix the bisection asked about, and once on the stack without
    // agent/b. Every other check ran once, on the full stack only.
    const counts = scriptRuns(log);
    assert.equal(counts.lint, 5, landed.output);
    assertRanOnce(counts, 'lint');
  } finally {
    fixture.cleanup();
  }
});

test('a check that passes its recheck is a named flake: no bisect, no car convicted, and the checks after it still run', async () => {
  const fixture = createQueueFixture('exawatt-train-flake-');
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    // The last car: a bisection whose every prefix passes would convict it
    // by elimination.
    fixture.agentWorktree('agent/b', { RED: 'lint flakes here\n' });
    const log = fixture.at('pnpm.log');
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b'], {
        ...QUIET,
        FIXTURE_FAILS: 'lint=RED',
        FIXTURE_FAIL_ONCE: fixture.at('lint-failed-once'),
        FIXTURE_PNPM_LOG: log,
      })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.deepEqual(subjects(fixture, before), [
      'agent: agent/a',
      'agent: agent/b',
    ]);
    assert.match(landed.output, /SUSPECTED FLAKE . lint/u);
    assert.match(landed.output, /STATUS .* flaked=lint:recheck/u);
    assert.match(landed.output, /suspected flake: lint/u);
    assert.doesNotMatch(landed.output, /TRAIN red|bisect/u);
    const [ticket] = tickets(fixture.main);
    assert.deepEqual(ticket.train.bisect, []);
    // The checks before lint did not run again, and the ones after it ran.
    const counts = scriptRuns(log);
    assert.equal(counts.lint, 2, landed.output);
    assert.equal(counts['type-check'], 1);
    assertRanOnce(counts, 'lint');
    const flaked = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'landing_check' && event.status === 'flaked'
    );
    assert.deepEqual(
      flaked.map(event => [event.id, event.recheck]),
      [['lint', 'passed']]
    );
  } finally {
    fixture.cleanup();
  }
});

test('the verdict names the check that failed on the guilty prefix', async () => {
  const fixture = createQueueFixture('exawatt-train-verdict-');
  try {
    // agent/a breaks type-check; agent/b, stacked on it, repairs that and
    // breaks the delivery suite, which needs type-check's build first. So the
    // full stack fails the delivery suite, and agent/a's prefix fails the
    // type-check run before it.
    fixture.agentWorktree('agent/a', { TYPE: 'breaks type-check\n' });
    const b = fixture.at('agent-b');
    git(fixture.main, [
      'worktree',
      'add',
      '--quiet',
      b,
      '-b',
      'agent/b',
      'agent/a',
    ]);
    git(b, ['rm', '--quiet', 'TYPE']);
    write(b, 'DELIVERY', 'breaks the delivery suite\n');
    commit(b, 'agent: agent/b');
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b'], {
        ...QUIET,
        FIXTURE_FAILS: 'type-check=TYPE test:agent-delivery=DELIVERY',
      })
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /train agent\/a,agent\/b failed test:agent-delivery twice/u
    );
    assert.match(landed.output, /train bisect: agent\/a failed type-check/u);
    assert.match(landed.output, /TRAIN red: agent\/a broke type-check\./u);
    assert.match(
      landed.output,
      /STATUS failed=train guilty=agent\/a check=type-check rest=failed:test:agent-delivery/u
    );
  } finally {
    fixture.cleanup();
  }
});

test('a second car that breaks the same check is reported in the same run', async () => {
  const fixture = createQueueFixture('exawatt-train-second-');
  try {
    fixture.agentWorktree('agent/a', { RED: 'breaks lint\n' });
    fixture.agentWorktree('agent/b', { 'docs/b.md': '# B\n' });
    fixture.agentWorktree('agent/c', { RED2: 'also breaks lint\n' });
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(fixture.main, ['--train', 'agent/a', 'agent/b', 'agent/c'], {
        ...QUIET,
        FIXTURE_FAILS: 'lint=RED lint=RED2',
      })
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /TRAIN red: agent\/a broke lint\. Another car also breaks lint\./u
    );
    assert.match(
      landed.output,
      /STATUS failed=train guilty=agent\/a check=lint rest=failed:lint/u
    );
  } finally {
    fixture.cleanup();
  }
});

// BUG-317: on 2026-10-22 a train carried ENG-039's new modules:check from a
// master that predated it, so the check never ran on the stack and master
// landed red. The fixture's master, which runs this train, predates the check
// the middle car adds.
test('a check a car adds to its own delivery policy runs on the stack, and a red one names that car', async () => {
  for (const red of [false, true]) {
    const fixture = createQueueFixture('exawatt-train-added-check-');
    try {
      fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
      fixture.agentWorktree('agent/policy', {
        [TREE_POLICY_FILE]: fixture.policyWith(
          addsLandingCheck('fixture:added')
        ),
        ...(red ? { RED: 'fails the check it adds\n' } : {}),
      });
      fixture.agentWorktree('agent/c', { 'docs/c.md': '# C\n' });
      const log = fixture.at('pnpm.log');
      const before = fixture.originMaster();
      const landed = await finished(
        fixture.land(
          fixture.main,
          ['--train', 'agent/a', 'agent/policy', 'agent/c'],
          {
            ...QUIET,
            FIXTURE_FAILS: 'fixture:added=RED',
            FIXTURE_PNPM_LOG: log,
          }
        )
      );
      if (!red) {
        assert.equal(landed.code, 0, landed.output);
        assert.equal(runs(log, 'run fixture:added'), 1, landed.output);
        continue;
      }
      assertNothingLanded(fixture, before, landed);
      assert.match(
        landed.output,
        /TRAIN red: agent\/policy broke fixture:added; agent\/a passed without it\. The other cars do not owe fixture:added without it\./u
      );
      assert.match(
        landed.output,
        /train bisect: agent\/a does not owe fixture:added/u
      );
    } finally {
      fixture.cleanup();
    }
  }
});

test('a car whose delivery policy does not load is the car the train names', async () => {
  const fixture = createQueueFixture('exawatt-train-broken-policy-');
  try {
    fixture.agentWorktree('agent/a', { 'docs/a.md': '# A\n' });
    fixture.agentWorktree('agent/broken', {
      [TREE_POLICY_FILE]: fixture.policyWith(
        "\nthrow new Error('fixture: this policy does not load');\n"
      ),
    });
    fixture.agentWorktree('agent/c', { 'docs/c.md': '# C\n' });
    const log = fixture.at('pnpm.log');
    const before = fixture.originMaster();
    const landed = await finished(
      fixture.land(
        fixture.main,
        ['--train', 'agent/a', 'agent/broken', 'agent/c'],
        { ...QUIET, FIXTURE_PNPM_LOG: log }
      )
    );
    assertNothingLanded(fixture, before, landed);
    assert.match(
      landed.output,
      /TRAIN red: agent\/broken broke delivery-policy; agent\/a passed without it\. The other cars pass delivery-policy without it\./u
    );
    assert.match(
      landed.output,
      /delivery-policy: scripts\/lib\/delivery-policy\.mjs of tree [0-9a-f]{12} did not load: Error: fixture: this policy does not load/u
    );
    assert.match(
      landed.output,
      /STATUS failed=train guilty=agent\/broken check=delivery-policy passed=agent\/a rest=passed/u
    );
    // A tree whose policy cannot answer owes nothing it can name, so no
    // check ran on any stack.
    assert.deepEqual(scriptRuns(log), {}, landed.output);
    const failed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'landing_check' && event.status === 'failed'
    );
    assert.ok(failed.length > 0);
    assert.ok(failed.every(event => event.id === 'delivery-policy'));
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
        { ...QUIET, FIXTURE_FAILS: 'lint=RED' }
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
    // agent/b is the last car, guilty because both prefixes before it
    // passed; that elimination stands on the full stack failing lint twice.
    assert.match(landed.output, /failed lint twice/u);
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
