import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  describeEntryBoundaries,
  describeUnrendered,
  preparePublicProjection,
  projectToPublicRemote,
  publishPreparedPublicProjection,
  publicPushArgs,
  resolvePublicRemote,
} from './lib/public-delivery.mjs';
import {
  OPEN_SOURCE_PATH_MANIFEST,
  createPathClassifier,
  readPathManifest,
} from './lib/open-source-paths.mjs';
import { projectPublicHistory } from './lib/public-projection.mjs';
import { hasRecipeRenderer, rendersOutput } from './lib/recipe-renderers.mjs';
import {
  clearPublicMaintenanceHold,
  enablePublicMaintenanceHold,
  readPublicMaintenanceHold,
} from './lib/public-maintenance-hold.mjs';
import {
  createPrivateFixture,
  git,
  writeFastPnpm,
} from './lib/public-repository-fixture.mjs';
import {
  latestPublishedPair,
  recordSourceLock,
  readSourceLock,
  sourceLockPath,
} from './lib/public-source-lock.mjs';
import {
  assertDeliberate,
  reseedPublicRepository,
  reseedPushArgs,
} from './open-source-reseed.mjs';
const runPublicMaintenance = existsSync(
  new URL('./public-maintenance.mjs', import.meta.url)
)
  ? (await import('./public-maintenance.mjs')).runPublicMaintenance
  : null;
const privateMaintenance = {
  skip: runPublicMaintenance
    ? false
    : 'Private maintenance CLI is intentionally omitted from public distribution',
};

/**
 * The outbound half of ENG-030 WP6-D, proved against local repositories only.
 * No public repository exists yet; every "public remote" here is a local bare
 * repository under the OS temp directory, and nothing reaches a network.
 */

const execFileAsync = promisify(execFile);
const landScript = fileURLToPath(new URL('./agent-land.mjs', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

async function land(worktree, environment) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [landScript],
    {
      cwd: worktree,
      env: { ...process.env, ...environment },
      maxBuffer: 32 * 1024 * 1024,
    }
  );
  return stdout + stderr;
}

const PASS_RESEED_GATES = Object.freeze({
  metadataAudit: async () => ({
    reseedRequired: false,
    tags: 0,
    findings: [],
  }),
  secretScan: async () => 0,
});

/** Publishes the projection of the private tip, as an earlier landing would have. */
async function seedPublicRemote(fixture, remote) {
  const projection = await projectPublicHistory({
    sourceRepo: fixture.root,
    sourceSha: git(fixture.root, ['rev-parse', 'master']),
    destination: fixture.at(`seed-${path.basename(remote)}`),
  });
  git(projection.destination, ['push', '--quiet', remote, 'master:master']);
  return projection;
}

function rejectPushes(remote) {
  const hook = path.join(remote, 'hooks', 'pre-receive');
  writeFileSync(hook, '#!/bin/sh\necho "public remote is down" >&2\nexit 1\n');
  chmodSync(hook, 0o755);
}

test('with no public remote configured the projector is a silent no-op', async () => {
  const fixture = createPrivateFixture('exawatt-projector-inert-');
  try {
    const said = [];
    assert.equal(await resolvePublicRemote(fixture.root), null);
    const summary = await projectToPublicRemote(fixture.root, {
      integratedSha: git(fixture.root, ['rev-parse', 'master']),
      log: message => said.push(message),
      warn: message => said.push(message),
    });
    assert.deepEqual(summary, { state: 'inert' });
    assert.deepEqual(said, [], 'the default path must have no ceremony');
    assert.deepEqual(await readSourceLock(fixture.root), []);
    assert.equal(existsSync(await sourceLockPath(fixture.root)), false);
  } finally {
    fixture.cleanup();
  }
});

