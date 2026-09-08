import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertFastForward,
  buildProjectionPlan,
  parseFilterRepoCommitMap,
  projectPublicHistory,
  projectPublicCatchup,
  resolveEntryBoundary,
} from './lib/public-projection.mjs';
import { renderRecipeOutput } from './lib/recipe-renderers.mjs';
import {
  findImageMetadataFindings,
  findTextFindings,
  readForbiddenVocabulary,
} from './public-content-scan.mjs';

test('filter-repo many-to-one commit maps choose a deterministic source set', () => {
  const filtered = 'f'.repeat(40);
  const earlier = '1'.repeat(40);
  const later = 'a'.repeat(40);
  const dropped = 'd'.repeat(40);
  const parsed = parseFilterRepoCommitMap(
    [
      'old                                      new',
      `${later} ${filtered}`,
      `${dropped} ${'0'.repeat(40)}`,
      `${earlier} ${filtered}`,
      '',
    ].join('\n')
  );
  assert.deepEqual(parsed.get(filtered), [earlier, later]);
  assert.equal(parsed.has('0'.repeat(40)), false);
});

/**
 * Every fixture is a local repository under a temp directory and the "public
 * remote" is a local bare repository. Nothing here touches a network or a real
 * public repository: none exists yet, and the projector must be provable
 * before one does.
 */

const AUTHOR = {
  GIT_AUTHOR_NAME: 'Fixture Author',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00+00:00',
  GIT_COMMITTER_NAME: 'Fixture Author',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00',
};

const CONTRIBUTOR = {
  GIT_AUTHOR_NAME: 'Outside Contributor',
  GIT_AUTHOR_EMAIL: 'outside@example.test',
  GIT_AUTHOR_DATE: '2026-02-02T00:00:00+00:00',
  GIT_COMMITTER_NAME: 'Outside Contributor',
  GIT_COMMITTER_EMAIL: 'outside@example.test',
  GIT_COMMITTER_DATE: '2026-02-02T00:00:00+00:00',
};

/**
 * Repository scripts and Git both read ambient configuration, so the child
 * environment is stated rather than inherited (see suite-environment.test.mjs).
 */
function gitEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: 'en_US.UTF-8',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    ...AUTHOR,
    ...extra,
  };
}

function git(cwd, args, extra = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: gitEnv(extra),
  }).trim();
}

const MANIFEST_PATH = 'scripts/open-source-paths.manifest.json';
const WORKFLOW = '.github/workflows/ci.yml';

const MANIFEST = {
  schemaVersion: 1,
  rules: [
    { id: 'public-src', classification: 'PUBLIC', include: ['src/**'] },
    { id: 'public-scripts', classification: 'PUBLIC', include: ['scripts/**'] },
    { id: 'public-readme', classification: 'PUBLIC', include: ['README.md'] },
    {
      id: 'private-company',
      classification: 'PRIVATE',
      include: ['company/**'],
    },
  ],
  exceptions: [
    {
      path: 'src/config.private.ts',
      classification: 'PRIVATE',
      reason: 'carries operator identity',
    },
    {
      path: 'src/config.ts',
      classification: 'GENERATED',
      recipe: 'public-config',
      reason: 'identity-free public configuration',
    },
    {
      path: '.github/workflows/ci.yml',
      classification: 'GENERATED',
      recipe: 'public-ci',
      reason: 'public CI is secretless and least privilege',
    },
  ],
  recipes: {
    // No renderer: the fixture keeps one recipe on the unrendered side so the
    // projection is proved to exclude AND report it, not silently drop it.
    'public-config': {
      kind: 'render-public-launch-pages',
      inputs: ['src/config.private.ts'],
      outputs: [{ path: 'src/config.ts', mode: '100644' }],
    },
    'public-ci': {
      kind: 'render-public-ci',
      inputs: ['.github/workflows/ci.yml'],
      outputs: [{ path: '.github/workflows/ci.yml', mode: '100644' }],
    },
  },
};

/**
 * The private workflow, with the public-variant directives a private file uses
 * to declare how its public variant differs from it.
 */
function workflow(timeout) {
  return [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    # exawatt:public-replace-begin the batch ref is private',
    '    branches: [ci-batches/master]',
    '    # exawatt:public-replace-with',
    '    # branches: [master]',
    '    # exawatt:public-replace-end',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
    '  test:',
    '    runs-on: ubuntu-latest',
    `    timeout-minutes: ${timeout}`,
    '',
  ].join('\n');
}

const PRIVATE_PATHS = ['company/secret.md', 'src/config.private.ts'];
const EXPECTED_COPIED_PATHS = [
  'README.md',
  'scripts/open-source-paths.manifest.json',
  'src/a.ts',
  'src/b.ts',
];
const EXPECTED_PUBLIC_PATHS = [
  '.github/workflows/ci.yml',
  ...EXPECTED_COPIED_PATHS,
];

function write(root, file, contents) {
  const absolute = path.join(root, file);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, contents);
}

/**
 * A four-commit source repository. The second commit touches nothing public,
 * so a faithful projection must drop it; the two that add and edit a public
 * file must survive under their own authorship.
 */
function sourceFixture() {
  const parent = mkdtempSync(path.join(tmpdir(), 'exawatt-projection-test-'));
  const source = path.join(parent, 'source');
  mkdirSync(source);
  git(source, ['init', '--quiet', '--initial-branch=master', '.']);

  write(source, 'README.md', '# fixture\n');
  write(source, MANIFEST_PATH, JSON.stringify(MANIFEST, null, 2) + '\n');
  write(source, 'src/a.ts', 'export const a = 1;\n');
  write(source, 'src/config.private.ts', 'export const operator = "op";\n');
  write(source, 'src/config.ts', 'export const operator = null;\n');
  write(source, 'company/secret.md', 'private overlay\n');
  write(source, '.github/workflows/ci.yml', workflow(25));
  git(source, [
    'add',
    '--',
    'README.md',
    MANIFEST_PATH,
    'src',
    'company',
    '.github',
  ]);
  git(source, ['commit', '--quiet', '-m', 'root']);

  write(source, 'company/secret.md', 'private overlay, revised\n');
  git(source, ['add', '--', 'company/secret.md']);
  git(source, ['commit', '--quiet', '-m', 'private only']);

  write(source, 'src/b.ts', 'export const b = 2;\n');
  write(source, 'README.md', '# fixture\n\nsecond commit\n');
  git(source, ['add', '--', 'src/b.ts', 'README.md']);
  git(source, ['commit', '--quiet', '-m', 'add public file']);
  const earlier = git(source, ['rev-parse', 'HEAD']);

  write(source, 'src/a.ts', 'export const a = 11;\n');
  // The workflow changes too, so the rendered variant has to be recomputed for
  // a second source blob rather than rendered once at the tip.
  write(source, '.github/workflows/ci.yml', workflow(45));
  git(source, ['add', '--', 'src/a.ts', '.github/workflows/ci.yml']);
  git(source, ['commit', '--quiet', '-m', 'edit public file']);
  const head = git(source, ['rev-parse', 'HEAD']);

  return {
    parent,
    source,
    earlier,
    head,
    at: name => path.join(parent, name),
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

test('the same source commit always projects to the same public commit', async () => {
  const fixture = sourceFixture();
  try {
    const first = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
    });
    const second = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
    });
    assert.equal(
      first.publicSha,
      second.publicSha,
      'projection must be a pure function of source history'
    );
    assert.equal(first.planDigest, second.planDigest);
    assert.match(first.publicSha, /^[0-9a-f]{40}$/u);
  } finally {
    fixture.cleanup();
  }
});

