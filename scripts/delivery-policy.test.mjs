import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

import { parse as parseYaml } from 'yaml';

import {
  classifyDeliveryPolicy,
  failedVitestFiles,
  inconclusiveRerunReport,
  isVerificationScript,
  missingSurfaceGates,
  quarantinedSurfaceGates,
  reproducedFailureReport,
  rerunTooWideReport,
  rerunVerdict,
  runDeliveryChecks,
  SURFACE_GATES,
  suspectedFlakeReport,
  surfaceGateMessage,
  unnamedFailureReport,
  VERIFICATION_ROUTES,
  vitestReportArgs,
} from './lib/delivery-policy.mjs';
import { git } from './lib/hermetic-git.mjs';
import { PUBLICATION_GATES } from './publication-check.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function isProjectedPublicTree() {
  const disposition = JSON.parse(
    await readFile(
      path.join(root, 'scripts/open-source-paths.manifest.json'),
      'utf8'
    )
  );
  return Object.keys(disposition.recipes ?? {}).length === 0;
}

function ids(paths, extras = []) {
  return classifyDeliveryPolicy(paths, extras).map(check => check.id);
}

test('the cheap changed-file floor cannot be weakened by the caller', () => {
  assert.deepEqual(ids(['docs/product/concepts.md']), [
    'open-source:paths:check',
    'content:scan',
    'lint',
    'type-check',
    'test:agent-delivery',
  ]);
  assert.deepEqual(ids(['src/lib/raw-tokens.ts'], ['test:fonts']), [
    'open-source:paths:check',
    'content:scan',
    'lint',
    'type-check',
    'test:agent-delivery',
    'exports:check',
    'vitest-related',
    'copy:check',
    'theme:check',
    'stale-async-ratchet',
    'test:fonts',
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
      'lint',
      'type-check',
      'test:agent-delivery',
      'exports:check',
      'vitest-related',
      'copy:check',
      'theme:check',
      'stale-async-ratchet',
    ]
  );
  assert.deepEqual(
    checks.find(check => check.id === 'vitest-related').args,
    ['run', 'test:related', 'src/components/ExposeOverlay.tsx']
  );
});

// BUG-206/BUG-207: whole-tree renderer guards import nothing they check, so
// the related-test selection can never pick them and they must be routed.
test('renderer changes run the screen-copy guard and the stale-async ratchet', () => {
  for (const file of [
    'src/components/workspace/close-confirm.tsx',
    'src/lib/hosted-features/contract.ts',
  ]) {
    const routed = ids([file]);
    assert.ok(routed.includes('copy:check'), `${file} owes copy:check`);
    assert.ok(
      routed.includes('stale-async-ratchet'),
      `${file} owes the stale-async ratchet`
    );
  }
  for (const file of [
    'packages/ui-model/src/roadmap-strip.ts',
    'company/overlay/web/src/app/admin/invites/issue-invite-form.tsx',
    'scripts/check-screen-copy.mjs',
  ]) {
    const routed = ids([file]);
    assert.ok(routed.includes('copy:check'), `${file} owes copy:check`);
    assert.ok(
      !routed.includes('stale-async-ratchet'),
      `${file} is outside the ratchet's tree`
    );
  }
  for (const file of ['docs/engineering/design-system.md', 'electron/main/main.ts']) {
    const routed = ids([file]);
    assert.ok(!routed.includes('copy:check'), `${file} renders no screen copy`);
    assert.ok(!routed.includes('stale-async-ratchet'));
  }
});

// BUG-208: the theme gate was repaired on 2026-08-17 and red again the next
// day because nothing ran it. Anything that paints, or decides paint, owes it.
test('theme, generator, ratchet and renderer changes run theme:check', () => {
  for (const file of [
    'src/components/status-light/protocol.ts',
    'src/app/page.tsx',
    'themes/v1/exawatt-air-light.json',
    'themes/contract.mjs',
    'packages/ui-model/src/roadmap-strip.ts',
    'scripts/generate-themes.mjs',
    'scripts/check-production-theme-literals.mjs',
  ]) {
    assert.ok(ids([file]).includes('theme:check'), `${file} owes theme:check`);
  }
  for (const file of [
    'docs/engineering/design-system.md',
    'electron/main/main.ts',
  ]) {
    assert.ok(!ids([file]).includes('theme:check'), `${file} paints nothing`);
  }
});

