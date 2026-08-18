import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  assertClaGreen,
  parseArgs,
  parseRepositorySlug,
  pullContribution,
} from './contribution-pull.mjs';
import { projectPublicHistory } from './lib/public-projection.mjs';
import {
  FIXTURE_CONTRIBUTOR,
  createPrivateFixture,
  git,
} from './lib/public-repository-fixture.mjs';

/**
 * The inbound half of ENG-030 WP6-D. The "public repository" is a local bare
 * repository and the pull request is a `refs/pull/<n>/head` ref pushed into
 * it, so the whole loop — projection out, contribution in — is proved with no
 * network and no GitHub.
 */

const GREEN = [{ name: 'CLA Assistant', state: 'SUCCESS' }];

/** Publishes the projection of the private tip, as a landing's projector would. */
async function publishProjection(fixture, remote) {
  const projection = await projectPublicHistory({
    sourceRepo: fixture.root,
    sourceSha: git(fixture.root, ['rev-parse', 'master']),
    destination: fixture.at('published'),
  });
  git(projection.destination, ['push', '--quiet', remote, 'master:master']);
  return projection;
}

/** An outside contributor's pull request, opened against the public repository. */
function openPullRequest(
  fixture,
  remote,
  prNumber,
  { file, contents, subject }
) {
  const clone = fixture.at(`contributor-${prNumber}`);
  git(fixture.parent, ['clone', '--quiet', remote, clone]);
  git(clone, ['config', 'user.name', FIXTURE_CONTRIBUTOR.GIT_AUTHOR_NAME]);
  git(clone, ['config', 'user.email', FIXTURE_CONTRIBUTOR.GIT_AUTHOR_EMAIL]);
  writeFileSync(path.join(clone, file), contents);
  git(clone, ['add', '--', file], FIXTURE_CONTRIBUTOR);
  git(clone, ['commit', '--quiet', '-m', subject], FIXTURE_CONTRIBUTOR);
  git(clone, ['push', '--quiet', remote, `HEAD:refs/pull/${prNumber}/head`]);
  return clone;
}

test('the CLA gate refuses absence as loudly as it refuses failure', () => {
  assert.equal(assertClaGreen(GREEN, 4), true);
  assert.equal(
    assertClaGreen([{ name: 'cla/exawatt', state: 'success' }], 4),
    true
  );
  assert.throws(
    () => assertClaGreen([{ name: 'build', state: 'SUCCESS' }], 4),
    /has no CLA check/u
  );
  assert.throws(() => assertClaGreen([], 4), /has no CLA check/u);
  assert.throws(
    () => assertClaGreen([{ name: 'CLA Assistant', state: 'PENDING' }], 4),
    /CLA check is not green/u
  );
  assert.throws(
    () => assertClaGreen([{ name: 'CLA Assistant', state: 'FAILURE' }], 4),
    /CLA check is not green/u
  );
});

test('a pull request whose CLA is not green is refused before anything is fetched', async () => {
  const fixture = createPrivateFixture('exawatt-contribution-cla-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await publishProjection(fixture, remote);
    openPullRequest(fixture, remote, 5, {
      file: 'src/a.ts',
      contents: 'export const a = 5;\n',
      subject: 'contribution: raise a',
    });

    await assert.rejects(
      pullContribution({
        root: fixture.root,
        prNumber: 5,
        fetchChecks: async () => [{ name: 'CLA Assistant', state: 'FAILURE' }],
        log() {},
      }),
      /CLA check is not green/u
    );
    assert.equal(
      git(fixture.root, ['branch', '--list', 'agent/contrib-5']),
      '',
      'a refused contribution creates no branch'
    );
    assert.equal(
      git(fixture.root, ['for-each-ref', 'refs/exawatt/contributions']),
      '',
      'a refused contribution fetches nothing'
    );
  } finally {
    fixture.cleanup();
  }
});

test('an inbound pull request reaches the private tree with its author and message', async () => {
  const fixture = createPrivateFixture('exawatt-contribution-roundtrip-');
  try {
    const remote = fixture.configurePublicRemote(fixture.publicRemote());
    await publishProjection(fixture, remote);
    openPullRequest(fixture, remote, 7, {
      file: 'src/a.ts',
      contents: 'export const a = 11;\n',
      subject: 'contribution: raise a',
    });

    const said = [];
    const result = await pullContribution({
      root: fixture.root,
      prNumber: 7,
      fetchChecks: async () => GREEN,
      worktreePath: fixture.at('contrib-7'),
      log: message => said.push(message),
    });

    assert.equal(result.branch, 'agent/contrib-7');
    assert.equal(result.commits.length, 1);
    assert.equal(
      result.commits[0].author,
      'Outside Contributor <outside@example.test>'
    );
    assert.equal(result.commits[0].subject, 'contribution: raise a');
    assert.equal(
      git(result.worktree, ['log', '-1', '--format=%an <%ae>']),
      'Outside Contributor <outside@example.test>',
      'git am preserves authorship, which is what makes attribution survive'
    );
    assert.equal(
      git(result.worktree, ['show', 'HEAD:src/a.ts']),
      'export const a = 11;'
    );
    // The contribution lands on the PRIVATE tree, overlay and all, so it meets
    // the same floor the operator's own work meets.
    assert.equal(
      git(result.worktree, ['show', 'HEAD:company/secret.md']),
      'private overlay'
    );
    assert.equal(git(result.worktree, ['status', '--porcelain']), '');
    assert.match(said.join('\n'), /pnpm agent:land/u);
  } finally {
    fixture.cleanup();
  }
});

test('a contribution cannot be pulled when no public repository is configured', async () => {
  const fixture = createPrivateFixture('exawatt-contribution-inert-');
  try {
    await assert.rejects(
      pullContribution({
        root: fixture.root,
        prNumber: 9,
        fetchChecks: async () => GREEN,
        log() {},
      }),
      /no public remote is configured/u
    );
    assert.equal(existsSync(fixture.at('exawatt-contrib-9')), false);
  } finally {
    fixture.cleanup();
  }
});

test('the pull-request number and the public repository slug are read strictly', () => {
  assert.deepEqual(parseArgs(['--', '12', '--land']), {
    prNumber: 12,
    land: true,
    help: false,
  });
  assert.throws(() => parseArgs(['12', '13']), /exactly one pull-request/u);
  assert.throws(() => parseArgs(['--wat']), /unknown argument/u);
  assert.equal(
    parseRepositorySlug('git@github.com:Example-Org/example.git'),
    'Example-Org/example'
  );
  assert.equal(
    parseRepositorySlug('https://github.com/Example-Org/example'),
    'Example-Org/example'
  );
  assert.throws(() => parseRepositorySlug('/tmp/public.git'), /owner\/name/u);
});