test('an earlier source commit projects to an ancestor of the later projection', async () => {
  const fixture = sourceFixture();
  try {
    const earlier = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.earlier,
      destination: fixture.at('earlier'),
    });
    const later = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('later'),
    });
    assert.notEqual(earlier.publicSha, later.publicSha);

    git(later.destination, [
      'fetch',
      '--quiet',
      '--no-tags',
      earlier.destination,
      'master:refs/remotes/earlier/master',
    ]);
    assert.equal(
      await assertFastForward({
        repo: later.destination,
        candidateSha: later.publicSha,
        existingRef: 'refs/remotes/earlier/master',
      }),
      true
    );

    // The later projection is the earlier one plus exactly the source commits
    // that touched a public path; the private-only commit never appears.
    assert.equal(
      git(later.destination, ['rev-list', '--count', 'master']),
      '3'
    );
    const messages = git(later.destination, ['log', '--format=%s', 'master']);
    assert.equal(
      messages.split('\n').every(message => message.startsWith('public: ')),
      true
    );
    assert.doesNotMatch(messages, /private only|add public file|root/u);
  } finally {
    fixture.cleanup();
  }
});

test('the published prefix survives public add, edit, rename, delete, and revert', async () => {
  const fixture = sourceFixture();
  try {
    const epochProjection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('epoch'),
      epoch: null,
    });
    const epoch = {
      schemaVersion: 1,
      sourceSha: fixture.head,
      publicSha: epochProjection.publicSha,
      metadataPolicyId: epochProjection.metadataAudit.policyId,
      projectionContractId: epochProjection.projectionContractId,
      reason: 'fixture boundary before forward public file lifecycle changes',
    };

    const revisions = [];
    write(fixture.source, 'src/lifecycle.ts', 'export const lifecycle = 1;\n');
    git(fixture.source, ['add', '--', 'src/lifecycle.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'add lifecycle']);
    revisions.push(git(fixture.source, ['rev-parse', 'HEAD']));

    write(fixture.source, 'src/lifecycle.ts', 'export const lifecycle = 2;\n');
    git(fixture.source, ['add', '--', 'src/lifecycle.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'edit lifecycle']);
    revisions.push(git(fixture.source, ['rev-parse', 'HEAD']));

    git(fixture.source, ['mv', 'src/lifecycle.ts', 'src/renamed.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'rename lifecycle']);
    revisions.push(git(fixture.source, ['rev-parse', 'HEAD']));

    git(fixture.source, ['rm', '--quiet', 'src/renamed.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'delete lifecycle']);
    revisions.push(git(fixture.source, ['rev-parse', 'HEAD']));

    git(fixture.source, ['revert', '--quiet', '--no-edit', 'HEAD']);
    revisions.push(git(fixture.source, ['rev-parse', 'HEAD']));

    let previous = epochProjection.destination;
    for (const [index, sourceSha] of revisions.entries()) {
      const projection = await projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha,
        destination: fixture.at(`lifecycle-${index}`),
        epoch,
      });
      git(projection.destination, [
        'fetch',
        '--quiet',
        '--no-tags',
        previous,
        'master:refs/remotes/previous/master',
      ]);
      assert.equal(
        await assertFastForward({
          repo: projection.destination,
          candidateSha: projection.publicSha,
          existingRef: 'refs/remotes/previous/master',
        }),
        true
      );
      previous = projection.destination;
    }

    const final = fixture.at(`lifecycle-${revisions.length - 1}`);
    assert.equal(
      git(final, ['show', 'master:src/renamed.ts']),
      'export const lifecycle = 2;'
    );
    assert.equal(
      git(final, ['rev-list', '--count', 'master', '--', 'src/lifecycle.ts']),
      '3',
      'the original path keeps its add, edit, and rename history'
    );
    assert.equal(
      git(final, ['rev-list', '--count', 'master', '--', 'src/renamed.ts']),
      '3',
      'the renamed path keeps its rename, deletion, and restoration history'
    );
  } finally {
    fixture.cleanup();
  }
});

test('continuous projection refuses an unreviewed merge DAG', async () => {
  const fixture = sourceFixture();
  try {
    const epochProjection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      epoch: null,
    });
    const epoch = {
      schemaVersion: 1,
      sourceSha: fixture.head,
      publicSha: epochProjection.publicSha,
      metadataPolicyId: epochProjection.metadataAudit.policyId,
      projectionContractId: epochProjection.projectionContractId,
      reason: 'fixture boundary before a merge enters private master',
    };
    git(fixture.source, ['checkout', '--quiet', '-b', 'feature']);
    write(fixture.source, 'src/feature.ts', 'export const feature = 1;\n');
    git(fixture.source, ['add', '--', 'src/feature.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'feature side']);
    git(fixture.source, ['checkout', '--quiet', 'master']);
    write(fixture.source, 'src/master.ts', 'export const master = 1;\n');
    git(fixture.source, ['add', '--', 'src/master.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'master side']);
    git(fixture.source, [
      'merge',
      '--quiet',
      '--no-ff',
      '-m',
      'merge feature',
      'feature',
    ]);
    await assert.rejects(
      projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha: git(fixture.source, ['rev-parse', 'HEAD']),
        epoch,
      }),
      /requires a linear private master/u
    );
  } finally {
    fixture.cleanup();
  }
});

test('manifest reclassification is forward-only after the public epoch', async () => {
  const fixture = sourceFixture();
  try {
    const epochProjection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('reclassification-epoch'),
      epoch: null,
    });
    const epoch = {
      schemaVersion: 1,
      sourceSha: fixture.head,
      publicSha: epochProjection.publicSha,
      metadataPolicyId: epochProjection.metadataAudit.policyId,
      projectionContractId: epochProjection.projectionContractId,
      reason: 'fixture boundary before forward-only classification changes',
    };
    const manifest = structuredClone(MANIFEST);
    manifest.exceptions = manifest.exceptions
      .filter(exception => exception.path !== 'src/config.private.ts')
      .concat({
        path: 'src/a.ts',
        classification: 'PRIVATE',
        reason: 'fixture path becomes private from this commit forward',
      });
    write(
      fixture.source,
      MANIFEST_PATH,
      JSON.stringify(manifest, null, 2) + '\n'
    );
    git(fixture.source, ['add', '--', MANIFEST_PATH]);
    git(fixture.source, ['commit', '--quiet', '-m', 'reclassify paths']);
    const sourceSha = git(fixture.source, ['rev-parse', 'HEAD']);

    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha,
      destination: fixture.at('reclassified'),
      epoch,
    });
    git(projection.destination, [
      'fetch',
      '--quiet',
      '--no-tags',
      epochProjection.destination,
      'master:refs/remotes/epoch/master',
    ]);
    assert.equal(
      await assertFastForward({
        repo: projection.destination,
        candidateSha: projection.publicSha,
        existingRef: 'refs/remotes/epoch/master',
      }),
      true
    );
    assert.equal(
      git(projection.destination, [
        'ls-tree',
        '--name-only',
        'master',
        'src/a.ts',
      ]),
      '',
      'PUBLIC to PRIVATE removes the tip copy'
    );
    assert.equal(
      git(projection.destination, ['show', 'master:src/config.private.ts']),
      'export const operator = "op";'
    );
    assert.equal(
      git(projection.destination, [
        'rev-list',
        '--count',
        'master',
        '--',
        'src/config.private.ts',
      ]),
      '1',
      'PRIVATE history is not exposed when a path becomes PUBLIC'
    );
    assert.equal(
      git(projection.destination, [
        'rev-list',
        '--count',
        'master',
        '--',
        'src/a.ts',
      ]),
      '3',
      'already-public history stays reachable after the tip removes the path'
    );
  } finally {
    fixture.cleanup();
  }
});

