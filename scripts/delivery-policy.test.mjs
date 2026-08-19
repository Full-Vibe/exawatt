import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyDeliveryPolicy,
  failedVitestFiles,
  inconclusiveRerunReport,
  missingSurfaceGates,
  quarantinedSurfaceGates,
  reproducedFailureReport,
  rerunTooWideReport,
  rerunVerdict,
  runDeliveryChecks,
  suspectedFlakeReport,
  surfaceGateMessage,
  unnamedFailureReport,
  vitestReportArgs,
} from './lib/delivery-policy.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function ids(paths, extras = []) {
  return classifyDeliveryPolicy(paths, extras).map(check => check.id);
}

test('the cheap changed-file floor cannot be weakened by the caller', () => {
  assert.deepEqual(ids(['docs/product/concepts.md']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
  ]);
  assert.deepEqual(ids(['src/lib/raw-tokens.ts'], ['lint']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'lint',
  ]);

  const duplicateContentScan = classifyDeliveryPolicy(
    ['src/z.ts', 'docs/a.md'],
    ['content:scan']
  ).find(check => check.id === 'content:scan');
  assert.deepEqual(duplicateContentScan.args, [
    'run',
    'content:scan',
    '--',
    'docs/a.md',
    'src/z.ts',
  ]);
});

test('path classification runs before content scanning on sorted candidate paths', () => {
  const [classification, scan] = classifyDeliveryPolicy([
    'src/z.ts',
    'docs/a.md',
    'src/z.ts',
  ]);
  assert.deepEqual(classification, {
    id: 'open-source:paths:check',
    command: 'pnpm',
    args: ['run', 'open-source:paths:check'],
  });
  assert.deepEqual(scan, {
    id: 'content:scan',
    command: 'pnpm',
    args: ['run', 'content:scan', '--', 'docs/a.md', 'src/z.ts'],
  });
});

test('provider composition changes receive related consumer tests', () => {
  const checks = classifyDeliveryPolicy(['src/components/ExposeOverlay.tsx']);
  assert.deepEqual(
    checks.map(check => check.id),
    [
      'open-source:paths:check',
      'content:scan',
      'type-check',
      'test:agent-delivery',
      'vitest-related',
    ]
  );
  assert.deepEqual(checks.at(-1).args, [
    'run',
    'test:related',
    'src/components/ExposeOverlay.tsx',
  ]);
});

test('dogfood and Electron orchestration changes receive Electron compilation', () => {
  assert.deepEqual(ids(['scripts/install-dogfood.mjs']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'electron:compile',
  ]);
});

// BUG-042: a route that demanded the account service while Next prerendered
// it failed every build path, and no unattended check ever ran a build under
// the DEFAULT community contract.
test('routable and distribution-seam changes receive the community build', () => {
  assert.deepEqual(ids(['src/app/admin/invites/page.tsx']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'verify:community-build',
    'verify:community-runtime',
  ]);
  assert.deepEqual(ids(['scripts/lib/distribution-build.mjs']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'verify:community-build',
  ]);
  for (const file of [
    'src/lib/supabase/server.ts',
    'src/lib/distribution/resolved.ts',
    'packages/core/src/distribution/contract.ts',
    'next.config.ts',
    'scripts/prepare-distribution.mjs',
    'scripts/run-next-with-distribution.mjs',
  ]) {
    assert.ok(
      ids([file]).includes('verify:community-build'),
      `${file} owes the community build`
    );
  }
  // The check must unset an ambient contract, or an agent shell that exported
  // one proves the official build instead of the default one.
  assert.match(
    JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts[
      'verify:community-build'
    ],
    /^env -u EXAWATT_DISTRIBUTION_CONFIG_JSON /
  );
});

// BUG-044: the same defect at REQUEST time. A green build still 500s if a
// server action or route handler demands the account capability, so the
// runtime entrypoints owe a check the build cannot stand in for.
test('request-time entrypoints receive the community runtime check', () => {
  for (const file of [
    'src/app/actions/preferences.ts',
    'src/app/api/oc/token/route.ts',
    'src/app/auth/callback/route.ts',
    'src/lib/supabase/server.ts',
    'src/lib/shortcuts/preference-source.ts',
    'src/lib/distribution/resolved.ts',
    'packages/core/src/distribution/contract.ts',
    'scripts/distribution.official.example.json',
  ]) {
    assert.ok(
      ids([file]).includes('verify:community-runtime'),
      `${file} owes the community runtime check`
    );
  }
  // A shortcut-store edit must not drag in a full `next build`.
  assert.ok(
    !ids(['src/lib/shortcuts/preference-source.ts']).includes(
      'verify:community-build'
    ),
    'the runtime check is separate from the build check on purpose'
  );
});

