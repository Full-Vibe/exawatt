import assert from 'node:assert/strict';
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
    'content:scan',
    'type-check',
    'test:agent-delivery',
  ]);
  assert.deepEqual(ids(['src/lib/raw-tokens.ts'], ['lint']), [
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'lint',
  ]);
});

test('content scanning runs first on the sorted, unique candidate paths', () => {
  const [check] = classifyDeliveryPolicy(['src/z.ts', 'docs/a.md', 'src/z.ts']);
  assert.deepEqual(check, {
    id: 'content:scan',
    command: 'pnpm',
    args: ['run', 'content:scan', '--', 'docs/a.md', 'src/z.ts'],
  });
});

test('provider composition changes receive related consumer tests', () => {
  const checks = classifyDeliveryPolicy(['src/components/ExposeOverlay.tsx']);
  assert.deepEqual(
    checks.map(check => check.id),
    ['content:scan', 'type-check', 'test:agent-delivery', 'vitest-related']
  );
  assert.deepEqual(checks.at(-1).args, [
    'run',
    'test:related',
    'src/components/ExposeOverlay.tsx',
  ]);
});

test('dogfood and Electron orchestration changes receive Electron compilation', () => {
  assert.deepEqual(ids(['scripts/install-dogfood.mjs']), [
    'content:scan',
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'electron:compile',
  ]);
});

test('roadmap corpus changes receive the canonical parser contract', () => {
  assert.deepEqual(ids(['docs/engineering/roadmap.md']), [
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

test('post-merge CI cancels obsolete runs on the same ref', async () => {
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
  assert.deepEqual(missing.map(entry => entry.gate).sort(), [
    'eval:workspace:launcher',
    'eval:workspace:ribbon:bench',
  ]);
});

// Quarantine is the mechanism for a gate whose own script is red. Both of the
// first two were repaired the same week they were found, so nothing is
// quarantined today — the rule stays tested so the next red gate is announced
// rather than deleted.
test('a repaired gate is enforced again, not quarantined', () => {
  const files = ['src/components/nav/nav-history.ts'];
  assert.deepEqual(
    missingSurfaceGates(files).map(entry => entry.gate),
    ['eval:navigation']
  );
  assert.deepEqual(quarantinedSurfaceGates(files), []);
});

test('quarantine says nothing about an untouched surface', () => {
  assert.deepEqual(quarantinedSurfaceGates(['docs/engineering/roadmap.md']), []);
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