test('a landing with no public remote is exactly the landing it was before', async () => {
  const fixture = createPrivateFixture('exawatt-projector-landing-inert-');
  try {
    const worktree = fixture.agentWorktree('agent/inert', {
      'src/b.ts': 'export const b = 2;\n',
    });
    const output = await land(worktree, writeFastPnpm(fixture.parent));

    assert.match(output, /STATUS implemented=/u);
    assert.match(output, /installed=not-requested/u);
    assert.doesNotMatch(output, /public=/u);
    assert.doesNotMatch(output, /public-delivery/u);
    assert.equal(
      git(fixture.origin, ['rev-parse', 'master']),
      git(worktree, ['rev-parse', 'HEAD']),
      'the private landing is unchanged'
    );
    assert.deepEqual(await readSourceLock(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test('maintenance hold lands privately, preserves public, and accumulates owed head', async () => {
  const fixture = createPrivateFixture('exawatt-public-maintenance-hold-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await seedPublicRemote(fixture, remote);
    const publicTip = git(remote, ['rev-parse', 'master']);
    const reason =
      'live public history is quarantined pending reviewed cutover';
    await enablePublicMaintenanceHold(fixture.root, {
      expectedPublicSha: publicTip,
      reason,
    });
    for (const [branch, file] of [
      ['agent/held-one', 'src/b.ts'],
      ['agent/held-two', 'src/c.ts'],
    ]) {
      const worktree = fixture.agentWorktree(branch, {
        [file]: `export const held = ${JSON.stringify(branch)};\n`,
      });
      const output = await land(worktree, writeFastPnpm(fixture.parent));
      assert.match(output, /public=held/u);
      assert.equal(git(remote, ['rev-parse', 'master']), publicTip);
    }
    const records = await readSourceLock(fixture.root);
    assert.equal(records.at(-1).status, 'held');
    assert.equal(
      records.at(-1).privateSha,
      git(fixture.origin, ['rev-parse', 'master'])
    );
    assert.equal(
      (await readPublicMaintenanceHold(fixture.root)).reason,
      reason
    );
    await assert.rejects(
      clearPublicMaintenanceHold(fixture.root, {
        expectedPublicSha: '0'.repeat(40),
      }),
      /exact held public SHA/u
    );
    assert.equal(
      await clearPublicMaintenanceHold(fixture.root, {
        expectedPublicSha: publicTip,
      }),
      true
    );
  } finally {
    fixture.cleanup();
  }
});

test('a stale maintenance hold refuses private integration', async () => {
  const fixture = createPrivateFixture('exawatt-public-maintenance-stale-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    const heldTip = git(remote, ['rev-parse', 'master']);
    await enablePublicMaintenanceHold(fixture.root, {
      expectedPublicSha: heldTip,
      reason: 'public history must stay frozen during reviewed maintenance',
    });
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 7;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'move held remote']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const privateBefore = git(fixture.origin, ['rev-parse', 'master']);
    const worktree = fixture.agentWorktree('agent/stale-hold', {
      'src/b.ts': 'export const b = 2;\n',
    });
    await assert.rejects(
      land(worktree, writeFastPnpm(fixture.parent)),
      /held public tip moved/u
    );
    assert.equal(git(fixture.origin, ['rev-parse', 'master']), privateBefore);
  } finally {
    fixture.cleanup();
  }
});

test(
  'the maintenance CLI upgrades custody under the delivery lock',
  privateMaintenance,
  async () => {
    const fixture = createPrivateFixture('exawatt-public-maintenance-cli-');
    try {
      const remote = fixture.configurePublicRemote(fixture.publicRemote());
      await seedPublicRemote(fixture, remote);
      const publicTip = git(remote, ['rev-parse', 'master']);
      const reason = 'public history is held for a reviewed repository cutover';
      await enablePublicMaintenanceHold(fixture.root, {
        expectedPublicSha: publicTip,
        reason,
      });
      const hold = await runPublicMaintenance(
        fixture.root,
        ['--', 'enable', '--expected-public-sha', publicTip, '--reason', reason],
        { EXAWATT_PUBLIC_MAINTENANCE_ALLOW: '1' }
      );
      assert.equal(hold.schemaVersion, 2);
      assert.equal(hold.publicRepository, remote);
      assert.equal(
        hold.activationPrivateSha,
        git(fixture.origin, ['rev-parse', 'master'])
      );
      assert.match(hold.advertisedRefsDigest, /^[0-9a-f]{64}$/u);
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  'maintenance enable observes the remote only after acquiring the lock',
  privateMaintenance,
  async () => {
    const fixture = createPrivateFixture('exawatt-public-maintenance-race-');
    try {
      const remote = fixture.configurePublicRemote(fixture.publicRemote());
      const seed = await seedPublicRemote(fixture, remote);
      const expected = git(remote, ['rev-parse', 'master']);
      let entered;
      const lockRequested = new Promise(resolve => {
        entered = resolve;
      });
      let release;
      const lockAvailable = new Promise(resolve => {
        release = resolve;
      });
      const enabling = runPublicMaintenance(
        fixture.root,
        [
          'enable',
          '--expected-public-sha',
          expected,
          '--reason',
          'public history is held for a reviewed repository cutover',
        ],
        { EXAWATT_PUBLIC_MAINTENANCE_ALLOW: '1' },
        {
          acquireLock: async () => {
            entered();
            await lockAvailable;
            return { async release() {} };
          },
        }
      );
      await lockRequested;
      writeFileSync(
        path.join(seed.destination, 'src/a.ts'),
        'export const a = 101;\n'
      );
      git(seed.destination, ['commit', '--quiet', '-am', 'move before hold']);
      git(seed.destination, ['push', '--quiet', remote, 'master:master']);
      release();
      await assert.rejects(enabling, /expected SHA is not public master/u);
      assert.equal(await readPublicMaintenanceHold(fixture.root), null);
    } finally {
      fixture.cleanup();
    }
  }
);

test(
  'maintenance clear recovers a recorded publication but refuses an unexplained moved tip',
  privateMaintenance,
  async () => {
    const fixture = createPrivateFixture(
      'exawatt-public-maintenance-cleared-publication-'
    );
    try {
      const remote = fixture.configurePublicRemote(fixture.publicRemote());
      const seed = await seedPublicRemote(fixture, remote);
      const oldTip = git(remote, ['rev-parse', 'master']);
      await runPublicMaintenance(
        fixture.root,
        [
          'enable',
          '--expected-public-sha',
          oldTip,
          '--reason',
          'hold publication for a verified catch-up snapshot',
        ],
        { EXAWATT_PUBLIC_MAINTENANCE_ALLOW: '1' }
      );
      writeFileSync(
        path.join(seed.destination, 'src/a.ts'),
        'export const a = 102;\n'
      );
      git(seed.destination, ['commit', '--quiet', '-am', 'public update']);
      git(seed.destination, ['push', '--quiet', remote, 'master:master']);
      const newTip = git(remote, ['rev-parse', 'master']);
      const clear = () =>
        runPublicMaintenance(
          fixture.root,
          ['clear', '--expected-public-sha', newTip],
          { EXAWATT_PUBLIC_MAINTENANCE_ALLOW: '1' }
        );
      await assert.rejects(clear(), /lacks a recorded publication/);
      assert.ok(await readPublicMaintenanceHold(fixture.root));
      await recordSourceLock(fixture.root, {
        status: 'published',
        metadataPolicyId: 'exawatt-public-metadata-v2',
        projectionContractId:
          'exawatt-public-projection-v2-prefix-stable-neutral-metadata',
        privateSha: git(fixture.origin, ['rev-parse', 'master']),
        publicSha: newTip,
        previousPublicSha: oldTip,
        publicRepository: remote,
      });
      assert.equal(await clear(), true);
      assert.equal(await readPublicMaintenanceHold(fixture.root), null);
    } finally {
      fixture.cleanup();
    }
  }
);

test('a configured public remote receives the projection and the pair is recorded', async () => {
  const fixture = createPrivateFixture('exawatt-projector-publish-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const worktree = fixture.agentWorktree('agent/publish', {
      'src/b.ts': 'export const b = 2;\n',
      'company/secret.md': 'private overlay, revised\n',
    });
    const output = await land(worktree, writeFastPnpm(fixture.parent));
    const integrated = git(fixture.origin, ['rev-parse', 'master']);

    assert.match(output, /public=published/u);
    const records = await readSourceLock(fixture.root);
    assert.equal(records.length, 2);
    assert.equal(records[0].status, 'published');
    assert.notEqual(records[0].privateSha, integrated);
    const record = records.at(-1);
    assert.equal(record.status, 'published');
    assert.equal(record.privateSha, integrated);
    assert.equal(record.publicSha, git(remote, ['rev-parse', 'master']));
    assert.equal(record.publicRepository, remote);

    // What the public repository received: the PUBLIC set plus the RENDERED
    // variant of the generated workflow, and no private path in any commit.
    const paths = new Set(
      git(remote, ['ls-tree', '-r', '--name-only', 'master']).split('\n')
    );
    assert.equal(paths.has('src/b.ts'), true);
    assert.equal(paths.has('.github/workflows/ci.yml'), true);
    assert.equal(paths.has('company/secret.md'), false);
    assert.equal(paths.has('src/config.private.ts'), false);
    assert.equal(paths.has('src/config.ts'), false);
    assert.match(
      git(remote, ['show', 'master:.github/workflows/ci.yml']),
      /branches: \[master\]/u
    );

    // The report names what the public repository did NOT receive.
    assert.match(
      output,
      /did not receive 1 generated outputs: src\/config\.ts/u
    );
    assert.equal(record.unrenderedOutputs.includes('src/config.ts'), true);
    assert.equal(
      records.some(entry => (entry.renderedVariants ?? 0) >= 1),
      true
    );
    assert.equal(latestPublishedPair(records), record);
  } finally {
    fixture.cleanup();
  }
});

test('a public remote that diverged is refused, never forced, and left untouched', async () => {
  const fixture = createPrivateFixture('exawatt-projector-refuse-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);

    // Exactly what a human merge into public master would do: a commit the
    // projection does not contain.
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'merged into public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const divergent = git(remote, ['rev-parse', 'master']);

    const said = [];
    const summary = await projectToPublicRemote(fixture.root, {
      integratedSha: git(fixture.root, ['rev-parse', 'master']),
      log: message => said.push(message),
      warn: message => said.push(message),
    });
    assert.equal(summary.state, 'refused');
    assert.equal(summary.publicSha, null);
    assert.equal(
      git(remote, ['rev-parse', 'master']),
      divergent,
      'a refusal leaves the public remote exactly where it was'
    );
    assert.match(said.join('\n'), /open-source:reseed/u);
    const record = (await readSourceLock(fixture.root)).at(-1);
    assert.equal(record.status, 'refused');
    assert.match(record.reason, /non-fast-forward/u);
  } finally {
    fixture.cleanup();
  }
});

test('a deterministic public preflight refusal leaves private master untouched', async () => {
  const fixture = createPrivateFixture('exawatt-projector-preflight-stop-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'diverge public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);

    const privateBefore = git(fixture.origin, ['rev-parse', 'master']);
    const worktree = fixture.agentWorktree('agent/preflight-stop', {
      'src/b.ts': 'export const b = 2;\n',
    });
    await assert.rejects(
      land(worktree, writeFastPnpm(fixture.parent)),
      /refusing a non-fast-forward projection/u
    );
    assert.equal(
      git(fixture.origin, ['rev-parse', 'master']),
      privateBefore,
      'private master must not move after deterministic public preflight failure'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a public push failure records public=pending and never fails the landing', async () => {
  const fixture = createPrivateFixture('exawatt-projector-pending-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await seedPublicRemote(fixture, remote);
    const publishedTip = git(remote, ['rev-parse', 'master']);
    rejectPushes(remote);

    const worktree = fixture.agentWorktree('agent/pending', {
      'src/b.ts': 'export const b = 2;\n',
    });
    const output = await land(worktree, writeFastPnpm(fixture.parent));

    assert.match(output, /public=pending/u);
    assert.equal(
      git(fixture.origin, ['rev-parse', 'master']),
      git(worktree, ['rev-parse', 'HEAD']),
      'the private landing is the source of truth and still succeeded'
    );
    assert.equal(git(remote, ['rev-parse', 'master']), publishedTip);
    const record = (await readSourceLock(fixture.root)).at(-1);
    assert.equal(record.status, 'pending');
    assert.match(record.publicSha, /^[0-9a-f]{40}$/u);
    assert.equal(
      record.privateSha,
      git(fixture.origin, ['rev-parse', 'master'])
    );
  } finally {
    fixture.cleanup();
  }
});

test('a pending public split is retried before the next private landing', async () => {
  const fixture = createPrivateFixture('exawatt-projector-pending-retry-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await seedPublicRemote(fixture, remote);
    rejectPushes(remote);
    const first = fixture.agentWorktree('agent/pending-first', {
      'src/b.ts': 'export const b = 2;\n',
    });
    await land(first, writeFastPnpm(fixture.parent));
    const integratedBeforeSecond = git(fixture.origin, ['rev-parse', 'master']);
    const second = fixture.agentWorktree('agent/pending-second', {
      'src/c.ts': 'export const c = 3;\n',
    });
    await assert.rejects(
      land(second, writeFastPnpm(fixture.parent)),
      /pending public projection catch-up did not publish/u
    );
    assert.equal(
      git(fixture.origin, ['rev-parse', 'master']),
      integratedBeforeSecond,
      'a failed catch-up must stop the next private integration'
    );

    rmSync(path.join(remote, 'hooks', 'pre-receive'));
    const output = await land(second, writeFastPnpm(fixture.parent));
    assert.match(output, /public=published/u);
    const records = await readSourceLock(fixture.root);
    const repair = records.at(-2);
    const candidate = records.at(-1);
    assert.equal(repair.status, 'published');
    assert.equal(repair.privateSha, integratedBeforeSecond);
    assert.equal(candidate.status, 'published');
    assert.equal(
      candidate.privateSha,
      git(fixture.origin, ['rev-parse', 'master'])
    );
    assert.equal(candidate.publicSha, git(remote, ['rev-parse', 'master']));
  } finally {
    fixture.cleanup();
  }
});

test('a stale or missing source lock catches up integrated master before a candidate', async () => {
  const fixture = createPrivateFixture('exawatt-projector-missing-lock-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await seedPublicRemote(fixture, remote);
    writeFileSync(path.join(fixture.root, 'src/b.ts'), 'export const b = 2;\n');
    git(fixture.root, ['add', '--', 'src/b.ts']);
    git(fixture.root, ['commit', '--quiet', '-m', 'simulated crashed landing']);
    git(fixture.root, ['push', '--quiet', 'origin', 'master']);
    const crashedSha = git(fixture.origin, ['rev-parse', 'master']);
    assert.deepEqual(await readSourceLock(fixture.root), []);

    const candidate = fixture.agentWorktree('agent/after-missing-lock', {
      'src/c.ts': 'export const c = 3;\n',
    });
    await land(candidate, writeFastPnpm(fixture.parent));
    const records = await readSourceLock(fixture.root);
    assert.equal(records.at(-2).privateSha, crashedSha);
    assert.equal(records.at(-2).status, 'published');
    assert.equal(
      records.at(-1).privateSha,
      git(fixture.origin, ['rev-parse', 'master'])
    );
    assert.equal(
      records.at(-1).publicSha,
      git(remote, ['rev-parse', 'master'])
    );
  } finally {
    fixture.cleanup();
  }
});

for (const pushState of ['accepted', 'rejected']) {
  test(`a ${pushState} public push reports source-lock append failure truthfully`, async () => {
    const fixture = createPrivateFixture(`exawatt-lock-append-${pushState}-`);
    try {
      const remote = fixture.configurePublicRemote(fixture.publicRemote());
      if (pushState === 'rejected') rejectPushes(remote);
      const prepared = await preparePublicProjection(fixture.root, {
        integratedSha: git(fixture.root, ['rev-parse', 'master']),
        resumeFrom: null,
      });
      const summary = await publishPreparedPublicProjection(
        fixture.root,
        prepared,
        {
          log() {},
          warn() {},
          record: async () => {
            throw new Error('injected source-lock append failure');
          },
        }
      );
      assert.equal(summary.recorded, false);
      assert.equal(
        summary.state,
        pushState === 'accepted' ? 'published' : 'pending'
      );
      if (pushState === 'accepted') {
        assert.equal(git(remote, ['rev-parse', 'master']), summary.publicSha);
      } else {
        assert.throws(() => git(remote, ['rev-parse', 'master']));
      }
      assert.deepEqual(await readSourceLock(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  });
}

test('an accepted push with a lost client response is recorded as published', async () => {
  const fixture = createPrivateFixture('exawatt-push-response-lost-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const prepared = await preparePublicProjection(fixture.root, {
      integratedSha: git(fixture.root, ['rev-parse', 'master']),
      resumeFrom: null,
    });
    const summary = await publishPreparedPublicProjection(
      fixture.root,
      prepared,
      {
        log() {},
        warn() {},
        push: async candidate => {
          await execFileAsync(
            'git',
            publicPushArgs({ url: candidate.remote.url }),
            {
              cwd: candidate.projection.destination,
              env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            }
          );
          throw new Error('injected lost client response after acceptance');
        },
      }
    );
    assert.equal(summary.state, 'published');
    assert.equal(summary.recorded, true);
    assert.equal(git(remote, ['rev-parse', 'master']), summary.publicSha);
  } finally {
    fixture.cleanup();
  }
});

test('public remote movement after prepare is refused before push', async () => {
  const fixture = createPrivateFixture('exawatt-public-moved-after-prepare-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const prepared = await preparePublicProjection(fixture.root, {
      integratedSha: git(fixture.root, ['rev-parse', 'master']),
      resumeFrom: null,
    });
    await seedPublicRemote(fixture, remote);
    const moved = git(remote, ['rev-parse', 'master']);
    const summary = await publishPreparedPublicProjection(
      fixture.root,
      prepared,
      { log() {}, warn() {} }
    );
    assert.equal(summary.state, 'refused');
    assert.equal(git(remote, ['rev-parse', 'master']), moved);
  } finally {
    fixture.cleanup();
  }
});

test('the landing path cannot force; only the reseed carries a force flag', async () => {
  const args = publicPushArgs({ url: '/tmp/public.git' });
  assert.deepEqual(
    args.filter(argument => /force/u.test(argument)),
    []
  );
  const source = await readFile(
    fileURLToPath(new URL('./lib/public-delivery.mjs', import.meta.url)),
    'utf8'
  );
  assert.doesNotMatch(source, /--force/u);

  const reseed = reseedPushArgs({
    url: '/tmp/public.git',
    expected: 'a'.repeat(40),
  });
  assert.deepEqual(
    reseed.filter(argument => /force/u.test(argument)),
    [`--force-with-lease=refs/heads/master:${'a'.repeat(40)}`]
  );
  assert.throws(
    () => reseedPushArgs({ url: '/tmp/public.git', expected: 'HEAD' }),
    /exact public tip it observed/u
  );
});

test('a reseed is refused unless it is deliberate, reasoned, and confirmed', () => {
  const complete = {
    confirm: 'reseed-public-history',
    reason: 'the manifest reclassified history',
  };
  assert.throws(
    () => assertDeliberate(complete, {}),
    /EXAWATT_OPEN_SOURCE_ALLOW_RESEED=1/u
  );
  assert.throws(
    () =>
      assertDeliberate(
        { ...complete, confirm: 'yes' },
        { EXAWATT_OPEN_SOURCE_ALLOW_RESEED: '1' }
      ),
    /--confirm must be exactly/u
  );
  assert.throws(
    () =>
      assertDeliberate(
        { ...complete, reason: 'because' },
        { EXAWATT_OPEN_SOURCE_ALLOW_RESEED: '1' }
      ),
    /--reason must say why/u
  );
  assert.equal(
    assertDeliberate(complete, { EXAWATT_OPEN_SOURCE_ALLOW_RESEED: '1' }),
    true
  );
});

test('the reseed force-publishes once over a refused remote and records why', async () => {
  const fixture = createPrivateFixture('exawatt-reseed-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'merged into public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const divergent = git(remote, ['rev-parse', 'master']);

    const reason = 'the manifest reclassified src/config.ts as public';
    const said = [];
    const record = await reseedPublicRepository({
      root: fixture.root,
      reason,
      source: git(fixture.root, ['rev-parse', 'master']),
      log: message => said.push(message),
      ...PASS_RESEED_GATES,
    });

    assert.equal(record.status, 'reseeded');
    assert.equal(record.reason, reason);
    assert.equal(record.previousPublicSha, divergent);
    assert.equal(git(remote, ['rev-parse', 'master']), record.publicSha);
    assert.equal(record.metadataPolicyId, record.epochUpdate.metadataPolicyId);
    assert.ok(record.metadataCommitCount > 0);
    assert.equal(record.metadataTagCount, 0);
    assert.equal(record.completeHistoryGitleaks, 'passed');
    assert.equal(record.epochUpdateOwed, true);
    assert.deepEqual(record.epochUpdate, {
      schemaVersion: 1,
      sourceSha: record.privateSha,
      publicSha: record.publicSha,
      metadataPolicyId: record.metadataPolicyId,
      projectionContractId: record.projectionContractId,
      reason: `Sanitized whole-history reseed: ${reason}`,
    });
    assert.match(said.join('\n'), /RESEEDING/u);
    assert.equal(said.join('\n').includes(reason), true);
    assert.deepEqual(
      latestPublishedPair(await readSourceLock(fixture.root)),
      record
    );

    // A projection that already fast-forwards must not be forced at all.
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason,
        source: git(fixture.root, ['rev-parse', 'master']),
        log() {},
        ...PASS_RESEED_GATES,
      }),
      /fast-forwards the public remote/u
    );
  } finally {
    fixture.cleanup();
  }
});

for (const gate of ['metadata', 'gitleaks']) {
  test(`a red ${gate} reseed gate leaves public master and source lock untouched`, async () => {
    const fixture = createPrivateFixture(`exawatt-reseed-${gate}-red-`);
    try {
      const remote = fixture.configurePublicRemote(fixture.publicRemote());
      const seed = await seedPublicRemote(fixture, remote);
      git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
      git(seed.destination, ['config', 'user.email', 'outside@example.test']);
      writeFileSync(
        path.join(seed.destination, 'src/a.ts'),
        'export const a = 99;\n'
      );
      git(seed.destination, ['commit', '--quiet', '-am', 'diverge public']);
      git(seed.destination, ['push', '--quiet', remote, 'master:master']);
      const before = git(remote, ['rev-parse', 'master']);
      await assert.rejects(
        reseedPublicRepository({
          root: fixture.root,
          reason: 'the public boundary needs a reviewed rewrite',
          source: git(fixture.root, ['rev-parse', 'master']),
          log() {},
          metadataAudit: async () =>
            gate === 'metadata'
              ? { reseedRequired: true, tags: 0, findings: [{}] }
              : { reseedRequired: false, tags: 0, findings: [] },
          secretScan: async () => (gate === 'gitleaks' ? 1 : 0),
        }),
        gate === 'metadata' ? /metadata gate found/u : /gitleaks gate exited/u
      );
      assert.equal(git(remote, ['rev-parse', 'master']), before);
      assert.deepEqual(await readSourceLock(fixture.root), []);
    } finally {
      fixture.cleanup();
    }
  });
}

test('a public annotated tag blocks a master-only reseed before mutation', async () => {
  const fixture = createPrivateFixture('exawatt-reseed-tag-refusal-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Private Tagger']);
    git(seed.destination, [
      'config',
      'user.email',
      ['private', 'company.com'].join('@'),
    ]);
    git(seed.destination, [
      'tag',
      '-a',
      'private-release',
      '-m',
      'private partner launch',
    ]);
    git(seed.destination, ['push', '--quiet', remote, 'private-release']);
    const before = git(remote, ['rev-parse', 'master']);
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason: 'the public boundary needs a reviewed rewrite',
        source: git(fixture.root, ['rev-parse', 'master']),
        log() {},
        ...PASS_RESEED_GATES,
      }),
      /additional ref/u
    );
    assert.equal(git(remote, ['rev-parse', 'master']), before);
    assert.deepEqual(await readSourceLock(fixture.root), []);
  } finally {
    fixture.cleanup();
  }
});

