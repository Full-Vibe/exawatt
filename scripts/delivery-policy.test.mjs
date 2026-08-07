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

test('the cheap type floor cannot be weakened by the caller', () => {
  assert.deepEqual(ids(['docs/product/concepts.md']), [
    'type-check',
    'test:agent-delivery',
  ]);
  assert.deepEqual(ids(['src/lib/raw-tokens.ts'], ['lint']), [
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'lint',
  ]);
});

test('provider composition changes receive related consumer tests', () => {
  const checks = classifyDeliveryPolicy(['src/components/ExposeOverlay.tsx']);
  assert.deepEqual(checks.map(check => check.id), [
    'type-check',
    'test:agent-delivery',
    'vitest-related',
  ]);
  assert.deepEqual(checks.at(-1).args, [
    'run',
    'test:related',
    'src/components/ExposeOverlay.tsx',
  ]);
});

test('dogfood and Electron orchestration changes receive Electron compilation', () => {
  assert.deepEqual(ids(['scripts/install-dogfood.mjs']), [
    'type-check',
    'test:agent-delivery',
    'vitest-related',
    'electron:compile',
  ]);
});

test('roadmap corpus changes receive the canonical parser contract', () => {
  assert.deepEqual(ids(['docs/engineering/roadmap.md']), [
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

// A gate whose own script is red must not be enforced — and must not quietly
// become "this surface owes no evidence" either.
test('a quarantined gate is announced, not enforced', () => {
  const files = ['src/components/nav/nav-history.ts'];
  assert.deepEqual(missingSurfaceGates(files), []);
  assert.deepEqual(
    quarantinedSurfaceGates(files).map(entry => [entry.gate, entry.backlogId]),
    [['eval:navigation', 'BUG-011']]
  );
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