test('unreviewed source identity, trailers, and business prose cannot survive replay', async () => {
  const fixture = sourceFixture();
  try {
    const epochProjection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('metadata-epoch'),
      epoch: null,
    });
    const epoch = {
      schemaVersion: 1,
      sourceSha: fixture.head,
      publicSha: epochProjection.publicSha,
      metadataPolicyId: epochProjection.metadataAudit.policyId,
      projectionContractId: epochProjection.projectionContractId,
      reason: 'fixture boundary before adversarial source metadata is added',
    };
    write(fixture.source, 'src/b.ts', 'export const b = 222;\n');
    git(fixture.source, ['add', '--', 'src/b.ts']);
    git(
      fixture.source,
      [
        'commit',
        '--quiet',
        '-m',
        [
          'Launch for ConfidentialPartner',
          '',
          'Co-authored-by: Private Person <private@customer.test>',
        ].join('\n'),
      ],
      {
        GIT_AUTHOR_NAME: 'Private Person',
        GIT_AUTHOR_EMAIL: 'operator@private.test',
        GIT_COMMITTER_NAME: 'Private Committer',
        GIT_COMMITTER_EMAIL: 'committer@private.test',
      }
    );
    const sourceSha = git(fixture.source, ['rev-parse', 'HEAD']);
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha,
      destination: fixture.at('metadata-public'),
      epoch,
    });
    const metadata = git(projection.destination, [
      'log',
      '-1',
      '--format=%an%x00%ae%x00%cn%x00%ce%x00%B',
    ]);
    assert.match(
      metadata,
      /Exawatt Public Projector\u0000public-projection@exawatt\.invalid/u
    );
    assert.match(metadata, /public: update src/u);
    assert.doesNotMatch(
      metadata,
      /Private Person|Private Committer|private\.test|customer\.test|ConfidentialPartner/u
    );
    assert.equal(
      git(projection.destination, ['show', 'master:src/b.ts']),
      'export const b = 222;'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a reseed sanitizes every surviving pre-epoch commit and excludes source tags', async () => {
  const fixture = sourceFixture();
  try {
    const partnerEmail = ['partner', 'stealth-customer.com'].join('@');
    const founderEmail = ['founder', 'stealth-customer.com'].join('@');
    const operatorEmail = ['operator', 'private-company.com'].join('@');
    const taggerEmail = ['tagger', 'private-company.com'].join('@');
    write(fixture.source, 'src/pre-epoch.ts', 'export const preEpoch = 1;\n');
    git(fixture.source, ['add', '--', 'src/pre-epoch.ts']);
    git(
      fixture.source,
      [
        'commit',
        '--quiet',
        '-m',
        [
          'ConfidentialPartner acquisition terms',
          '',
          `Co-authored-by: Private Partner <${partnerEmail}>`,
        ].join('\n'),
      ],
      {
        GIT_AUTHOR_NAME: 'Private Founder',
        GIT_AUTHOR_EMAIL: founderEmail,
        GIT_COMMITTER_NAME: 'Private Operator',
        GIT_COMMITTER_EMAIL: operatorEmail,
      }
    );
    const epochSourceSha = git(fixture.source, ['rev-parse', 'HEAD']);
    git(
      fixture.source,
      [
        'tag',
        '-a',
        'private-launch',
        '-m',
        `ConfidentialPartner launch with ${partnerEmail}`,
      ],
      {
        GIT_COMMITTER_NAME: 'Private Tagger',
        GIT_COMMITTER_EMAIL: taggerEmail,
      }
    );
    const legacyEpoch = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: epochSourceSha,
      epoch: null,
    });

    write(fixture.source, 'src/post-epoch.ts', 'export const postEpoch = 1;\n');
    git(fixture.source, ['add', '--', 'src/post-epoch.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'post epoch']);
    const sourceSha = git(fixture.source, ['rev-parse', 'HEAD']);
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha,
      destination: fixture.at('sanitized-reseed'),
      epoch: {
        schemaVersion: 1,
        sourceSha: epochSourceSha,
        publicSha: legacyEpoch.publicSha,
        metadataPolicyId: legacyEpoch.metadataAudit.policyId,
        projectionContractId: legacyEpoch.projectionContractId,
        reason: 'fixture boundary after private metadata entered history',
      },
      rebuildHistory: true,
    });

    assert.equal(projection.rebuiltHistory, true);
    assert.equal(projection.metadataAudit.findings.length, 0);
    assert.equal(projection.metadataAudit.tags, 0);
    assert.equal(
      git(projection.destination, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/tags',
      ]),
      ''
    );
    const reachableMetadata = git(projection.destination, [
      'log',
      '--format=%an%x00%ae%x00%cn%x00%ce%x00%B',
      'master',
    ]);
    assert.doesNotMatch(
      reachableMetadata,
      /Private Founder|Private Operator|Private Partner|private-company\.com|stealth-customer\.com|ConfidentialPartner/u
    );
    assert.match(
      reachableMetadata,
      /Exawatt Public Projector\u0000public-projection@exawatt\.invalid/u
    );
    assert.equal(
      git(projection.destination, ['show', 'master:src/pre-epoch.ts']),
      'export const preEpoch = 1;'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a reseed pair bridges one private epoch update, then fresh projection appends', async () => {
  const fixture = sourceFixture();
  try {
    const reseedSourceSha = fixture.head;
    const rebuilt = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: reseedSourceSha,
      destination: fixture.at('reseed-candidate'),
      rebuildHistory: true,
    });
    const publicRemote = fixture.at('reseed-public.git');
    git(fixture.parent, [
      'init',
      '--quiet',
      '--bare',
      '--initial-branch=master',
      publicRemote,
    ]);
    git(rebuilt.destination, [
      'push',
      '--quiet',
      publicRemote,
      'master:master',
    ]);

    const epoch = {
      schemaVersion: 1,
      sourceSha: reseedSourceSha,
      publicSha: rebuilt.publicSha,
      metadataPolicyId: rebuilt.metadataAudit.policyId,
      projectionContractId: rebuilt.projectionContractId,
      reason: 'Sanitized whole-history reseed reviewed by the operator',
    };
    write(
      fixture.source,
      'company/reseed-epoch.json',
      JSON.stringify(epoch, null, 2) + '\n'
    );
    git(fixture.source, ['add', '--', 'company/reseed-epoch.json']);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'record sanitized public epoch',
    ]);
    const epochCommit = git(fixture.source, ['rev-parse', 'HEAD']);
    const bridged = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: epochCommit,
      destination: fixture.at('epoch-bridge'),
      fastForwardFrom: { repository: publicRemote, ref: 'master' },
      resumeFrom: {
        privateSha: reseedSourceSha,
        publicSha: rebuilt.publicSha,
        metadataPolicyId: rebuilt.metadataAudit.policyId,
        projectionContractId: rebuilt.projectionContractId,
      },
    });
    assert.equal(bridged.publicSha, rebuilt.publicSha);
    assert.equal(bridged.emittedCommits, 0);
    assert.equal(bridged.existingPublicSha, rebuilt.publicSha);

    write(fixture.source, 'src/after-reseed.ts', 'export const after = 1;\n');
    git(fixture.source, ['add', '--', 'src/after-reseed.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'after reseed']);
    const afterSourceSha = git(fixture.source, ['rev-parse', 'HEAD']);
    const fresh = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: afterSourceSha,
      destination: fixture.at('fresh-after-epoch'),
      fastForwardFrom: { repository: publicRemote, ref: 'master' },
      epoch,
    });
    assert.notEqual(fresh.publicSha, rebuilt.publicSha);
    assert.equal(fresh.existingPublicSha, rebuilt.publicSha);
    assert.equal(
      git(fresh.destination, [
        'merge-base',
        '--is-ancestor',
        rebuilt.publicSha,
        fresh.publicSha,
      ]),
      ''
    );
    assert.equal(
      git(fresh.destination, ['show', 'master:src/after-reseed.ts']),
      'export const after = 1;'
    );
  } finally {
    fixture.cleanup();
  }
});