test('an accepted reseed with interrupted postconditions resumes idempotently', async () => {
  const fixture = createPrivateFixture('exawatt-reseed-intent-resume-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'diverge public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const source = git(fixture.root, ['rev-parse', 'master']);
    const reason = 'the public boundary needs an idempotent reviewed rewrite';
    let audits = 0;
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason,
        source,
        log() {},
        metadataAudit: async () => {
          audits += 1;
          return audits === 1
            ? { reseedRequired: false, tags: 0, findings: [] }
            : { reseedRequired: true, tags: 0, findings: [{}] };
        },
        secretScan: async () => 0,
      }),
      /published remote metadata postcondition/u
    );
    const intent = (await readSourceLock(fixture.root)).at(-1);
    assert.equal(intent.status, 'reseed-intent');
    assert.equal(git(remote, ['rev-parse', 'master']), intent.publicSha);

    const recovered = await reseedPublicRepository({
      root: fixture.root,
      reason,
      source,
      log() {},
      ...PASS_RESEED_GATES,
    });
    assert.equal(recovered.status, 'reseeded');
    assert.equal(recovered.publicSha, intent.publicSha);
    assert.equal(git(remote, ['rev-parse', 'master']), intent.publicSha);
  } finally {
    fixture.cleanup();
  }
});

