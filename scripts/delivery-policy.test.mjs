import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  classifyDeliveryPolicy,
  missingSurfaceGates,
  quarantinedSurfaceGates,
  surfaceGateMessage,
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
    JSON.parse(
      readFileSync(path.join(root, 'package.json'), 'utf8')
    ).scripts['verify:community-build'],
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