test('the projected tree is exactly Gate A’s PUBLIC output set', async () => {
  const fixture = sourceFixture();
  try {
    const plan = await buildProjectionPlan({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
    });
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });

    assert.deepEqual(plan.copiedPaths, EXPECTED_COPIED_PATHS);
    assert.deepEqual(projection.projectedPaths, EXPECTED_PUBLIC_PATHS);
    assert.equal(projection.outputCount, EXPECTED_PUBLIC_PATHS.length);

    // No commit anywhere in the projected history may carry a PRIVATE path,
    // not just the tip.
    const everyPath = new Set(
      git(projection.destination, [
        'log',
        '--all',
        '--pretty=format:',
        '--name-only',
      ])
        .split('\n')
        .filter(Boolean)
    );
    for (const privatePath of PRIVATE_PATHS) {
      assert.equal(
        everyPath.has(privatePath),
        false,
        `${privatePath} is PRIVATE and must never appear in the projection`
      );
    }
    assert.deepEqual([...everyPath].sort(), EXPECTED_PUBLIC_PATHS);

    // A GENERATED output with no renderer is reported and excluded, never
    // projected from the private blob.
    assert.deepEqual(
      projection.unrenderedOutputs.map(output => output.path),
      ['src/config.ts']
    );
    assert.match(
      projection.unrenderedOutputs[0].reason,
      /legal statements about one operator/u
    );
    assert.equal(everyPath.has('src/config.ts'), false);

    // A GENERATED output WITH a renderer is substituted into the projection.
    assert.deepEqual(
      projection.renderedOutputs.map(output => output.path),
      ['.github/workflows/ci.yml']
    );
    assert.equal(everyPath.has('.github/workflows/ci.yml'), true);
  } finally {
    fixture.cleanup();
  }
});