test('roadmap corpus changes receive the canonical parser contract', () => {
  assert.deepEqual(ids(['docs/engineering/roadmap.md']), [
    'open-source:paths:check',
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'roadmap-contract',
  ]);
});

test('conditional Electron, browser, R3F, CI, and delivery checks compose', () => {
  const checks = classifyDeliveryPolicy([
    '.github/workflows/ci.yml',
    'electron/main/main.ts',
    'scripts/qa-browser-smoke.mjs',
    'src/components/fleet/spatial/FleetCanvas.tsx',
  ]);
  assert.deepEqual(
    checks.map(check => check.id),
    [
      'open-source:paths:check',
      'content:scan',
      'type-check',
      'test:agent-delivery',
      'vitest-related',
      'electron:compile',
      'qa:browser:doctor',
      'eval:r3f',
    ]
  );
  assert.equal(checks.at(-1).candidateOnly, undefined);
});

test('post-merge CI runs only from the coalesced batch ref and cancels an obsolete batch', async () => {
  const workflow = await readFile(
    path.join(root, '.github/workflows/ci.yml'),
    'utf8'
  );
  assert.match(workflow, /concurrency:/);
  assert.match(
    workflow,
    /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(workflow, /branches: \[ci-batches\/master\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /push:\s+branches: \[master, main\]/);
  assert.match(
    workflow,
    /name: Check open-source path classification\s+run: pnpm open-source:paths:check/
  );

  // ENG-030 WP5a: a fork receives no repository secrets, so the run a
  // contributor gets and the run we get have to be the same run. The deeper
  // workflow properties are asserted in `github-workflows.test.mjs`; these
  // three stay here because this file is what an agent edits when it changes
  // CI, and losing them silently is the failure worth catching at the door.
  assert.doesNotMatch(workflow, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(workflow, /^\s*pull_request_target:/m);
  assert.match(
    workflow,
    /name: Compile Electron main\s+run: pnpm electron:compile/
  );
});

// ── Surface gates (D51). The repository owns 31 eval gates and the floor
// routed to one; the rest were opt-in, so a change to the most
// motion-sensitive surface in the app could land with nothing run.
test('a gated surface owes its gate', () => {
  const missing = missingSurfaceGates([
    'src/components/workspace/tab-strip.tsx',
    'docs/engineering/roadmap.md',
  ]);
  assert.deepEqual(
    missing.map(entry => entry.gate),
    ['eval:workspace:ribbon:bench']
  );
  assert.deepEqual(missing[0].paths, [
    'src/components/workspace/tab-strip.tsx',
  ]);
});

test('declaring the gate through --verify satisfies it', () => {
  assert.deepEqual(
    missingSurfaceGates(
      ['src/components/workspace/tab-strip.tsx'],
      ['eval:workspace:ribbon:bench']
    ),
    []
  );
});

test('a deliberate waiver satisfies it too, and is the caller saying so', () => {
  assert.deepEqual(
    missingSurfaceGates(
      ['src/components/workspace/project-ribbon-layout.ts'],
      ['eval:workspace:ribbon:bench']
    ),
    []
  );
});

test('the Team altitude owes its ordering gate', () => {
  assert.deepEqual(
    missingSurfaceGates(['src/components/workspace/expose-overlay.tsx']).map(
      entry => entry.gate
    ),
    ['eval:workspace:team']
  );
  assert.deepEqual(
    missingSurfaceGates(['src/components/workspace/use-flip-tiles.ts']).map(
      entry => entry.gate
    ),
    ['eval:workspace:team']
  );
});

test('the shared menu primitive owes the launcher gate', () => {
  assert.deepEqual(
    missingSurfaceGates(['src/components/ui/option-menu.tsx']).map(
      entry => entry.gate
    ),
    ['eval:workspace:launcher']
  );
});

// BUG-036: a dependency bump that touched no Electron, renderer or UI path
// shipped a packaged renderer that exited 1 on its first require. A lockfile is
// a first-class trigger for the one oracle that runs the real thing.
test('a lockfile change owes the packaged gate', () => {
  assert.deepEqual(
    missingSurfaceGates(['pnpm-lock.yaml']).map(entry => entry.gate),
    ['eval:electron:packaged']
  );
});

test('the renderer payload and its seal owe the packaged gate', () => {
  for (const file of [
    'next.config.ts',
    'scripts/prepare-electron-renderer.mjs',
    'scripts/lib/renderer-archive.mjs',
  ]) {
    assert.deepEqual(
      missingSurfaceGates([file]).map(entry => entry.gate),
      ['eval:electron:packaged'],
      file
    );
  }
});

test('ungated paths owe nothing', () => {
  assert.deepEqual(missingSurfaceGates(['docs/engineering/roadmap.md']), []);
  assert.deepEqual(missingSurfaceGates(['src/lib/shortcuts/format.ts']), []);
});

test('several gated surfaces in one change owe each gate once', () => {
  const missing = missingSurfaceGates([
    'src/components/workspace/tab-strip.tsx',
    'src/components/workspace/project-ribbon-motion.ts',
    'src/components/workspace/launcher/agent-launcher.tsx',
  ]);
  // The launcher owes FOUR gates since BUG-041 lifted the quarantine on the
  // two Electron ones. That is the point of the row: a quarantined gate is a
  // surface with less evidence than it looks, and `agent-launcher.tsx` had
  // exactly that until the drawer stopped closing on its own first axis.
  assert.deepEqual(missing.map(entry => entry.gate).sort(), [
    'eval:electron:idempotency',
    'eval:electron:lifecycle',
    'eval:workspace:launcher',
    'eval:workspace:ribbon:bench',
  ]);
});

// Quarantine is the mechanism for a gate whose own script is red. Every one so
// far has been repaired within days of being found — BUG-041 took the last two
// out — so nothing is quarantined today. The rule stays tested so the next red
// gate is announced rather than deleted.
test('a repaired gate is enforced again, not quarantined', () => {
  const files = ['src/components/nav/nav-history.ts'];
  // BUG-035: the back stack owes BOTH. `eval:navigation` walks the altitude
  // continuum; only the spine eval presses ⌘[ and ⌘] against a real router
  // round trip, which is the contract this file owns and the one it broke.
  assert.deepEqual(
    missingSurfaceGates(files).map(entry => entry.gate),
    ['eval:navigation', 'eval:navigation:spine']
  );
  assert.deepEqual(quarantinedSurfaceGates(files), []);
});

test('quarantine says nothing about an untouched surface', () => {
  assert.deepEqual(
    quarantinedSurfaceGates(['docs/engineering/roadmap.md']),
    []
  );
});

test('the refusal names the gate, the files, and how to run it', () => {
  const message = surfaceGateMessage(
    missingSurfaceGates(['src/components/workspace/tab-strip.tsx'])
  );
  assert.match(message, /eval:workspace:ribbon:bench/);
  assert.match(message, /tab-strip\.tsx/);
  assert.match(message, /EXA_BASE=http:\/\/localhost:<port> pnpm agent:land/);
  assert.match(message, /--waive-gate/);
});

// ── Flake-aware reruns (BUG-090). A change to a module the whole app imports
// selected a large `app-dom` set whose tests failed by TIMEOUT under machine
// load, with different identities on every run, and the floor reported them as
// named test failures — which reads as "your change broke these". The floor now
// automates the diagnostic the runbook already prescribed: re-run the named
// files alone, once.

test('the vitest checks declare the isolated rerun; the others do not', () => {
  const related = classifyDeliveryPolicy(['src/lib/raw-tokens.ts']).find(
    check => check.id === 'vitest-related'
  );
  assert.deepEqual(related.rerun, { kind: 'vitest', script: 'test:alone' });
  const roadmap = classifyDeliveryPolicy(['docs/engineering/roadmap.md']).find(
    check => check.id === 'roadmap-contract'
  );
  assert.deepEqual(roadmap.rerun, { kind: 'vitest', script: 'test:alone' });
  for (const id of ['type-check', 'content:scan', 'test:agent-delivery']) {
    assert.equal(
      classifyDeliveryPolicy(['src/lib/raw-tokens.ts']).find(
        check => check.id === id
      ).rerun,
      undefined,
      `${id} is not a vitest selection`
    );
  }
  // The rerun script must exist, or the floor's own repair is a broken command.
  assert.equal(
    typeof JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
      .scripts['test:alone'],
    'string'
  );
});

test('the rerun runs the named files alone, and raises no timeout to do it', () => {
  const alone = JSON.parse(
    readFileSync(path.join(root, 'package.json'), 'utf8')
  ).scripts['test:alone'];
  assert.match(alone, /vitest run/);
  assert.match(alone, /--maxWorkers=1/);
  // Decision `0030` keeps the suite bounded rather than masking contention.
  assert.doesNotMatch(alone, /testTimeout|--test-timeout/);
});

test('the machine channel is the JSON reporter, never the human one', () => {
  assert.deepEqual(vitestReportArgs('/tmp/report.json'), [
    '--reporter=default',
    '--reporter=json',
    '--outputFile.json=/tmp/report.json',
  ]);
});

test('a vitest report names the failing files and the tests inside them', () => {
  const failures = failedVitestFiles(
    {
      testResults: [
        {
          name: '/repo/src/z.test.tsx',
          status: 'failed',
          assertionResults: [
            { status: 'failed', fullName: 'z > times out' },
            { status: 'passed', fullName: 'z > fine' },
          ],
        },
        {
          name: '/repo/src/a.test.tsx',
          status: 'failed',
          assertionResults: [{ status: 'failed', fullName: 'a > breaks' }],
        },
        { name: '/repo/src/ok.test.tsx', status: 'passed' },
      ],
    },
    '/repo'
  );
  assert.deepEqual(failures, [
    { file: 'src/a.test.tsx', tests: ['a > breaks'] },
    { file: 'src/z.test.tsx', tests: ['z > times out'] },
  ]);
  assert.deepEqual(failedVitestFiles(null, '/repo'), []);
});

test('the rerun verdict separates what reproduced from what did not', () => {
  const requested = [
    { file: 'src/a.test.tsx', tests: ['a > breaks'] },
    { file: 'src/b.test.tsx', tests: ['b > times out'] },
  ];
  const covered = [
    {
      name: '/repo/src/a.test.tsx',
      status: 'failed',
      assertionResults: [{ status: 'failed', fullName: 'a > breaks' }],
    },
    { name: '/repo/src/b.test.tsx', status: 'passed', assertionResults: [] },
  ];

  assert.deepEqual(
    rerunVerdict({
      requested,
      report: {
        testResults: covered.map(entry => ({
          ...entry,
          status: 'passed',
          assertionResults: [],
        })),
      },
      root: '/repo',
    }),
    { status: 'flake', flaked: requested }
  );

  const reproduced = rerunVerdict({
    requested,
    report: { testResults: covered },
    root: '/repo',
  });
  assert.equal(reproduced.status, 'reproduced');
  assert.deepEqual(
    reproduced.reproduced.map(entry => entry.file),
    ['src/a.test.tsx']
  );
  assert.deepEqual(
    reproduced.flaked.map(entry => entry.file),
    ['src/b.test.tsx']
  );

  // A rerun that matched nothing settles nothing. Reading it as a pass is how
  // a real break would be laundered into a flake.
  assert.deepEqual(
    rerunVerdict({ requested, report: { testResults: [] }, root: '/repo' }),
    { status: 'inconclusive', notRun: ['src/a.test.tsx', 'src/b.test.tsx'] }
  );
  assert.equal(
    rerunVerdict({ requested, report: null, root: '/repo' }).status,
    'inconclusive'
  );
});

test('the reports name the files, the load average, and which half is real', () => {
  const flaked = [{ file: 'src/b.test.tsx', tests: ['b > times out'] }];
  const suspected = suspectedFlakeReport({
    checkId: 'vitest-related',
    flaked,
    load: { atFailure: 152.3, atRerun: 148.1 },
  });
  assert.match(suspected, /SUSPECTED FLAKE/);
  assert.match(suspected, /passed when re-run alone/);
  assert.match(suspected, /src\/b\.test\.tsx/);
  assert.match(suspected, /b > times out/);
  assert.match(suspected, /load average 152\.30 at the failure/);
  assert.match(suspected, /the floor continues/);

  const reproduced = reproducedFailureReport({
    checkId: 'vitest-related',
    reproduced: [{ file: 'src/a.test.tsx', tests: ['a > breaks'] }],
    flaked,
    load: { atFailure: 9, atRerun: 8 },
  });
  assert.match(reproduced, /failed AGAIN when re-run alone/);
  assert.match(reproduced, /src\/a\.test\.tsx/);
  assert.match(reproduced, /suspected flakes/);
  assert.match(reproduced, /src\/b\.test\.tsx/);

  assert.match(
    inconclusiveRerunReport({
      checkId: 'vitest-related',
      notRun: ['src/a.test.tsx'],
    }),
    /never ran 1 of the file\(s\)/
  );
  // The FIRST intermittent: a non-zero exit naming nothing is a dead worker,
  // and saying so is the whole diagnosis.
  assert.match(unnamedFailureReport('vitest-related'), /dead worker/);
  assert.match(
    rerunTooWideReport('vitest-related', new Array(40).fill({ file: 'x' })),
    /more than the 25/
  );
});

/**
 * A stand-in for `pnpm` that reports whatever the scenario says, through the
 * same JSON reporter contract the real one writes. It records every
 * invocation, so a test can prove what the floor re-ran — and prove that it
 * did not re-run anything when it must not.
 */
async function writeVitestStub(directory, runs) {
  const stub = path.join(directory, 'pnpm');
  await writeFile(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs');
const nodePath = require('node:path');
const runs = ${JSON.stringify(runs)};
const root = ${JSON.stringify(directory)};
const logPath = nodePath.join(root, 'invocations.json');
const log = fs.existsSync(logPath)
  ? JSON.parse(fs.readFileSync(logPath, 'utf8'))
  : [];
const plan = runs[Math.min(log.length, runs.length - 1)];
log.push(process.argv.slice(2));
fs.writeFileSync(logPath, JSON.stringify(log));
const flag = process.argv.slice(2).find(a => a.startsWith('--outputFile.json='));
if (flag && plan.report !== false) {
  const testResults = [
    ...(plan.failed || []).map(entry => ({
      name: nodePath.join(root, entry[0]),
      status: 'failed',
      assertionResults: entry[1].map(fullName => ({ status: 'failed', fullName })),
    })),
    ...(plan.passed || []).map(file => ({
      name: nodePath.join(root, file),
      status: 'passed',
      assertionResults: [],
    })),
  ];
  fs.writeFileSync(
    flag.slice('--outputFile.json='.length),
    JSON.stringify({ success: plan.exit === 0, testResults })
  );
}
process.exit(plan.exit);
`
  );
  await chmod(stub, 0o755);
  return stub;
}

async function invocationsOf(directory) {
  return JSON.parse(
    await readFile(path.join(directory, 'invocations.json'), 'utf8')
  );
}

function vitestCheck(stub) {
  return {
    id: 'vitest-related',
    command: stub,
    args: ['run', 'test:related', 'src/lib/widely-imported.ts'],
    rerun: { kind: 'vitest', script: 'test:alone' },
  };
}

async function scenario(runs, body) {
  const directory = await realpath(
    await mkdtemp(path.join(tmpdir(), 'exawatt-flake-'))
  );
  try {
    await body(directory, await writeVitestStub(directory, runs));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('named failures that pass alone become a reported flake, and the floor continues', async () => {
  await scenario(
    [
      {
        exit: 1,
        failed: [
          ['src/a.test.tsx', ['a > times out']],
          ['src/b.test.tsx', ['b > times out']],
        ],
      },
      { exit: 0, passed: ['src/a.test.tsx', 'src/b.test.tsx'] },
    ],
    async (directory, stub) => {
      const recorded = [];
      const evidence = await runDeliveryChecks(directory, [vitestCheck(stub)], {
        onResult: result => recorded.push(result),
      });

      assert.equal(evidence.length, 1);
      assert.equal(evidence[0].status, 'flaked');
      assert.deepEqual(
        evidence[0].flakedFiles.map(entry => entry.file),
        ['src/a.test.tsx', 'src/b.test.tsx']
      );
      assert.deepEqual(evidence[0].flakedFiles[0].tests, ['a > times out']);
      assert.equal(typeof evidence[0].loadAverageAtFailure, 'number');
      // The evidence reaches the ticket and the metric stream, so a landing
      // that had to re-run can never look unconditionally clean.
      assert.equal(recorded[0].status, 'flaked');

      const invocations = await invocationsOf(directory);
      assert.equal(invocations.length, 2);
      assert.deepEqual(invocations[0].slice(0, 3), [
        'run',
        'test:related',
        'src/lib/widely-imported.ts',
      ]);
      assert.deepEqual(invocations[1].slice(0, 4), [
        'run',
        'test:alone',
        'src/a.test.tsx',
        'src/b.test.tsx',
      ]);
    }
  );
});

test('a failure that survives isolation still fails the floor, and says which half is real', async () => {
  await scenario(
    [
      {
        exit: 1,
        failed: [
          ['src/broken.test.tsx', ['broken > asserts']],
          ['src/slow.test.tsx', ['slow > times out']],
        ],
      },
      {
        exit: 1,
        failed: [['src/broken.test.tsx', ['broken > asserts']]],
        passed: ['src/slow.test.tsx'],
      },
    ],
    async (directory, stub) => {
      const recorded = [];
      await assert.rejects(
        () =>
          runDeliveryChecks(directory, [vitestCheck(stub)], {
            onResult: result => recorded.push(result),
          }),
        error => {
          assert.match(error.message, /failed AGAIN when re-run alone/);
          assert.match(error.message, /src\/broken\.test\.tsx/);
          assert.match(error.message, /suspected flakes/);
          assert.match(error.message, /src\/slow\.test\.tsx/);
          return true;
        }
      );
      // The failure is recorded with both halves separated, so the metric
      // stream can tell a defect from the contention it travelled with.
      assert.equal(recorded[0].status, 'failed');
      assert.deepEqual(
        recorded[0].reproducedFiles.map(entry => entry.file),
        ['src/broken.test.tsx']
      );
      assert.deepEqual(
        recorded[0].flakedFiles.map(entry => entry.file),
        ['src/slow.test.tsx']
      );
    }
  );
});

test('a rerun that ran nothing is inconclusive, so the original failure stands', async () => {
  await scenario(
    [
      { exit: 1, failed: [['src/a.test.tsx', ['a > times out']]] },
      { exit: 0, passed: [] },
    ],
    async (directory, stub) => {
      await assert.rejects(
        () => runDeliveryChecks(directory, [vitestCheck(stub)]),
        /never ran 1 of the file\(s\) it named/
      );
    }
  );
});

test('a failure that names nothing is not re-run; it is a dead worker', async () => {
  await scenario([{ exit: 1, report: false }], async (directory, stub) => {
    await assert.rejects(
      () => runDeliveryChecks(directory, [vitestCheck(stub)]),
      /named no failing test file/
    );
    assert.equal((await invocationsOf(directory)).length, 1);
  });
});

test('a wide failure is a break, not contention, so nothing is re-run', async () => {
  const failed = Array.from({ length: 26 }, (_, index) => [
    `src/file-${index}.test.tsx`,
    ['broke'],
  ]);
  await scenario([{ exit: 1, failed }], async (directory, stub) => {
    await assert.rejects(
      () => runDeliveryChecks(directory, [vitestCheck(stub)]),
      /more than the 25 a targeted rerun covers/
    );
    assert.equal((await invocationsOf(directory)).length, 1);
  });
});

test('a passing check and a non-vitest failure behave exactly as before', async () => {
  await scenario(
    [{ exit: 0, passed: ['src/a.test.tsx'] }],
    async (directory, stub) => {
      const evidence = await runDeliveryChecks(directory, [vitestCheck(stub)]);
      assert.equal(evidence[0].status, 'passed');
      assert.equal(evidence[0].flakedFiles, undefined);
      assert.equal((await invocationsOf(directory)).length, 1);
    }
  );

  await scenario([{ exit: 1 }], async (directory, stub) => {
    await assert.rejects(
      () =>
        runDeliveryChecks(directory, [
          { id: 'type-check', command: stub, args: ['run', 'type-check'] },
        ]),
      new RegExp(`run type-check exited 1`)
    );
  });
});
