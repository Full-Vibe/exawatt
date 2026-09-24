import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createQueueFixture,
  finished,
  write,
} from './lib/delivery-queue-fixture.mjs';
import { readDeliveryMetrics } from './lib/delivery-state.mjs';
import {
  FROZEN_INSTALL_ARGS,
  reinstallWhenStale,
} from './lib/install-freshness.mjs';

/**
 * BUG-219: the landing reinstalls whenever node_modules is not the installed
 * form of the tree its floor is about to check. Ticket 476's queue-head rebase
 * brought `e3115004`'s lockfile change in, nothing reinstalled, and its
 * re-check failed `test:agent-delivery` on a tree nobody committed.
 */

const LOCK_V1 = 'lockfileVersion: 9\npackages:\n  jsdom@27.0.0: {}\n';
const LOCK_V2 = 'lockfileVersion: 9\npackages:\n  jsdom@27.4.0: {}\n';
const INSTALL = FROZEN_INSTALL_ARGS.join(' ');

function logged(log) {
  try {
    return readFileSync(log, 'utf8').split('\n').filter(Boolean);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function installs(log) {
  return logged(log).filter(line => line === INSTALL).length;
}

/** What `pnpm install` leaves behind in a worktree the author set up. */
function installed(worktree, lockfile) {
  mkdirSync(path.join(worktree, 'node_modules', '.pnpm'), { recursive: true });
  writeFileSync(
    path.join(worktree, 'node_modules', '.pnpm', 'lock.yaml'),
    lockfile
  );
}

function tickets(root) {
  const queue = path.join(root, '.git', 'exawatt-delivery', 'queue');
  if (!existsSync(queue)) return [];
  return readdirSync(queue).filter(file => file.endsWith('.json'));
}

function lockedFixture(prefix) {
  return createQueueFixture(prefix, {
    files: { '.gitignore': 'node_modules/\n', 'pnpm-lock.yaml': LOCK_V1 },
  });
}

const STRICT = {
  // Every check fails on a stale install, as ticket 476's did.
  FIXTURE_REQUIRE_FRESH_INSTALL: '1',
  EXAWATT_AGENT_LAND_PROBE_SECONDS: '0',
};

test('the stand-in check really fails on a stale install', () => {
  const fixture = lockedFixture('exawatt-reinstall-control-');
  try {
    const worktree = fixture.agentWorktree('agent/control', {
      'src/control.ts': 'export {};\n',
    });
    installed(worktree, LOCK_V2);
    const run = () =>
      spawnSync('pnpm', ['run', 'lint'], {
        cwd: worktree,
        env: { ...process.env, ...fixture.env, ...STRICT },
        encoding: 'utf8',
      });
    const stale = run();
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /ERR_MODULE_NOT_FOUND stand-in/u);
    installed(worktree, LOCK_V1);
    assert.equal(run().status, 0);
  } finally {
    fixture.cleanup();
  }
});

test('a queue rebase that changes the lockfile reinstalls exactly once, before the re-check, and says so', async () => {
  const fixture = lockedFixture('exawatt-reinstall-rebase-');
  try {
    const log = fixture.at('pnpm.log');
    const worktree = fixture.agentWorktree('agent/stale-after-rebase', {
      'src/change.ts': 'export const change = 1;\n',
    });
    installed(worktree, LOCK_V1);
    // Another landing bumps a dependency after this ticket's floor base.
    fixture.advanceMaster({ 'pnpm-lock.yaml': LOCK_V2 }, 'bump jsdom');

    const landed = await finished(
      fixture.land(worktree, [], { ...STRICT, FIXTURE_PNPM_LOG: log })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.equal(installs(log), 1, logged(log).join('\n'));
    // The reinstall precedes every check of the rebased tree.
    const lines = logged(log);
    const install = lines.indexOf(INSTALL);
    const rebaseChecks = lines.slice(install + 1);
    assert.ok(
      rebaseChecks.some(line => line === 'run test:agent-delivery'),
      'the rebased floor ran after the reinstall'
    );
    assert.match(
      landed.output,
      /rebase: node_modules was stale \(node_modules was installed from a different lockfile\); reinstalled/u
    );
    assert.match(landed.output, /STATUS .* reinstalled=rebase(?:\s|$)/u);
    assert.equal(
      readFileSync(
        path.join(worktree, 'node_modules', '.pnpm', 'lock.yaml'),
        'utf8'
      ),
      LOCK_V2
    );

    const refreshed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'install_refreshed'
    );
    assert.equal(refreshed.length, 1);
    assert.equal(refreshed[0].phase, 'rebase');
    assert.equal(
      refreshed[0].reason,
      'node_modules was installed from a different lockfile'
    );
    assert.equal(refreshed[0].nodePtyRebuilt, false);
    assert.ok(refreshed[0].ticketId);
  } finally {
    fixture.cleanup();
  }
});

test('a queue rebase that leaves the lockfile alone reinstalls nothing', async () => {
  const fixture = lockedFixture('exawatt-reinstall-none-');
  try {
    const log = fixture.at('pnpm.log');
    const worktree = fixture.agentWorktree('agent/fresh-after-rebase', {
      'src/change.ts': 'export const change = 1;\n',
    });
    installed(worktree, LOCK_V1);
    fixture.advanceMaster({ 'docs/unrelated.md': '# Unrelated\n' });

    const landed = await finished(
      fixture.land(worktree, [], { ...STRICT, FIXTURE_PNPM_LOG: log })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.match(landed.output, /rebase onto/u);
    assert.equal(installs(log), 0, logged(log).join('\n'));
    assert.doesNotMatch(landed.output, /reinstalled/u);
    const refreshed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'install_refreshed'
    );
    assert.deepEqual(refreshed, []);
  } finally {
    fixture.cleanup();
  }
});

test('a worktree submitted with a stale install of its own lockfile is reinstalled before its floor', async () => {
  const fixture = lockedFixture('exawatt-reinstall-admission-');
  try {
    const log = fixture.at('pnpm.log');
    const worktree = fixture.agentWorktree('agent/stale-at-admission', {
      'src/change.ts': 'export const change = 1;\n',
    });
    // The author's install predates a lockfile change on their own branch.
    installed(worktree, LOCK_V2);

    const landed = await finished(
      fixture.land(worktree, [], { ...STRICT, FIXTURE_PNPM_LOG: log })
    );
    assert.equal(landed.code, 0, landed.output);
    assert.equal(logged(log)[0], INSTALL, 'installed before any check ran');
    assert.equal(installs(log), 1);
    assert.match(landed.output, /STATUS .* reinstalled=candidate(?:\s|$)/u);
    const [refreshed] = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'install_refreshed'
    );
    assert.equal(refreshed.phase, 'candidate');
  } finally {
    fixture.cleanup();
  }
});