test('a commit made in the projection applies back to the private tree with its author', async () => {
  const fixture = sourceFixture();
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });

    write(projection.destination, 'src/b.ts', 'export const b = 22;\n');
    git(projection.destination, ['add', '--', 'src/b.ts'], CONTRIBUTOR);
    git(
      projection.destination,
      ['commit', '--quiet', '-m', 'contribution: raise b'],
      CONTRIBUTOR
    );

    const patchDirectory = fixture.at('patches');
    git(projection.destination, [
      'format-patch',
      '--quiet',
      '-1',
      '-o',
      patchDirectory,
    ]);
    const patch = path.join(patchDirectory, '0001-contribution-raise-b.patch');

    const inbound = fixture.at('inbound');
    git(fixture.parent, ['clone', '--quiet', fixture.source, inbound]);
    git(inbound, ['am', '--3way', patch]);

    assert.equal(
      git(inbound, ['log', '-1', '--format=%an <%ae>']),
      'Outside Contributor <outside@example.test>'
    );
    assert.equal(
      git(inbound, ['log', '-1', '--format=%s']),
      'contribution: raise b'
    );
    assert.equal(
      git(inbound, ['show', 'HEAD:src/b.ts']),
      'export const b = 22;'
    );
    // The private-only path is untouched by the inbound patch.
    assert.equal(
      git(inbound, ['show', 'HEAD:company/secret.md']),
      'private overlay, revised'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a public remote that is not an ancestor is refused, never forced', async () => {
  const fixture = sourceFixture();
  try {
    const publicRemote = fixture.at('public.git');
    git(fixture.parent, [
      'init',
      '--quiet',
      '--bare',
      '--initial-branch=master',
      publicRemote,
    ]);

    // A fast-forwarding remote is accepted: the public repo holds the
    // projection of an earlier source commit.
    const earlier = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.earlier,
      destination: fixture.at('earlier'),
    });
    git(earlier.destination, [
      'push',
      '--quiet',
      publicRemote,
      'master:master',
    ]);

    const accepted = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('accepted'),
      fastForwardFrom: { repository: publicRemote, ref: 'master' },
    });
    assert.equal(accepted.existingPublicSha, earlier.publicSha);

    // Now the public remote acquires a commit the projection does not contain,
    // exactly as a human merge into public master would.
    write(earlier.destination, 'src/a.ts', 'export const a = 99;\n');
    git(earlier.destination, ['add', '--', 'src/a.ts'], CONTRIBUTOR);
    git(
      earlier.destination,
      ['commit', '--quiet', '-m', 'merged straight into public'],
      CONTRIBUTOR
    );
    git(earlier.destination, [
      'push',
      '--quiet',
      publicRemote,
      'master:master',
    ]);
    const divergent = git(publicRemote, ['rev-parse', 'master']);

    await assert.rejects(
      projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha: fixture.head,
        destination: fixture.at('refused'),
        fastForwardFrom: { repository: publicRemote, ref: 'master' },
      }),
      /refusing a non-fast-forward projection/u
    );
    // The refusal leaves the remote untouched and writes no destination.
    assert.equal(git(publicRemote, ['rev-parse', 'master']), divergent);
    assert.throws(
      () => git(fixture.at('refused'), ['rev-parse', 'HEAD']),
      'a refused projection must not leave a repository behind'
    );

    // The standalone guard refuses the same relationship on its own.
    git(accepted.destination, [
      'fetch',
      '--quiet',
      '--no-tags',
      publicRemote,
      'master:refs/remotes/public/master',
    ]);
    await assert.rejects(
      assertFastForward({
        repo: accepted.destination,
        candidateSha: accepted.publicSha,
        existingRef: 'refs/remotes/public/master',
      }),
      /refusing a non-fast-forward projection/u
    );
    assert.equal(
      await assertFastForward({
        repo: accepted.destination,
        candidateSha: accepted.publicSha,
        existingRef: null,
      }),
      true,
      'an empty public remote has nothing to fast-forward past'
    );
  } finally {
    fixture.cleanup();
  }
});

test('an empty public remote is projected without a fast-forward refusal', async () => {
  const fixture = sourceFixture();
  try {
    const publicRemote = fixture.at('empty.git');
    git(fixture.parent, [
      'init',
      '--quiet',
      '--bare',
      '--initial-branch=master',
      publicRemote,
    ]);
    const seed = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('seed'),
      fastForwardFrom: { repository: publicRemote, ref: 'master' },
    });
    assert.equal(seed.existingPublicSha, null);
    assert.equal(seed.outputCount, EXPECTED_PUBLIC_PATHS.length);
  } finally {
    fixture.cleanup();
  }
});

test('a rendered GENERATED path carries the recipe’s bytes, not the private blob', async () => {
  const fixture = sourceFixture();
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });

    // Every commit that ever carried the workflow carries the RENDERED variant
    // of the blob it had AT THAT COMMIT. Checking the whole history is the
    // point: a projector that rendered once at the tip would pass a tip-only
    // assertion and publish stale bytes for every earlier commit.
    const commits = git(projection.destination, [
      'rev-list',
      'master',
      '--',
      WORKFLOW,
    ]).split('\n');
    assert.equal(commits.length, 2, 'both workflow revisions must survive');

    const projected = commits
      .map(commit =>
        git(projection.destination, ['show', `${commit}:${WORKFLOW}`])
      )
      .sort();
    const expected = [25, 45]
      .map(timeout =>
        renderRecipeOutput({
          recipeId: 'public-ci',
          kind: 'render-public-ci',
          path: WORKFLOW,
          source: Buffer.from(workflow(timeout), 'utf8'),
        })
          .toString('utf8')
          .trim()
      )
      .sort();
    assert.deepEqual(projected, expected);

    for (const variant of projected) {
      assert.match(variant, /Generated for the public repository/u);
      assert.match(variant, /branches: \[master\]/u);
      assert.doesNotMatch(variant, /ci-batches\/master/u);
      assert.doesNotMatch(variant, /exawatt:public-/u);
    }
    assert.notEqual(
      git(fixture.source, ['show', `master:${WORKFLOW}`]),
      projected[0],
      'the private blob must never be the projected blob'
    );
  } finally {
    fixture.cleanup();
  }
});

test('rendering is deterministic: the same source projects to the same blob', async () => {
  const fixture = sourceFixture();
  try {
    const first = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('first'),
    });
    const second = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('second'),
    });
    assert.equal(first.publicSha, second.publicSha);
    assert.equal(
      git(first.destination, ['rev-parse', `master:${WORKFLOW}`]),
      git(second.destination, ['rev-parse', `master:${WORKFLOW}`]),
      'a rendered blob must hash identically across independent runs'
    );
    assert.equal(first.renderedVariants, second.renderedVariants);
    assert.equal(first.renderedVariants, 2, 'one render per distinct source');
  } finally {
    fixture.cleanup();
  }
});

test('an earlier projection stays an ancestor once GENERATED paths are rendered', async () => {
  const fixture = sourceFixture();
  try {
    const earlier = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.earlier,
      destination: fixture.at('earlier'),
    });
    const later = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('later'),
    });
    git(later.destination, [
      'fetch',
      '--quiet',
      '--no-tags',
      earlier.destination,
      'master:refs/remotes/earlier/master',
    ]);
    assert.equal(
      await assertFastForward({
        repo: later.destination,
        candidateSha: later.publicSha,
        existingRef: 'refs/remotes/earlier/master',
      }),
      true,
      'substitution must not re-parent the public history'
    );
  } finally {
    fixture.cleanup();
  }
});

test('every rendered output passes the checks the content gate applies', async () => {
  const fixture = sourceFixture();
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });
    const forbiddenVocabulary = await readForbiddenVocabulary(
      process.env.EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE
    );

    const findings = [];
    for (const output of projection.renderedOutputs) {
      const bytes = execFileSync('git', ['show', `master:${output.path}`], {
        cwd: projection.destination,
        env: gitEnv(),
        maxBuffer: 64 * 1024 * 1024,
      });
      findings.push(...findImageMetadataFindings(bytes, output.path));
      findings.push(
        ...findTextFindings(
          bytes.toString('utf8'),
          output.path,
          forbiddenVocabulary
        )
      );
    }
    assert.deepEqual(
      findings,
      [],
      'a rendered output must not carry anything Gate B would reject'
    );
  } finally {
    fixture.cleanup();
  }
});

