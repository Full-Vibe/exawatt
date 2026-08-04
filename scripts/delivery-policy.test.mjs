import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyDeliveryPolicy } from './lib/delivery-policy.mjs';

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
