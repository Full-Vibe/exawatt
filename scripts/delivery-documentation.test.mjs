// Generated for the public repository by the "public-document-set" recipe.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

test('agent instructions describe the queued delivery contract, not the retired retry loop', async () => {
  const agents = await read('AGENTS.md');
  assert.match(agents, /docs\/engineering\/agent-delivery\.md/);
  assert.match(agents, /publishes immutable `agent-attempts\/\*` refs/);
  assert.match(agents, /rebases in the author's own bootstrapped worktree/);
  assert.match(agents, /`installed=queued` is not installed/);
  assert.match(agents, /every tracked path has an open-source disposition/);
  assert.match(agents, /only PUBLIC\/GENERATED paths/);
  assert.match(agents, /PRIVATE\/EXCLUDED paths remain classified/);
  assert.match(agents, /open a pull request against `master`/);
  assert.doesNotMatch(
    agents,
    /reports that `origin\/master` moved, rebase the agent branch/
  );
  assert.doesNotMatch(
    agents,
    /run `pnpm electron:install-dogfood` as the final closeout step/
  );
});

test('the operational reference covers lifecycle, state, policy, recovery, and evidence', async () => {
  const guide = await read('docs/engineering/agent-delivery.md');
  for (const heading of [
    '## Normal agent contract',
    '## Three-stage flow',
    '## Candidate and repository-owned floor',
    '## Queue state and lifecycle',
    '## Head-of-queue integration',
    '## Superseding dogfood',
    '## Metrics and rollout verdict',
    '## Recovery runbook',
    '## Operator-only direct recovery',
    '## Executable ownership',
  ]) {
    assert.match(
      guide,
      new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    );
  }
  for (const implementation of [
    'scripts/agent-land.mjs',
    'scripts/lib/delivery-queue.mjs',
    'scripts/lib/delivery-policy.mjs',
    'scripts/lib/delivery-state.mjs',
    'scripts/lib/ci-batch.mjs',
    'scripts/lib/dogfood-queue.mjs',
    'scripts/install-dogfood.mjs',
  ]) {
    assert.match(guide, new RegExp(implementation.replaceAll('/', '\\/')));
  }
  assert.match(guide, /<git-common-dir>\/exawatt-delivery\//);
  assert.match(guide, /EXAWATT_AGENT_LAND_ALLOW_DIRECT=1/);
  assert.match(guide, /fail-closed path classification/);
  assert.match(guide, /public-bound content scan/);
  assert.match(guide, /refs\/heads\/ci-batches\/master/);
  assert.match(guide, /two hours/);
  assert.match(guide, /`actions_run`/);
});

test('architecture, decisions, project state, and roadmap link to the current runbook', async () => {
  const [architecture, updateDecision, deliveryDecision, project, roadmap] =
    await Promise.all([
      read('docs/engineering/architecture.md'),
      read('docs/engineering/decisions/0009-github-electron-update-channel.md'),
      read(
        'docs/engineering/decisions/0030-sequence-agent-delivery-and-decouple-dogfood.md'
      ),
      read('docs/engineering/projects/agent-development-loop.md'),
      read('docs/engineering/roadmap.md'),
    ]);
  assert.match(architecture, /Dogfood is a separate\s+superseding consumer/);
  assert.match(updateDecision, /AMENDED 2026-08-03 by decision `0030`/);
  assert.match(deliveryDecision, /docs\/engineering\/agent-delivery\.md/);
  assert.match(project, /docs\/engineering\/agent-delivery\.md/);
  assert.match(
    roadmap,
    /Operational reference: `docs\/engineering\/agent-delivery\.md`/
  );
});