/**
 * The same workflow carrying something the renderer refuses. A file acquiring
 * private material before it declares how its public variant differs is the
 * ordinary shape here, not an exotic one: `AGENTS.md` rendered for 96 commits
 * before the repository had a private research convention to hide, and
 * `electron-builder.yml` rendered before it had an update feed.
 */
function unrenderableWorkflow(timeout) {
  return workflow(timeout).replace(
    'jobs:',
    ['jobs:', '  # env:', '  #   TOKEN: ${{ secrets.PUBLISH_TOKEN }}'].join(
      '\n'
    )
  );
}

/**
 * A source repository whose rendered path renders, stops rendering, and
 * renders again. Each entry of `revisions` is `[message, workflow]` and
 * becomes one commit; the root also carries the public and private paths the
 * manifest classifies, so Gate A has something to project.
 */
function gapFixture(revisions) {
  const parent = mkdtempSync(path.join(tmpdir(), 'exawatt-projection-gap-'));
  const source = path.join(parent, 'source');
  mkdirSync(source);
  git(source, ['init', '--quiet', '--initial-branch=master', '.']);

  write(source, 'README.md', '# fixture\n');
  write(source, MANIFEST_PATH, JSON.stringify(MANIFEST, null, 2) + '\n');
  write(source, 'src/a.ts', 'export const a = 1;\n');
  write(source, 'src/config.private.ts', 'export const operator = "op";\n');
  write(source, 'src/config.ts', 'export const operator = null;\n');
  write(source, 'company/secret.md', 'private overlay\n');
  write(source, WORKFLOW, revisions[0][1]);
  git(source, [
    'add',
    '--',
    'README.md',
    MANIFEST_PATH,
    'src',
    'company',
    '.github',
  ]);
  git(source, ['commit', '--quiet', '-m', revisions[0][0]]);
  const commits = [git(source, ['rev-parse', 'HEAD'])];

  for (const [message, contents] of revisions.slice(1)) {
    write(source, WORKFLOW, contents);
    git(source, ['add', '--', WORKFLOW]);
    git(source, ['commit', '--quiet', '-m', message]);
    commits.push(git(source, ['rev-parse', 'HEAD']));
  }

  return {
    parent,
    source,
    commits,
    head: commits.at(-1),
    at: name => path.join(parent, name),
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

const GAP_REVISIONS = [
  ['root', workflow(25)],
  ['the workflow gains a secret', unrenderableWorkflow(30)],
  ['the secret is declared', workflow(35)],
  ['a later edit', workflow(45)],
];

test('a path that renders, fails, then renders again enters after the last failure', async () => {
  const fixture = gapFixture(GAP_REVISIONS);
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });

    // Entry is taken from the END of history. First-success entry would have
    // published the root's variant, then had nothing to replace it with at
    // the failing revision, and the public repository would carry a stale
    // variant of a file the source had already changed.
    assert.equal(
      git(projection.destination, [
        'log',
        '--format=%H',
        'master',
        '--diff-filter=A',
        '--',
        WORKFLOW,
      ]).split('\n').length,
      1,
      'the public file must enter after the last revision that cannot render'
    );
    assert.equal(
      git(projection.destination, [
        'log',
        '--format=%s',
        '--diff-filter=D',
        'master',
        '--',
        WORKFLOW,
      ]),
      '',
      'a public file must never vanish once it has appeared'
    );
    // No stale variant: each public revision is the render of the source blob
    // at its own commit, not of an earlier one.
    const publicRevisions = git(projection.destination, [
      'log',
      '--reverse',
      '--format=%H',
      'master',
      '--',
      WORKFLOW,
    ]).split('\n');
    assert.equal(
      publicRevisions.length,
      2,
      'every revision from the boundary on carries its own rendered bytes'
    );
    for (const [index, [, contents]] of GAP_REVISIONS.slice(2).entries()) {
      const commit = publicRevisions[index];
      assert.equal(
        git(projection.destination, ['show', `${commit}:${WORKFLOW}`]),
        renderRecipeOutput({
          recipeId: 'public-ci',
          kind: 'render-public-ci',
          path: WORKFLOW,
          source: Buffer.from(contents, 'utf8'),
        })
          .toString('utf8')
          .trim()
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test('a moved entry boundary is reported, not left to be found in a diff', async () => {
  const fixture = gapFixture(GAP_REVISIONS);
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
    });

    assert.equal(projection.skippedRevisions, 2);
    assert.equal(projection.entryBoundaries.length, 1);
    const [boundary] = projection.entryBoundaries;
    assert.equal(boundary.path, WORKFLOW);
    assert.equal(boundary.recipe, 'public-ci');
    assert.equal(boundary.revisions, 4);
    assert.equal(boundary.entryCommit, fixture.commits[2]);
    assert.equal(boundary.skippedRevisions, 2);
    // The signal that separates this from a path entering where its recipe
    // became executable: a revision the projector COULD have rendered was
    // dropped because a later one could not.
    assert.equal(boundary.renderableSkipped, 1);
    assert.equal(boundary.lastUnrenderableCommit, fixture.commits[1]);
    assert.match(boundary.reason, /secrets\./u);
  } finally {
    fixture.cleanup();
  }
});

test('an entry boundary stays put as the source history grows past it', async () => {
  const fixture = gapFixture(GAP_REVISIONS);
  try {
    const earlier = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.commits[2],
      destination: fixture.at('earlier'),
    });
    const later = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('later'),
    });
    git(later.destination, [
      'fetch',
      '--quiet',
      '--no-tags',
      earlier.destination,
      'master:refs/remotes/earlier/master',
    ]);
    assert.equal(
      await assertFastForward({
        repo: later.destination,
        candidateSha: later.publicSha,
        existingRef: 'refs/remotes/earlier/master',
      }),
      true,
      'a projection over a mid-history gap must still fast-forward'
    );

    const repeated = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('repeated'),
    });
    assert.equal(later.publicSha, repeated.publicSha);
  } finally {
    fixture.cleanup();
  }
});