test('a reseed intent retries its exact lease when the push never reached the remote', async () => {
  const fixture = createPrivateFixture('exawatt-reseed-intent-old-tip-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'diverge public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const oldTip = git(remote, ['rev-parse', 'master']);
    const source = git(fixture.root, ['rev-parse', 'master']);
    const reason = 'the exact reseed lease must survive a client crash';
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason,
        source,
        log() {},
        ...PASS_RESEED_GATES,
        push: async () => {
          throw new Error('injected crash before push');
        },
      }),
      /injected crash before push/u
    );
    const intent = (await readSourceLock(fixture.root)).at(-1);
    assert.equal(intent.status, 'reseed-intent');
    assert.equal(git(remote, ['rev-parse', 'master']), oldTip);
    const recovered = await reseedPublicRepository({
      root: fixture.root,
      reason,
      source,
      log() {},
      ...PASS_RESEED_GATES,
    });
    assert.equal(recovered.publicSha, intent.publicSha);
    assert.equal(git(remote, ['rev-parse', 'master']), intent.publicSha);
  } finally {
    fixture.cleanup();
  }
});

test('a reseed intent refuses a third remote SHA', async () => {
  const fixture = createPrivateFixture('exawatt-reseed-intent-third-tip-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    const seed = await seedPublicRemote(fixture, remote);
    git(seed.destination, ['config', 'user.name', 'Outside Contributor']);
    git(seed.destination, ['config', 'user.email', 'outside@example.test']);
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 99;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'diverge public']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const source = git(fixture.root, ['rev-parse', 'master']);
    const reason = 'a third remote tip must never satisfy the reseed lease';
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason,
        source,
        log() {},
        ...PASS_RESEED_GATES,
        push: async () => {
          throw new Error('injected crash before push');
        },
      })
    );
    writeFileSync(
      path.join(seed.destination, 'src/a.ts'),
      'export const a = 100;\n'
    );
    git(seed.destination, ['commit', '--quiet', '-am', 'third remote tip']);
    git(seed.destination, ['push', '--quiet', remote, 'master:master']);
    const third = git(remote, ['rev-parse', 'master']);
    await assert.rejects(
      reseedPublicRepository({
        root: fixture.root,
        reason,
        source,
        log() {},
        ...PASS_RESEED_GATES,
      }),
      /expected remote .* or .* found/u
    );
    assert.equal(git(remote, ['rev-parse', 'master']), third);
  } finally {
    fixture.cleanup();
  }
});