test('dogfood and Electron orchestration changes receive Electron compilation', () => {
  assert.deepEqual(ids(['scripts/install-dogfood.mjs']), [
    'open-source:paths:check',
    'content:scan',
    'lint',
    'type-check',
    'test:agent-delivery',
    'exports:check',
    'vitest-related',
    'electron:compile',
  ]);
});

test('every compatible-service wire owner receives executable conformance', () => {
  for (const file of [
    'contracts/conformance/cases.json',
    'contracts/services/v1/schemas/problem.schema.json',
    'packages/core/src/distribution/service-clients.ts',
    'packages/core/src/distribution/service-protocol.ts',
    'packages/core/src/service-protocol.ts',
    'electron/main/pty/context-summarizer.ts',
    'electron/main/pty/conversation-catalog.ts',
    'src/components/feedback/product-feedback-provider.tsx',
    'src/lib/operator-stats/auto-sync.ts',
    'company/overlay/web/src/app/api/goal-visuals/route.ts',
    'company/overlay/web/src/app/api/conversations/summarize/route.ts',
    'company/overlay/web/src/app/api/conversations/summarize/service-conformance.test.ts',
    'company/overlay/web/src/app/api/service-conformance.test.ts',
  ]) {
    assert.ok(
      ids([file]).includes('test:service-conformance'),
      `${file} owes the service conformance matrix`
    );
  }
  assert.ok(
    !ids(['src/lib/raw-tokens.ts']).includes('test:service-conformance'),
    'unrelated application changes do not pay for the service matrix'
  );
});

// BUG-042: a route that demanded the account service while Next prerendered
// it failed every build path, and no unattended check ever ran a build under
// the DEFAULT community contract.
test('routable and distribution-seam changes receive the community build', () => {
  assert.deepEqual(ids(['src/app/admin/invites/page.tsx']), [
    'open-source:paths:check',
    'content:scan',
    'lint',
    'type-check',
    'test:agent-delivery',
    'exports:check',
    'vitest-related',
    'copy:check',
    'theme:check',
    'stale-async-ratchet',
    'verify:community-build',
    'verify:community-runtime',
  ]);
  assert.deepEqual(ids(['scripts/lib/distribution-build.mjs']), [
    'open-source:paths:check',
    'content:scan',
    'lint',
    'type-check',
    'test:agent-delivery',
    'exports:check',
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
    'lint',
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
      'lint',
      'type-check',
      'test:agent-delivery',
      'exports:check',
      'vitest-related',
      'copy:check',
      'theme:check',
      'stale-async-ratchet',
      'electron:compile',
      'qa:browser:doctor',
      'eval:r3f',
    ]
  );
  assert.equal(checks.at(-1).candidateOnly, undefined);
});

test('post-merge CI follows this repository’s delivery topology and cancels obsolete work', async () => {
  const workflow = await readFile(
    path.join(root, '.github/workflows/ci.yml'),
    'utf8'
  );
  const projectedPublicTree = await isProjectedPublicTree();
  assert.match(workflow, /concurrency:/);
  assert.match(
    workflow,
    /group: ci-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}/
  );
  assert.match(workflow, /cancel-in-progress: true/);
  assert.match(workflow, /permissions:\s+contents: read/);
  assert.match(
    workflow,
    projectedPublicTree
      ? /branches: \[master\]/
      : /branches: \[ci-batches\/master\]/
  );
  assert.doesNotMatch(
    workflow,
    projectedPublicTree
      ? /branches: \[ci-batches\/master\]/
      : /^\s*branches: \[master\]$/m
  );
  assert.match(workflow, /workflow_dispatch:/);
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
  // BUG-161: the ribbon owes its bench AND the Project/Agent eval, which
  // drives Project selection and tab close through the same strip.
  assert.deepEqual(
    missing.map(entry => entry.gate),
    ['eval:workspace:ribbon:bench', 'eval:electron:project-agent']
  );
  assert.deepEqual(missing[0].paths, [
    'src/components/workspace/tab-strip.tsx',
  ]);
});