test('the boundary moves past content an unrenderable revision preceded', async () => {
  // The revision after the failure reverts the file to bytes the pre-boundary
  // history already had. filter-repo's callback sees one (filename, blob) pair
  // and no commit, so that blob cannot be dropped there and rendered here; the
  // boundary moves forward instead, and the file enters one revision later.
  const fixture = gapFixture([
    ['root', workflow(25)],
    ['the workflow gains a secret', unrenderableWorkflow(30)],
    ['the workflow is reverted', workflow(25)],
    ['a later edit', workflow(45)],
  ]);
  try {
    const projection = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: fixture.head,
      destination: fixture.at('public'),
    });
    const [boundary] = projection.entryBoundaries;
    assert.equal(boundary.entryCommit, fixture.commits[3]);
    assert.equal(boundary.skippedRevisions, 3);
    assert.equal(boundary.renderableSkipped, 2);
    assert.equal(
      git(projection.destination, [
        'rev-list',
        '--count',
        'master',
        '--',
        WORKFLOW,
      ]),
      '1',
      'a reverted blob must not be both dropped and rendered'
    );
  } finally {
    fixture.cleanup();
  }
});

test('a source commit whose own revision cannot render is refused by name', async () => {
  const fixture = gapFixture([
    ['root', workflow(25)],
    ['the workflow gains a secret', unrenderableWorkflow(30)],
  ]);
  try {
    await assert.rejects(
      projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha: fixture.head,
        destination: fixture.at('public'),
      }),
      error =>
        /does not render at the source commit itself/u.test(error.message) &&
        error.message.includes(fixture.head) &&
        /secrets\./u.test(error.message)
    );
  } finally {
    fixture.cleanup();
  }
});

test('the entry boundary is the last contiguous run of rendering revisions', () => {
  const revisions = objects => objects.map(object => ({ object }));
  const renders = set => revision => set.has(revision.object);

  assert.equal(
    resolveEntryBoundary(
      revisions(['a', 'b', 'c']),
      renders(new Set(['a', 'b', 'c']))
    ),
    0,
    'a path that renders everywhere enters at its first revision'
  );
  assert.equal(
    resolveEntryBoundary(
      revisions(['a', 'b', 'c']),
      renders(new Set(['b', 'c']))
    ),
    1,
    'a path that predates its recipe enters where it starts rendering'
  );
  // The case first-success entry got wrong: renders, stops, renders again.
  assert.equal(
    resolveEntryBoundary(
      revisions(['a', 'b', 'c', 'd']),
      renders(new Set(['a', 'c', 'd']))
    ),
    2,
    'entry is taken from the end, so the early success is dropped with the failure'
  );
  assert.equal(
    resolveEntryBoundary(
      revisions(['a', 'b', 'c']),
      renders(new Set(['a', 'b']))
    ),
    3,
    'a tip that cannot render leaves no revision to enter at'
  );
  // A blob on both sides of the boundary cannot be dropped there and rendered
  // here, because the callback keys on (path, blob) and sees no commit.
  assert.equal(
    resolveEntryBoundary(
      revisions(['a', 'b', 'a', 'c']),
      renders(new Set(['a', 'c']))
    ),
    3,
    'the boundary moves past content an unrenderable revision preceded'
  );
});

function readyCatchupFixture(fixture) {
  const manifest = structuredClone(MANIFEST);
  manifest.exceptions = manifest.exceptions.filter(
    row => row.path !== 'src/config.ts'
  );
  manifest.exceptions.push({
    path: 'src/config.ts',
    classification: 'PRIVATE',
    reason: 'fixture unavailable output excluded',
  });
  manifest.exceptions.push({
    path: 'scripts/public-projection.epoch.json',
    classification: 'PRIVATE',
    reason: 'private source mapping',
  });
  delete manifest.recipes['public-config'];
  write(
    fixture.source,
    MANIFEST_PATH,
    JSON.stringify(manifest, null, 2) + '\n'
  );
  write(fixture.source, 'scripts/public-projection.epoch.json', '{}\n');
  git(fixture.source, [
    'add',
    '--',
    MANIFEST_PATH,
    'scripts/public-projection.epoch.json',
  ]);
  git(fixture.source, [
    'commit',
    '--quiet',
    '-m',
    'classify complete snapshot',
  ]);
  return git(fixture.source, ['rev-parse', 'HEAD']);
}

async function catchupFixture() {
  const fixture = sourceFixture();
  const seed = await projectPublicHistory({
    sourceRepo: fixture.source,
    sourceSha: fixture.head,
    destination: fixture.at('old-public'),
    epoch: null,
  });
  const sourceSha = readyCatchupFixture(fixture);
  return {
    fixture,
    seed,
    sourceSha,
    fastForwardFrom: { repository: seed.destination, ref: 'master' },
  };
}

test('snapshot catch-up preserves the public prefix and never carries private history or metadata', async () => {
  const { fixture, seed, fastForwardFrom } = await catchupFixture();
  try {
    write(
      fixture.source,
      WORKFLOW,
      workflow(80).replace(
        '# exawatt:public-replace-end',
        '# broken historical directive'
      )
    );
    git(fixture.source, ['add', '--', WORKFLOW]);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'private intermediate mistake',
    ]);
    write(fixture.source, WORKFLOW, workflow(90));
    write(fixture.source, 'src/a.ts', 'export const a = 999;\n');
    git(fixture.source, ['add', '--', WORKFLOW, 'src/a.ts']);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'private contact nobody@example.test',
    ]);
    const sourceSha = git(fixture.source, ['rev-parse', 'HEAD']);
    const options = {
      sourceRepo: fixture.source,
      sourceSha,
      fastForwardFrom,
      expectedPublicSha: seed.publicSha,
    };
    const first = await projectPublicCatchup({
      ...options,
      destination: fixture.at('catchup'),
    });
    const second = await projectPublicCatchup(options);
    assert.equal(first.publicSha, second.publicSha);
    assert.equal(first.planDigest, second.planDigest);
    assert.equal(first.emittedCommits, 1);
    const unchanged = await projectPublicCatchup({
      ...options,
      fastForwardFrom: { repository: first.destination, ref: 'master' },
      expectedPublicSha: first.publicSha,
    });
    assert.equal(unchanged.publicSha, first.publicSha);
    assert.equal(unchanged.emittedCommits, 0);
    assert.equal(
      git(first.destination, ['rev-parse', 'master^']),
      seed.publicSha
    );
    assert.equal(
      git(seed.destination, ['rev-parse', 'master']),
      seed.publicSha,
      'preparation must not push'
    );
    assert.equal(
      git(first.destination, ['show', 'master:src/a.ts']),
      'export const a = 999;'
    );
    assert.throws(() => git(first.destination, ['cat-file', '-e', sourceSha]));
    assert.doesNotMatch(
      git(first.destination, ['for-each-ref', '--format=%(refname)']),
      /source-tip/u
    );
    assert.doesNotMatch(
      git(first.destination, ['log', '-1', '--format=%B']),
      /nobody@example|private contact/u
    );
    assert.doesNotMatch(
      git(first.destination, ['ls-tree', '-r', '--name-only', 'master']),
      /company\/secret|config.private/u
    );
    assert.equal(first.epochUpdate.mode, 'published-snapshot');
    assert.equal(first.epochUpdate.sourceSha, sourceSha);
    assert.equal(first.epochUpdate.publicSha, first.publicSha);
  } finally {
    fixture.cleanup();
  }
});

