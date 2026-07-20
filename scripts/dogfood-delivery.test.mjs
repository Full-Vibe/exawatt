// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { acquireDeliveryLock, deliveryLockPath } from './lib/delivery-lock.mjs';
import {
  commitStagedApp,
  recoverAtomicDogfoodSwap,
} from './lib/dogfood-install-transaction.mjs';
import { createGitBuildSnapshot } from './lib/git-build-snapshot.mjs';
import { atomicSwapPaths } from './lib/macos-atomic-swap.mjs';

const execFileAsync = promisify(execFile);

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function git(cwd, ...args) {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function createRepository(prefix = 'exawatt-delivery-test-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await git(root, 'init', '--initial-branch=master');
  await git(root, 'config', 'user.name', 'Delivery Test');
  await git(root, 'config', 'user.email', 'delivery@example.com');
  await writeFile(path.join(root, 'tracked.txt'), 'original\n');
  await git(root, 'add', 'tracked.txt');
  await git(root, 'commit', '-m', 'Initial');
  return root;
}

async function createApp(directory, marker) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'marker.txt'), `${marker}\n`);
}

async function marker(directory) {
  return (await readFile(path.join(directory, 'marker.txt'), 'utf8')).trim();
}

const stableIdentity = {
  identifier: 'com.exawatt.app',
  teamIdentifier: '5G5A77XLHZ',
};

test('repository delivery locks serialize writers and support delegated ownership', async () => {
  const root = await createRepository();
  let first;
  let second;
  try {
    first = await acquireDeliveryLock(root, { log() {} });
    const waiting = acquireDeliveryLock(root, {
      timeoutMs: 2_000,
      pollMs: 20,
      log() {},
    });
    assert.equal(
      await Promise.race([
        waiting.then(() => false),
        delay(100).then(() => true),
      ]),
      true,
      'a second writer should wait while the first owns the lock'
    );
    await first.release();
    first = null;
    second = await waiting;
    await second.release();
    second = null;

    first = await acquireDeliveryLock(root, { log() {} });
    const delegated = await acquireDeliveryLock(root, {
      existingToken: first.token,
      log() {},
    });
    assert.equal(delegated.reentrant, true);
    await delegated.release();
  } finally {
    await second?.release();
    await first?.release();
    await rm(root, { recursive: true, force: true });
  }
});