test('a lockfile a frozen install refuses stops the landing before it is queued, naming the remedy', async () => {
  const fixture = lockedFixture('exawatt-reinstall-refused-');
  try {
    const log = fixture.at('pnpm.log');
    const worktree = fixture.agentWorktree('agent/unsatisfiable-lockfile', {
      'src/change.ts': 'export const change = 1;\n',
    });
    const landed = await finished(
      fixture.land(worktree, [], {
        ...STRICT,
        FIXTURE_PNPM_LOG: log,
        FIXTURE_INSTALL_FAILS: '1',
      })
    );
    assert.notEqual(landed.code, 0);
    assert.match(landed.output, /dependencies have never been installed here/u);
    assert.match(landed.output, /commit the lockfile it writes/u);
    assert.deepEqual(
      logged(log),
      [INSTALL],
      'no check ran against the unusable tree'
    );
    assert.deepEqual(tickets(fixture.main), [], 'nothing was queued');
    const failed = (await readDeliveryMetrics(fixture.main)).filter(
      event => event.type === 'install_refresh_failed'
    );
    assert.equal(failed.length, 1);
    assert.equal(failed[0].phase, 'candidate');
  } finally {
    fixture.cleanup();
  }
});

function scratchTree({ declared, installedLock, binding }) {
  const root = mkdtempSync(path.join(tmpdir(), 'exa-reinstall-unit-'));
  if (declared !== undefined) write(root, 'pnpm-lock.yaml', declared);
  if (installedLock !== undefined)
    write(root, 'node_modules/.pnpm/lock.yaml', installedLock);
  if (binding) write(root, 'node_modules/node-pty/build/Release/pty.node', '');
  return root;
}

/** A `run` that installs as pnpm does and optionally drops node-pty's
 *  binding, the way reinstalling a new node-pty version does. */
function fakeRun(root, { dropBinding = false, rebuildRestores = true } = {}) {
  const calls = [];
  return {
    calls,
    run: async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
      if (args[0] === 'install') {
        write(
          root,
          'node_modules/.pnpm/lock.yaml',
          readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8')
        );
        if (dropBinding)
          rmSync(path.join(root, 'node_modules/node-pty'), {
            recursive: true,
            force: true,
          });
      }
      if (args[0] === 'electron:rebuild' && rebuildRestores) {
        write(root, 'node_modules/node-pty/build/Release/pty.node', '');
      }
    },
  };
}

test('a fresh tree, or one that declares no lockfile, is never reinstalled', async () => {
  for (const tree of [
    { declared: LOCK_V1, installedLock: LOCK_V1 },
    { installedLock: LOCK_V1 },
  ]) {
    const root = scratchTree(tree);
    const { calls, run } = fakeRun(root);
    assert.equal(await reinstallWhenStale(root, { run }), null);
    assert.deepEqual(calls, []);
  }
});

test('a reinstall that removes node-pty’s binding rebuilds it; a tree that never had one is left alone', async () => {
  const withBinding = scratchTree({
    declared: LOCK_V2,
    installedLock: LOCK_V1,
    binding: true,
  });
  const rebuilt = fakeRun(withBinding, { dropBinding: true });
  const result = await reinstallWhenStale(withBinding, { run: rebuilt.run });
  assert.equal(result.nodePtyRebuilt, true);
  assert.deepEqual(rebuilt.calls, [`pnpm ${INSTALL}`, 'pnpm electron:rebuild']);

  const without = scratchTree({ declared: LOCK_V2, installedLock: LOCK_V1 });
  const plain = fakeRun(without);
  assert.equal(
    (await reinstallWhenStale(without, { run: plain.run })).nodePtyRebuilt,
    false
  );
  assert.deepEqual(plain.calls, [`pnpm ${INSTALL}`]);
});

test('a reinstall is believed only when the comparison agrees', async () => {
  const root = scratchTree({ declared: LOCK_V2, installedLock: LOCK_V1 });
  await assert.rejects(
    () => reinstallWhenStale(root, { run: async () => {} }),
    /exited 0 and node_modules still is not the installed form/u
  );

  const lost = scratchTree({
    declared: LOCK_V2,
    installedLock: LOCK_V1,
    binding: true,
  });
  const broken = fakeRun(lost, { dropBinding: true, rebuildRestores: false });
  await assert.rejects(
    () => reinstallWhenStale(lost, { run: broken.run }),
    /did not restore it/u
  );
});