test('snapshot catch-up rejects a stale tip or failed current rendering without creating a candidate', async () => {
  const { fixture, seed, sourceSha, fastForwardFrom } = await catchupFixture();
  try {
    await assert.rejects(
      projectPublicCatchup({
        sourceRepo: fixture.source,
        sourceSha,
        fastForwardFrom,
        expectedPublicSha: 'a'.repeat(40),
        destination: fixture.at('stale'),
      }),
      /expected public/u
    );
    assert.equal(existsSync(fixture.at('stale')), false);
    write(
      fixture.source,
      WORKFLOW,
      workflow(60).replace(
        '# exawatt:public-replace-end',
        '# broken current directive'
      )
    );
    git(fixture.source, ['add', '--', WORKFLOW]);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'malformed current recipe',
    ]);
    await assert.rejects(
      projectPublicCatchup({
        sourceRepo: fixture.source,
        sourceSha: git(fixture.source, ['rev-parse', 'HEAD']),
        fastForwardFrom,
        expectedPublicSha: seed.publicSha,
        destination: fixture.at('broken'),
      })
    );
    assert.equal(existsSync(fixture.at('broken')), false);
    assert.equal(
      git(seed.destination, ['rev-parse', 'master']),
      seed.publicSha
    );
  } finally {
    fixture.cleanup();
  }
});

test('a committed snapshot epoch bootstraps fresh replay and epoch-only history emits no public commit', async () => {
  const { fixture, seed, sourceSha, fastForwardFrom } = await catchupFixture();
  try {
    const snapshot = await projectPublicCatchup({
      sourceRepo: fixture.source,
      sourceSha,
      fastForwardFrom,
      expectedPublicSha: seed.publicSha,
      destination: fixture.at('snapshot-public'),
    });
    write(
      fixture.source,
      'scripts/public-projection.epoch.json',
      JSON.stringify(snapshot.epochUpdate, null, 2) + '\n'
    );
    git(fixture.source, ['add', '--', 'scripts/public-projection.epoch.json']);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'record private snapshot anchor',
    ]);
    const epochSource = git(fixture.source, ['rev-parse', 'HEAD']);
    const publicRemote = { repository: snapshot.destination, ref: 'master' };
    const bridge = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: epochSource,
      fastForwardFrom: publicRemote,
      destination: fixture.at('bridge'),
    });
    assert.equal(bridge.publicSha, snapshot.publicSha);
    assert.equal(bridge.emittedCommits, 0);
    const worker = fileURLToPath(
      new URL('./lib/exact-public-projection-worker.mjs', import.meta.url)
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            worker,
            fixture.source,
            epochSource,
            fixture.at('worker-missing-anchor'),
          ],
          { env: gitEnv(), encoding: 'utf8', stdio: 'pipe' }
        ),
      /requires --public-anchor/u
    );
    const workerResult = JSON.parse(
      execFileSync(
        process.execPath,
        [
          worker,
          fixture.source,
          epochSource,
          fixture.at('worker-projection'),
          snapshot.destination,
        ],
        { env: gitEnv(), encoding: 'utf8', stdio: 'pipe' }
      )
    );
    assert.equal(workerResult.publicSha, snapshot.publicSha);
    assert.equal(workerResult.emittedCommits, 0);

    write(fixture.source, 'src/a.ts', 'export const a = 77;\n');
    git(fixture.source, ['add', '--', 'src/a.ts']);
    git(fixture.source, ['commit', '--quiet', '-m', 'ordinary source update']);
    const nextSource = git(fixture.source, ['rev-parse', 'HEAD']);
    const first = await projectPublicHistory({
      sourceRepo: fixture.source,
      sourceSha: nextSource,
      fastForwardFrom: publicRemote,
      destination: fixture.at('ordinary'),
    });
    assert.equal(
      git(first.destination, ['rev-parse', 'master^']),
      snapshot.publicSha
    );
    // A fresh clone has no mutable source lock; the committed epoch and a
    // public tip descended from that epoch suffice to reconstruct the same SHA.
    git(fixture.parent, [
      'clone',
      '--quiet',
      '--no-local',
      fixture.source,
      fixture.at('fresh-private'),
    ]);
    const fresh = await projectPublicHistory({
      sourceRepo: fixture.at('fresh-private'),
      sourceSha: nextSource,
      fastForwardFrom: { repository: first.destination, ref: 'master' },
      destination: fixture.at('fresh-projection'),
    });
    assert.equal(fresh.publicSha, first.publicSha);
    assert.equal(fresh.emittedCommits, 1);
    assert.throws(() => git(fresh.destination, ['cat-file', '-e', nextSource]));
  } finally {
    fixture.cleanup();
  }
});

test('snapshot epoch refuses a forged source mapping and a public epoch file', async () => {
  const { fixture, seed, sourceSha, fastForwardFrom } = await catchupFixture();
  try {
    const snapshot = await projectPublicCatchup({
      sourceRepo: fixture.source,
      sourceSha,
      fastForwardFrom,
      expectedPublicSha: seed.publicSha,
      destination: fixture.at('snapshot-public'),
    });
    const publicRemote = { repository: snapshot.destination, ref: 'master' };
    await assert.rejects(
      projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha,
        fastForwardFrom: publicRemote,
        epoch: { ...snapshot.epochUpdate, sourceSha: fixture.earlier },
      }),
      /unrendered outputs|does not match/u
    );
    const manifest = structuredClone(MANIFEST);
    delete manifest.recipes['public-config'];
    manifest.exceptions = manifest.exceptions.filter(
      row => row.path !== 'src/config.ts'
    );
    write(
      fixture.source,
      MANIFEST_PATH,
      JSON.stringify(manifest, null, 2) + '\n'
    );
    git(fixture.source, ['add', '--', MANIFEST_PATH]);
    git(fixture.source, [
      'commit',
      '--quiet',
      '-m',
      'unsafe public epoch policy',
    ]);
    await assert.rejects(
      projectPublicHistory({
        sourceRepo: fixture.source,
        sourceSha: git(fixture.source, ['rev-parse', 'HEAD']),
        fastForwardFrom: publicRemote,
        epoch: snapshot.epochUpdate,
      }),
      /epoch must remain private/u
    );
  } finally {
    fixture.cleanup();
  }
});