test('repository delivery locks recover an abandoned incomplete owner record', async () => {
  const root = await createRepository();
  let lock;
  try {
    const lockPath = await deliveryLockPath(root);
    await mkdir(lockPath);
    lock = await acquireDeliveryLock(root, {
      incompleteOwnerGraceMs: -1,
      timeoutMs: 1_000,
      pollMs: 10,
      log() {},
    });
    assert.equal(lock.reentrant, false);
  } finally {
    await lock?.release();
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'atomic app replacement leaves the previous app recoverable until verification succeeds',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-app-swap-'));
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    try {
      await createApp(target, 'old');
      await createApp(staging, 'new');
      const result = await commitStagedApp({
        staging,
        target,
        expectedIdentity: stableIdentity,
        inspectExisting: async () => stableIdentity,
        isStableIdentity: () => true,
        verifyInstalled: async candidate => {
          assert.equal(await marker(candidate), 'new');
        },
        atomicSwap: atomicSwapPaths,
      });

      assert.equal(await marker(target), 'new');
      assert.equal(await marker(staging), 'old');
      assert.equal(result.stalePreviousPath, staging);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'a failed post-swap verification atomically restores the prior app',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-app-rollback-'));
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    try {
      await createApp(target, 'old');
      await createApp(staging, 'new');
      await assert.rejects(
        commitStagedApp({
          staging,
          target,
          expectedIdentity: stableIdentity,
          inspectExisting: async () => stableIdentity,
          isStableIdentity: () => true,
          verifyInstalled: async () => {
            throw new Error('verification failed');
          },
          atomicSwap: atomicSwapPaths,
        }),
        /verification failed/
      );
      assert.equal(await marker(target), 'old');
      assert.equal(await marker(staging), 'new');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'stable signer mismatches and inspection failures never replace the current app',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-app-identity-'));
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    try {
      await createApp(target, 'old');
      await createApp(staging, 'new');
      const base = {
        staging,
        target,
        expectedIdentity: stableIdentity,
        isStableIdentity: () => true,
        verifyInstalled: async () => {},
        atomicSwap: atomicSwapPaths,
      };
      await assert.rejects(
        commitStagedApp({
          ...base,
          inspectExisting: async () => ({
            identifier: stableIdentity.identifier,
            teamIdentifier: 'OTHERID123',
          }),
        }),
        /stable signer identity does not match/
      );
      assert.equal(await marker(target), 'old');
      assert.equal(await marker(staging), 'new');

      await assert.rejects(
        commitStagedApp({
          ...base,
          inspectExisting: async () => {
            throw new Error('codesign unavailable');
          },
        }),
        /Cannot safely inspect the existing app/
      );
      assert.equal(await marker(target), 'old');
      assert.equal(await marker(staging), 'new');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'an explicitly unsigned legacy app can migrate once',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-app-legacy-'));
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    try {
      await createApp(target, 'old');
      await createApp(staging, 'new');
      const unsigned = new Error('unsigned');
      unsigned.code = 'ERR_CODE_OBJECT_UNSIGNED';
      await commitStagedApp({
        staging,
        target,
        expectedIdentity: stableIdentity,
        inspectExisting: async () => {
          throw unsigned;
        },
        isStableIdentity: () => false,
        verifyInstalled: async candidate => {
          assert.equal(await marker(candidate), 'new');
        },
        atomicSwap: atomicSwapPaths,
      });
      assert.equal(await marker(target), 'new');
      assert.equal(await marker(staging), 'old');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'interrupted atomic transactions deterministically preserve a verified app',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'exawatt-app-recovery-'));
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    const verify = async candidate => {
      if ((await marker(candidate)) !== 'valid') throw new Error('invalid app');
    };
    try {
      await createApp(target, 'invalid');
      await createApp(staging, 'valid');
      const restored = await recoverAtomicDogfoodSwap({
        staging,
        target,
        verify,
        atomicSwap: atomicSwapPaths,
      });
      assert.equal(restored.action, 'restored-verified-app');
      assert.equal(await marker(target), 'valid');
      await assert.rejects(readFile(path.join(staging, 'marker.txt')));

      await createApp(staging, 'invalid');
      const removed = await recoverAtomicDogfoodSwap({
        staging,
        target,
        verify,
        atomicSwap: atomicSwapPaths,
      });
      assert.equal(removed.action, 'removed-stale-previous-app');
      assert.equal(await marker(target), 'valid');
      await assert.rejects(readFile(path.join(staging, 'marker.txt')));

      await rm(target, { recursive: true, force: true });
      await createApp(staging, 'valid');
      const completed = await recoverAtomicDogfoodSwap({
        staging,
        target,
        verify,
        atomicSwap: atomicSwapPaths,
      });
      assert.equal(completed.action, 'completed-staged-install');
      assert.equal(await marker(target), 'valid');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test(
  'recovery rolls back if verification changes after moving the candidate',
  { skip: process.platform !== 'darwin' },
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), 'exawatt-app-recovery-rollback-')
    );
    const target = path.join(root, 'Exawatt.app');
    const staging = path.join(root, '.Exawatt.transaction.app');
    try {
      await createApp(target, 'invalid');
      await createApp(staging, 'valid');
      let validChecks = 0;
      await assert.rejects(
        recoverAtomicDogfoodSwap({
          staging,
          target,
          verify: async candidate => {
            if ((await marker(candidate)) !== 'valid') {
              throw new Error('invalid app');
            }
            validChecks += 1;
            if (validChecks > 1)
              throw new Error('transient verification failure');
          },
          atomicSwap: atomicSwapPaths,
        }),
        /transient verification failure/
      );
      assert.equal(await marker(target), 'invalid');
      assert.equal(await marker(staging), 'valid');

      await rm(target, { recursive: true, force: true });
      validChecks = 0;
      await assert.rejects(
        recoverAtomicDogfoodSwap({
          staging,
          target,
          verify: async () => {
            validChecks += 1;
            if (validChecks > 1)
              throw new Error('transient verification failure');
          },
          atomicSwap: atomicSwapPaths,
        }),
        /transient verification failure/
      );
      await assert.rejects(readFile(path.join(target, 'marker.txt')));
      assert.equal(await marker(staging), 'valid');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
);

test('immutable build snapshots remain pinned when the source checkout changes', async () => {
  const root = await createRepository('exawatt-snapshot-test-');
  const sourceSha = await git(root, 'rev-parse', 'HEAD');
  const snapshot = await createGitBuildSnapshot(root, sourceSha);
  try {
    await writeFile(path.join(root, 'tracked.txt'), 'changed\n');
    assert.equal(
      await readFile(path.join(snapshot.root, 'tracked.txt'), 'utf8'),
      'original\n'
    );
    assert.equal(await git(snapshot.root, 'rev-parse', 'HEAD'), sourceSha);
  } finally {
    await snapshot.cleanup();
    const worktrees = await git(root, 'worktree', 'list', '--porcelain');
    assert.doesNotMatch(worktrees, /exawatt-dogfood-source-/);
    await rm(root, { recursive: true, force: true });
  }
});