test('shared dropdown changes owe real pointer and keyboard coverage', () => {
  for (const file of [
    'src/components/ui/dropdown-menu.tsx',
    'src/components/nav/site-header-nav.tsx',
    'scripts/lib/account-theme-menu-eval.mjs',
  ]) {
    assert.ok(
      missingSurfaceGates([file]).some(
        entry => entry.gate === 'eval:workspace:chrome'
      )
    );
  }
});

test('declaring the gate through --verify satisfies it', () => {
  assert.deepEqual(
    missingSurfaceGates(
      ['src/components/workspace/tab-strip.tsx'],
      ['eval:workspace:ribbon:bench', 'eval:electron:project-agent']
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
    ['eval:workspace:team', 'eval:electron:connected-fleet']
  );
  assert.deepEqual(
    missingSurfaceGates(['src/components/workspace/use-flip-tiles.ts']).map(
      entry => entry.gate
    ),
    ['eval:workspace:team']
  );
});

test('the workspace state owes the evals that drive it (BUG-220)', () => {
  const owed = file => missingSurfaceGates([file]).map(entry => entry.gate);
  const dir = 'src/components/workspace/workspace-state';
  const modules = readdirSync(path.join(root, dir))
    .filter(name => /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name))
    .map(name => `${dir}/${name}`);
  assert.ok(modules.length > 0);
  // Every module, including one added later, owes the eval that drives them all.
  for (const file of [
    'src/components/workspace/use-workspace-state.ts',
    ...modules,
  ]) {
    assert.ok(
      owed(file).includes('eval:electron:project-agent'),
      `${file} owes eval:electron:project-agent`
    );
  }
  assert.ok(
    owed('src/components/workspace/use-workspace-state.ts').includes(
      'eval:electron:recents'
    )
  );
  assert.ok(
    owed(`${dir}/use-recently-closed.ts`).includes('eval:electron:recents')
  );
  for (const gate of [
    'eval:workspace:split',
    'eval:electron:lifecycle',
    'eval:electron:idempotency',
  ]) {
    assert.ok(owed(`${dir}/layout-restore.ts`).includes(gate), gate);
    assert.ok(owed(`${dir}/use-workspace-hydration.ts`).includes(gate), gate);
  }
  assert.ok(
    owed(`${dir}/use-session-launch.ts`).includes('eval:electron:clone-context')
  );
  for (const gate of [
    'eval:electron:project-pause',
    'eval:electron:model-change',
  ]) {
    assert.ok(owed(`${dir}/use-session-runtime.ts`).includes(gate), gate);
  }
  // A unit test beside the modules changes nothing an eval observes.
  assert.deepEqual(owed(`${dir}/layout-restore.test.ts`), []);
});

test('the packaged customer-hosted fleet owns its end-to-end gate', () => {
  assert.deepEqual(
    missingSurfaceGates(['electron/main/connected-source-runtime.ts']).map(
      entry => entry.gate
    ),
    ['eval:electron:connected-fleet']
  );
  assert.deepEqual(
    missingSurfaceGates([
      'src/components/workspace/remote-agent/remote-agent-surface.tsx',
    ]).map(entry => entry.gate),
    ['eval:electron:connected-fleet']
  );
});

