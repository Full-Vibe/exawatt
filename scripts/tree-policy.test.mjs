import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { commit, write } from './lib/delivery-queue-fixture.mjs';
import { git } from './lib/hermetic-git.mjs';
import {
  TREE_POLICY_FILE,
  TreePolicyError,
  loadTreePolicy,
} from './lib/tree-policy.mjs';

/**
 * BUG-317: a landing classifies each tree with that tree's own delivery
 * policy. The landing fixtures prove it end to end (merge-train and
 * gate-recheck); these pin the loader: a fresh instance per load down to
 * every file the policy imports, and a policy that cannot answer named as
 * the tree's failure.
 */

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELPER = 'scripts/lib/policy-helper.mjs';

function repository(policy, helper = "export const mark = 'first';\n") {
  const root = mkdtempSync(path.join(tmpdir(), 'exawatt-tree-policy-'));
  git(root, ['init', '--quiet', '--initial-branch=master']);
  git(root, ['config', 'user.name', 'Fixture Author']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  write(root, TREE_POLICY_FILE, policy);
  write(root, HELPER, helper);
  commit(root, 'policy');
  return root;
}

const MARKING_POLICY = `import { mark } from './policy-helper.mjs';
export function deliveryTree(root) {
  return { root, hash: 'fixture' };
}
export function classifyDeliveryPolicy() {
  return [{ id: mark, command: 'pnpm', args: ['run', mark] }];
}
`;

test('each load is its own instance, down to the files the policy imports', async () => {
  const root = repository(MARKING_POLICY);
  try {
    const first = await loadTreePolicy(root);
    write(root, HELPER, "export const mark = 'second';\n");
    commit(root, 'the helper the policy imports changed');
    const second = await loadTreePolicy(root);
    assert.deepEqual(
      second.classifyDeliveryPolicy().map(check => check.id),
      ['second'],
      'a later tree in the same checkout reads its own imports'
    );
    assert.deepEqual(
      first.classifyDeliveryPolicy().map(check => check.id),
      ['first'],
      'an earlier load keeps the tree it loaded'
    );
    assert.deepEqual(first.tree, { root, hash: 'fixture' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a policy that does not load, lacks an export or throws is the tree’s failure', async () => {
  const roots = [];
  const make = (...args) => {
    const root = repository(...args);
    roots.push(root);
    return root;
  };
  try {
    await assert.rejects(
      loadTreePolicy(
        make(`${MARKING_POLICY}throw new Error('this policy does not load');\n`)
      ),
      error =>
        error instanceof TreePolicyError &&
        /^delivery-policy: scripts\/lib\/delivery-policy\.mjs of tree [0-9a-f]{12} did not load: Error: this policy does not load\./u.test(
          error.message
        )
    );

    const missing = make(MARKING_POLICY);
    git(missing, ['rm', '--quiet', TREE_POLICY_FILE]);
    commit(missing, 'no policy');
    await assert.rejects(
      loadTreePolicy(missing),
      error =>
        error instanceof TreePolicyError && /did not load/u.test(error.message)
    );

    const partial = await loadTreePolicy(make(MARKING_POLICY));
    assert.throws(
      () => partial.missingSurfaceGates(['src/a.ts']),
      error =>
        error instanceof TreePolicyError &&
        /exports no missingSurfaceGates/u.test(error.message)
    );

    const throwing = await loadTreePolicy(
      make(
        MARKING_POLICY.replace(
          "return [{ id: mark, command: 'pnpm', args: ['run', mark] }];",
          "throw new Error('cannot classify');"
        )
      )
    );
    assert.throws(
      () => throwing.classifyDeliveryPolicy(['src/a.ts']),
      error =>
        error instanceof TreePolicyError &&
        /threw in classifyDeliveryPolicy: Error: cannot classify/u.test(
          error.message
        )
    );
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});

test('this tree’s own policy loads and classifies its own tree', async () => {
  const policy = await loadTreePolicy(REPOSITORY_ROOT);
  assert.equal(
    policy.tree.hash,
    git(REPOSITORY_ROOT, ['rev-parse', 'HEAD^{tree}'])
  );
  const checks = policy.classifyDeliveryPolicy(['docs/guide.md'], [], {
    tree: policy.tree,
  });
  assert.ok(
    checks.some(check => check.id === 'open-source:paths:check'),
    checks.map(check => check.id).join(', ')
  );
});