test('the unrendered summary names what the public repository did not receive', () => {
  assert.equal(describeUnrendered({ unrenderedOutputs: [] }), null);
  assert.match(
    describeUnrendered({
      unrenderedOutputs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    }),
    /did not receive 8 generated outputs: a, b, c, d, e, f, and 2 more/u
  );
});

test('the report names where a rendered path enters public history', () => {
  assert.equal(describeEntryBoundaries({ entryBoundaries: [] }), null);

  // A path that simply predates its recipe is ordinary and is only counted.
  const ordinary = {
    path: 'README.md',
    entryCommit: 'a'.repeat(40),
    skippedRevisions: 12,
    renderableSkipped: 0,
    lastUnrenderableCommit: 'b'.repeat(40),
  };
  assert.match(
    describeEntryBoundaries({ entryBoundaries: [ordinary] }),
    /1 rendered paths enter public history after their first source revision: README\.md enters at aaaaaaaaaaaa, 12 earlier revisions do not carry it$/u
  );

  // A path whose entry MOVED is named first and says what held it back, so an
  // operator reads it instead of finding it in a diff.
  const moved = {
    path: 'AGENTS.md',
    entryCommit: 'c'.repeat(40),
    skippedRevisions: 894,
    renderableSkipped: 14,
    lastUnrenderableCommit: 'd'.repeat(40),
  };
  const described = describeEntryBoundaries({
    entryBoundaries: [ordinary, moved],
  });
  assert.match(
    described,
    /2 rendered paths enter public history after their first source revision: AGENTS\.md enters at cccccccccccc, 894 earlier revisions do not carry it \(14 of them render, held back by dddddddddddd\)$/u
  );
  assert.doesNotMatch(described, /README/u);
});