test('Spatial viewport owners require the real-route geometry gate', () => {
  for (const file of [
    'src/app/fleet/spatial/page.tsx',
    'src/components/fleet/spatial/spatial-fleet-client.tsx',
    'src/components/fleet/spatial/spatial-selection-panel.tsx',
    'src/components/nav/site-header-nav.tsx',
    'src/components/fleet/spatial/operations-board/operations-board-surface.tsx',
    'scripts/spatial-viewport-eval.mjs',
  ]) {
    assert.ok(
      missingSurfaceGates([file]).some(
        entry => entry.gate === 'eval:spatial:viewport'
      ),
      file
    );
  }
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
    'eval:electron:project-agent',
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

test('source Settings changes require the repaired source gate', () => {
  for (const file of [
    'src/app/settings/agent-sources-settings.tsx',
    'src/app/settings/connected-sources-section.tsx',
    'src/components/workspace/agent-sources.ts',
  ]) {
    assert.ok(
      missingSurfaceGates([file]).some(
        entry => entry.gate === 'eval:electron:agent-sources'
      )
    );
    assert.deepEqual(quarantinedSurfaceGates([file]), []);
  }
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
  for (const id of ['type-check', 'content:scan', 'lint', 'exports:check', 'test:agent-delivery']) {
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

// BUG-136. The two guard classes were each blind on one side: every
// `scripts/*.test.mjs` pin ran only through `test:agent-delivery` on landing,
// never in CI, so a Dependabot bump could break a release guard with CI
// green; the BUG-057 lint rule ran only in CI, so a landing could reintroduce
// a wall-clock assertion and learn of it at the next batch. Both run on both
// sides now, unconditionally, and this is the pin on both halves.
test('lint and the delivery-script pins run on every landing and in every CI batch', async () => {
  for (const paths of [
    [],
    ['docs/product/concepts.md'],
    ['README.md'],
    ['pnpm-lock.yaml'],
    ['src/lib/x.ts', 'electron/main/y.ts'],
  ]) {
    const checks = ids(paths);
    assert.ok(checks.includes('lint'), `lint owed by ${JSON.stringify(paths)}`);
    assert.ok(
      checks.includes('test:agent-delivery'),
      `test:agent-delivery owed by ${JSON.stringify(paths)}`
    );
  }
  const lint = classifyDeliveryPolicy([]).find(check => check.id === 'lint');
  assert.deepEqual(lint, { id: 'lint', command: 'pnpm', args: ['run', 'lint'] });

  const workflow = await readFile(
    path.join(root, '.github/workflows/ci.yml'),
    'utf8'
  );
  assert.match(workflow, /name: Run linter\s+run: pnpm lint/);
  assert.match(
    workflow,
    /name: Run delivery-script tests\s+run: pnpm test:agent-delivery/
  );
});

// BUG-137. A new export with no consumer is refused at the door; the existing
// 524 are not re-litigated. The check owes exactly the changed source files.
test('changed source files owe the consumer-less export check', () => {
  const checks = classifyDeliveryPolicy(['src/b.ts', 'docs/a.md', 'scripts/c.mjs']);
  const exportsCheck = checks.find(check => check.id === 'exports:check');
  assert.deepEqual(exportsCheck, {
    id: 'exports:check',
    command: 'pnpm',
    args: ['run', 'exports:check', '--', 'scripts/c.mjs', 'src/b.ts'],
  });
  assert.ok(
    checks.findIndex(check => check.id === 'exports:check') <
      checks.findIndex(check => check.id === 'vitest-related'),
    'the cheap check runs before the related suite'
  );
  assert.ok(!ids(['docs/a.md']).includes('exports:check'));
});

// ── Verification routes (BUG-208). `theme:check` was repaired on 2026-08-17
// and red again the next day, and three gates were found red on master in
// one session, each for the same reason: a check existed and nothing ran it.
// `VERIFICATION_ROUTES` names what runs every verification command, and these
// tests hold it to the truth by deriving, from the landing floor, the gate
// map, the pre-push hook and `ci.yml`, what actually runs each one.

function packageScripts() {
  return JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
    .scripts;
}

/** Split a package command into its `&&`-joined steps, each reduced to the
 *  command it runs: environment prefixes and the machine-slot wrapper are
 *  QoS around a step, not the step. */
function commandSteps(body) {
  return body.split(/\s*(?:&&|;)\s*/u).map(step => {
    const tokens = step.trim().split(/\s+/u).filter(Boolean);
    for (;;) {
      if (/^[A-Z][A-Z0-9_]*=/u.test(tokens[0] ?? '')) tokens.shift();
      else if (tokens[0] === 'env') {
        tokens.shift();
        while (tokens[0] === '-u') tokens.splice(0, 2);
      } else if (
        tokens[0] === 'node' &&
        tokens[1] === 'scripts/with-machine-slot.mjs'
      ) {
        tokens.splice(0, tokens.indexOf('--') + 1);
      } else break;
    }
    return tokens;
  });
}

/** What one step is: a call to another package command, a Node test list,
 *  a Vitest run, build setup, or an opaque program only a direct caller can
 *  vouch for. */
function stepKind(tokens, scripts) {
  if (tokens[0] === 'pnpm' && tokens[1] === '--filter')
    return { kind: 'setup' };
  if (tokens[0] === 'pnpm') {
    const name = tokens[1] === 'run' ? tokens[2] : tokens[1];
    if (name in scripts) return { kind: 'call', name };
  }
  if (tokens[0] === 'node' && tokens[1] === '--test') {
    return { kind: 'node-test', files: tokens.slice(2) };
  }
  if (tokens[0] === 'vitest') {
    const config = tokens.find(token => token.startsWith('--config'));
    const files = tokens
      .slice(1)
      .filter(token => /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(token));
    // `vitest related` and `--changed` choose their files at run time, so
    // they are a selection from the suite, never the suite itself.
    const selection =
      tokens[1] === 'related' ||
      tokens.some(token => token.startsWith('--changed'));
    return {
      kind: 'vitest',
      files,
      wholeSuite: files.length === 0 && config === undefined && !selection,
    };
  }
  return { kind: 'opaque' };
}

/** The default Vitest suite as its configs declare it, so "these files run in
 *  CI" is read from the configuration rather than restated here. */
function defaultVitestSuite() {
  const strings = source =>
    [...source.matchAll(/'([^']+)'/gu)].map(match => match[1]);
  const arrayAfter = (source, key) => {
    const start = source.indexOf(`${key}: [`);
    if (start === -1) return [];
    return strings(source.slice(start, source.indexOf(']', start)));
  };
  const globToRegExp = glob =>
    new RegExp(
      `^${glob
        .replace(/[.+^$()|\\]/gu, '\\$&')
        .replace(
          /\{([^}]+)\}/gu,
          (_, list) => `(?:${list.split(',').join('|')})`
        )
        .replace(/\*\*\//gu, '\u0000')
        .replace(/\*\*/gu, '.*')
        .replace(/\*/gu, '[^/]*')
        .replace(/\u0000/gu, '(?:.*/)?')}$`,
      'u'
    );
  const rootConfig = readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
  const projects = arrayAfter(rootConfig, 'projects').map(project => {
    const configPath = path.join(root, project);
    const source = readFileSync(configPath, 'utf8');
    const base = path.relative(root, path.dirname(configPath));
    const scoped = glob => globToRegExp(base ? `${base}/${glob}` : glob);
    return {
      include: arrayAfter(source, 'include').map(scoped),
      exclude: arrayAfter(source, 'exclude').map(scoped),
    };
  });
  assert.ok(projects.length > 0, 'vitest.config.ts declares its projects');
  return file =>
    projects.some(
      project =>
        project.include.some(pattern => pattern.test(file)) &&
        !project.exclude.some(pattern => pattern.test(file))
    );
}

/**
 * Every package command a route runs: the seeds it names, what those call in
 * turn, and every command whose steps are all contained in what already runs
 * (a Node test list inside a larger one, a Vitest subset inside a suite the
 * route runs whole).
 */
function routeReach(seeds, scripts, inSuite) {
  const reached = new Set();
  const visit = name => {
    if (reached.has(name) || !(name in scripts)) return;
    reached.add(name);
    for (const step of commandSteps(scripts[name])) {
      const kind = stepKind(step, scripts);
      if (kind.kind === 'call') visit(kind.name);
    }
  };
  for (const seed of seeds) visit(seed);

  for (let grew = true; grew; ) {
    grew = false;
    const nodeTests = new Set();
    let wholeSuite = false;
    for (const name of reached) {
      for (const step of commandSteps(scripts[name])) {
        const kind = stepKind(step, scripts);
        if (kind.kind === 'node-test')
          kind.files.forEach(file => nodeTests.add(file));
        if (kind.kind === 'vitest' && kind.wholeSuite) wholeSuite = true;
      }
    }
    for (const [name, body] of Object.entries(scripts)) {
      if (reached.has(name)) continue;
      const steps = commandSteps(body)
        .map(step => stepKind(step, scripts))
        .filter(kind => kind.kind !== 'setup');
      const contained =
        steps.length > 0 &&
        steps.every(kind => {
          if (kind.kind === 'call') return reached.has(kind.name);
          if (kind.kind === 'node-test')
            return kind.files.every(file => nodeTests.has(file));
          if (kind.kind === 'vitest')
            return wholeSuite && kind.files.every(inSuite);
          return false;
        });
      if (contained) {
        reached.add(name);
        grew = true;
      }
    }
  }
  return reached;
}

async function actualRoutes() {
  const scripts = packageScripts();
  const inSuite = defaultVitestSuite();
  const tracked = git(root, ['ls-files']).split('\n').filter(Boolean);

  // (a) The landing floor over every tracked path, which is the union of its
  // unconditional and changed-path checks, plus the pre-push hook every
  // landing's final push passes through.
  const landingSeeds = classifyDeliveryPolicy(tracked)
    .filter(check => check.command === 'pnpm' && check.args[0] === 'run')
    .map(check => check.args[1]);
  const hook = readFileSync(path.join(root, '.githooks/pre-push'), 'utf8');
  for (const [name, body] of Object.entries(scripts)) {
    const entry = /^node (scripts\/[\w./-]+\.mjs)$/u.exec(body)?.[1];
    if (entry && hook.includes(entry)) landingSeeds.push(name);
  }

  // (c) Every `pnpm` step in `ci.yml`, and the gates `publication:check` runs.
  const workflow = parseYaml(
    readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
  );
  const ciSeeds = Object.values(workflow.jobs)
    .flatMap(job => job.steps ?? [])
    .flatMap(step => (step.run ?? '').split('\n'))
    .map(line => /^pnpm (?:run )?([\w:-]+)/u.exec(line.trim())?.[1])
    .filter(Boolean);
  if (ciSeeds.includes('publication:check')) ciSeeds.push(...PUBLICATION_GATES);

  return {
    scripts,
    landing: routeReach(landingSeeds, scripts, inSuite),
    gate: new Set(SURFACE_GATES.map(entry => entry.gate)),
    ci: routeReach(ciSeeds, scripts, inSuite),
    inSuite,
  };
}

test('every verification command has a route (BUG-208)', () => {
  const scripts = packageScripts();
  const unclassified = Object.keys(scripts)
    .filter(isVerificationScript)
    .filter(name => !Object.hasOwn(VERIFICATION_ROUTES, name));
  assert.deepEqual(
    unclassified,
    [],
    'classify each in VERIFICATION_ROUTES (scripts/lib/delivery-policy.mjs): landing, gate, ci, or manual with its reason'
  );
  for (const name of Object.keys(VERIFICATION_ROUTES)) {
    assert.ok(
      isVerificationScript(name),
      `${name} is classified but is not a verification command by name`
    );
  }
});

test('a manual route says why nothing runs it', () => {
  for (const [name, route] of Object.entries(VERIFICATION_ROUTES)) {
    assert.ok(
      ['landing', 'gate', 'ci', 'manual'].includes(route.route),
      `${name} has an unknown route`
    );
    if (route.route !== 'manual') continue;
    assert.ok(
      typeof route.reason === 'string' &&
        route.reason.length >= 12 &&
        !route.reason.includes('\n'),
      `${name} is manual and must state its reason in one line`
    );
  }
});

// The projected public tree omits company-only commands from package.json and
// their tests from its suites, so what a route reaches there is a subset by
// construction. This tree is where the table is maintained and proven.
test('no route names a command that no longer exists', async t => {
  if (await isProjectedPublicTree()) {
    t.skip('the public projection omits company-only commands');
    return;
  }
  const scripts = packageScripts();
  assert.deepEqual(
    Object.keys(VERIFICATION_ROUTES).filter(name => !(name in scripts)),
    [],
    'remove the stale entries from VERIFICATION_ROUTES'
  );
});

test('every route is what actually runs the command', async t => {
  if (await isProjectedPublicTree()) {
    t.skip('the public projection omits company-only commands');
    return;
  }
  const actual = await actualRoutes();
  const wrong = [];
  for (const [name, claimed] of Object.entries(VERIFICATION_ROUTES)) {
    // The first route that runs it is its route: a check the landing floor
    // runs is a landing check even when CI also runs it.
    const truth =
      ['landing', 'gate', 'ci'].find(route => actual[route].has(name)) ??
      'manual';
    if (truth !== claimed.route) {
      wrong.push(`${name}: classified ${claimed.route}, actually ${truth}`);
    }
  }
  assert.deepEqual(wrong, []);
});

test('a Vitest subset names files the default suite runs', async t => {
  if (await isProjectedPublicTree()) {
    t.skip('the public projection omits company-only commands');
    return;
  }
  const { scripts, inSuite } = await actualRoutes();
  for (const [name, body] of Object.entries(scripts)) {
    for (const step of commandSteps(body)) {
      const kind = stepKind(step, scripts);
      if (kind.kind !== 'vitest') continue;
      for (const file of kind.files) {
        assert.ok(
          existsSync(path.join(root, file)),
          `${name} names missing ${file}`
        );
        assert.ok(
          inSuite(file),
          `${name} names ${file}, which no Vitest project includes`
        );
      }
    }
  }
});

test('the route derivation sees what the floor, the hook and CI run', async () => {
  const actual = await actualRoutes();
  // One witness per mechanism, so a derivation that silently stopped seeing
  // one cannot make every route read `manual`.
  assert.ok(actual.landing.has('lint'), 'unconditional floor check');
  assert.ok(actual.landing.has('theme:check'), 'changed-path floor check');
  assert.ok(
    actual.landing.has('type-check:electron-tests'),
    'a call inside a floor check'
  );
  assert.ok(actual.landing.has('docs:check'), 'the pre-push hook');
  assert.ok(
    actual.landing.has('test:screen-copy'),
    'a Node test list inside test:agent-delivery'
  );
  assert.ok(actual.ci.has('test:ci'), 'a ci.yml step');
  assert.ok(actual.ci.has('licenses:check'), 'a gate publication:check runs');
  assert.ok(
    actual.ci.has('test:contracts'),
    'a Vitest subset of the suite CI runs whole'
  );
  assert.ok(
    !actual.landing.has('test:contracts'),
    'a selection is not the whole suite'
  );
});

// BUG-211: a gate's map is written from the surface it is nominally about,
// and its script asserts more than that surface. `nav-history.ts` (BUG-035),
// `workspace-client.tsx` (BUG-041), the ⌘⇧F owners (BUG-058) and the title
// template in `src/app/layout.tsx` each broke a gate that was never asked
// for. Two parts of that are mechanical, so they are held here: a gate owns
// its own script, and a gate owns every repository source file its script
// names, which is how an author records "this step depends on that file".
test('a surface gate owns its script and every source file the script names', () => {
  const scripts = packageScripts();
  for (const entry of SURFACE_GATES) {
    const script = /scripts\/[\w./-]+\.mjs/u.exec(
      scripts[entry.gate] ?? ''
    )?.[0];
    assert.ok(script, `${entry.gate} has a package command that runs a script`);
    assert.ok(
      entry.match(script),
      `${entry.gate} must be owed by a change to ${script}`
    );
    const source = readFileSync(path.join(root, script), 'utf8');
    const named = new Set(
      [
        ...source.matchAll(
          /(?:src|electron|packages|themes)\/[\w./@[\]-]+\.(?:[cm]?[jt]sx?|json|css)/gu
        ),
      ]
        .map(match => match[0])
        // A test file cannot break what the eval observes, so a script that
        // points its reader at one owes nothing for it.
        .filter(file => !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(file))
        .filter(file => existsSync(path.join(root, file)))
    );
    for (const file of named) {
      assert.ok(
        entry.match(file),
        `${script} names ${file}, so ${entry.gate} must be owed by a change to it`
      );
    }
  }
});
