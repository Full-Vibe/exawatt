import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  describeUnrendered,
  projectToPublicRemote,
  publicPushArgs,
  resolvePublicRemote,
} from './lib/public-delivery.mjs';
import { projectPublicHistory } from './lib/public-projection.mjs';
import {
  createPrivateFixture,
  git,
  writeFastPnpm,
} from './lib/public-repository-fixture.mjs';
import {
  latestPublishedPair,
  readSourceLock,
  sourceLockPath,
} from './lib/public-source-lock.mjs';
import {
  assertDeliberate,
  reseedPublicRepository,
  reseedPushArgs,
} from './open-source-reseed.mjs';

/**
 * The outbound half of ENG-030 WP6-D, proved against local repositories only.
 * No public repository exists yet; every "public remote" here is a local bare
 * repository under the OS temp directory, and nothing reaches a network.
 */

const execFileAsync = promisify(execFile);
const landScript = fileURLToPath(new URL('./agent-land.mjs', import.meta.url));

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
    assert.equal(records.length, 1);
    const [record] = records;
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
    assert.ok(record.renderedVariants >= 1);
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
    const [record] = await readSourceLock(fixture.root);
    assert.equal(record.status, 'refused');
    assert.match(record.reason, /non-fast-forward/u);
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
    const [record] = await readSourceLock(fixture.root);
    assert.equal(record.status, 'pending');
    assert.equal(record.publicSha, null);
    assert.equal(
      record.privateSha,
      git(fixture.origin, ['rev-parse', 'master'])
    );
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
    });

    assert.equal(record.status, 'reseeded');
    assert.equal(record.reason, reason);
    assert.equal(record.previousPublicSha, divergent);
    assert.equal(git(remote, ['rev-parse', 'master']), record.publicSha);
    assert.match(said.join('\n'), /RESEEDING/u);
    assert.match(
      said.join('\n'),
      new RegExp(reason.replace(/\//gu, '\\/'), 'u')
    );
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
      }),
      /fast-forwards the public remote/u
    );
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