/**
 * The README is the public repository's front door, and its images and links
 * are RELATIVE, so each one resolves against whatever tree it lands in. That
 * makes it possible to reference a path the private tree has and the public
 * tree never receives: the projection drops it silently, GitHub renders a
 * broken image in the first screenful, and nothing here goes red.
 *
 * That happened on 2026-08-19. The front page's mark pointed at the official
 * `electron/resources/icon-master.png`, which is deliberately withheld from a
 * tree whose builds are community builds. The delivery log named it, in a line
 * about unrelated icon outputs, and a reader could easily miss the one that
 * mattered. So assert it instead of reading for it.
 */
test('every relative README reference survives into the public tree', async () => {
  const readme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');
  const manifest = await readPathManifest(
    path.join(repositoryRoot, OPEN_SOURCE_PATH_MANIFEST)
  );
  const classify = createPathClassifier(manifest);
  const recipeKinds = new Map(
    Object.entries(manifest.recipes).map(([id, recipe]) => [id, recipe.kind])
  );

  const references = new Set();
  for (const [, target] of readme.matchAll(/<img[^>]+src="([^"]+)"/gu)) {
    references.add(target);
  }
  for (const [, target] of readme.matchAll(/\]\(([^)]+)\)/gu)) {
    references.add(target);
  }
  for (const [, target] of readme.matchAll(/<a[^>]+href="([^"]+)"/gu)) {
    references.add(target);
  }

  const relative = [...references].filter(
    target =>
      !/^[a-z]+:/iu.test(target) && !target.startsWith('#') && target !== ''
  );
  assert.ok(
    relative.length > 0,
    'expected the README to carry relative references'
  );

  for (const target of relative) {
    const file = target.split('#')[0];
    assert.ok(
      existsSync(path.join(repositoryRoot, file)),
      `README references ${file}, which does not exist in this repository`
    );
    const { classification, recipe } = classify(file);
    assert.notEqual(
      classification,
      'PRIVATE',
      `README references ${file}, which is PRIVATE and never reaches the public tree`
    );
    assert.notEqual(
      classification,
      'EXCLUDED',
      `README references ${file}, which is EXCLUDED from the public tree`
    );
    if (classification !== 'GENERATED') continue;
    const kind = recipeKinds.get(recipe);
    assert.ok(
      kind,
      `README references ${file}, whose recipe ${recipe} is unknown`
    );
    assert.ok(
      hasRecipeRenderer(kind) && rendersOutput(kind, file),
      `README references ${file}, which is GENERATED but has no renderer, so ` +
        'the public repository never receives it and the link renders broken'
    );
  }
});
