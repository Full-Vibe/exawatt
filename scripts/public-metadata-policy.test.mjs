import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PUBLIC_METADATA_POLICY_ID,
  PUBLIC_METADATA_POLICY_VERSION,
  PUBLIC_PROJECTOR_IDENTITY,
  auditPublicGitMetadata,
  isCanonicalGitHubNoreplyEmail,
  mixedCommitMessage,
  neutralCommitMessage,
  projectPublicCommitMetadata,
  readPublicGitMetadata,
  renderPublicMetadataAudit,
  scanPublicCommitMetadata,
  scanPublicMetadataText,
  scanPublicTagMetadata,
} from './lib/public-metadata-policy.mjs';
import { parseArgs } from './public-metadata-audit.mjs';

const SHA = '1'.repeat(40);
const DATE = '1787252400 -0700';
const FIXTURE_DATE = '2026-08-20T12:00:00-07:00';
const AUTHOR = {
  name: 'Outside Contributor',
  email: 'outside@example.test',
  date: DATE,
};
const COMMITTER = {
  name: 'Private Maintainer',
  email: 'maintainer@corp.example.com',
  date: '1787252460 -0700',
};
const PERSONAL_EMAIL = ['private.person', 'gmail.com'].join('@');
const OPERATOR_HOME = ['/Users', ['ja', 'ke'].join(''), 'private'].join('/');

function classified(paths, hasChanges = paths.length > 0) {
  return { paths, hasChanges };
}

function reviewedMetadata({
  message,
  author = AUTHOR,
  approvedIdentityEmails = [],
  forbiddenVocabulary = [],
  provenance = 'authenticated-import',
} = {}) {
  return {
    sourceSha: SHA,
    provenance,
    message,
    author: { name: author.name, email: author.email },
    approvedIdentityEmails,
    forbiddenVocabulary,
  };
}

test('metadata policy has a stable, versioned identity', () => {
  assert.equal(PUBLIC_METADATA_POLICY_VERSION, 2);
  assert.equal(PUBLIC_METADATA_POLICY_ID, 'exawatt-public-metadata-v2');
});

test('an authenticated public contribution preserves reviewed attribution', () => {
  const message = [
    'feat(adapter): add a public source',
    '',
    'The behavior and evidence are public.',
    '',
    'Co-Authored-By: Helper <helper@example.test>',
    '',
  ].join('\n');
  const projected = projectPublicCommitMetadata({
    sourceSha: SHA,
    message,
    author: AUTHOR,
    committer: COMMITTER,
    publicChange: classified(['src/adapter.ts']),
    privateChange: classified([]),
    reviewedMetadata: reviewedMetadata({ message }),
  });

  assert.equal(projected.message, message);
  assert.deepEqual(projected.author, AUTHOR);
  assert.deepEqual(projected.committer, {
    ...PUBLIC_PROJECTOR_IDENTITY,
    date: COMMITTER.date,
  });
});

test('every projected message ends in one deterministic final newline', () => {
  const projected = projectPublicCommitMetadata({
    sourceSha: SHA,
    message: 'public message without a newline',
    author: AUTHOR,
    committer: COMMITTER,
    publicChange: classified(['README.md']),
    privateChange: classified([]),
    reviewedMetadata: reviewedMetadata({
      message: 'public message without a newline',
    }),
  });
  assert.equal(projected.message, 'public message without a newline\n');
  assert.match(projected.author.date, /^\d+ [+-]\d{4}$/u);
  assert.match(projected.committer.date, /^\d+ [+-]\d{4}$/u);
});

test('projection refuses dates git commit-tree cannot consume', () => {
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: 'public message\n',
        author: { ...AUTHOR, date: FIXTURE_DATE },
        committer: COMMITTER,
        publicChange: classified(['README.md']),
        privateChange: classified([]),
      }),
    /commit-tree format/u
  );
});

test('unreviewed public-only metadata is neutral even when it looks safe', () => {
  const projected = projectPublicCommitMetadata({
    sourceSha: SHA,
    message: 'perfectly safe-looking source subject',
    author: AUTHOR,
    committer: COMMITTER,
    publicChange: classified(['README.md']),
    privateChange: classified([]),
  });

  assert.equal(
    projected.message,
    neutralCommitMessage(['README.md'], { mixed: false })
  );
  assert.deepEqual(projected.author, {
    ...PUBLIC_PROJECTOR_IDENTITY,
    date: AUTHOR.date,
  });
});

test('unreviewed public-only metadata cannot leak identity, trailers, or business text', () => {
  const privateAuthor = {
    ...AUTHOR,
    name: 'Private Operator',
    email: PERSONAL_EMAIL,
  };
  const projected = projectPublicCommitMetadata({
    sourceSha: SHA,
    message: [
      'change Acme business terms',
      '',
      `Signed-off-by: Private Person <${PERSONAL_EMAIL}>`,
    ].join('\n'),
    author: privateAuthor,
    committer: COMMITTER,
    publicChange: classified(['README.md']),
    privateChange: classified([]),
  });

  assert.doesNotMatch(
    `${projected.message}\n${projected.author.name}\n${projected.author.email}`,
    /Acme|Private Operator|gmail|Signed-off-by/u
  );
});

test('a mixed commit publishes no source message or private path metadata', () => {
  const sourceMessage = [
    'fix auth for a private customer',
    '',
    'Admin is private.person@example.org and production uses company/keys.json.',
  ].join('\n');
  const input = {
    sourceSha: SHA,
    message: sourceMessage,
    author: AUTHOR,
    committer: COMMITTER,
    publicChange: classified(['src/z.ts', 'README.md', 'src/a.ts']),
    privateChange: classified(['company/keys.json']),
  };
  const first = projectPublicCommitMetadata(input);
  const second = projectPublicCommitMetadata({
    ...input,
    publicChange: classified(['src/a.ts', 'src/z.ts', 'README.md']),
  });

  assert.equal(first.message, second.message);
  assert.equal(
    first.message,
    [
      'public: update README.md, src',
      '',
      'Public projection of an unreviewed source commit that also changed private paths.',
      '',
      `Exawatt-Public-Metadata-Policy: ${PUBLIC_METADATA_POLICY_ID}`,
      '',
    ].join('\n')
  );
  assert.doesNotMatch(first.message, /customer|private\.person|company\/keys/u);
  assert.deepEqual(first.author, {
    ...PUBLIC_PROJECTOR_IDENTITY,
    date: AUTHOR.date,
  });
});

test('a private-only commit is the projection caller’s responsibility to drop', () => {
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: 'private only',
        author: AUTHOR,
        committer: COMMITTER,
        publicChange: classified([]),
        privateChange: classified(['company/private.md']),
      }),
    /no public change must be dropped/u
  );
});

test('reviewed public metadata fails closed on personal data or a credential', () => {
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: `Use the operator account at ${PERSONAL_EMAIL}`,
        author: AUTHOR,
        committer: COMMITTER,
        publicChange: classified(['README.md']),
        privateChange: classified([]),
        reviewedMetadata: reviewedMetadata({
          message: `Use the operator account at ${PERSONAL_EMAIL}`,
        }),
      }),
    /unapproved-message-email/u
  );
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: `temporary token ghp_${'a'.repeat(36)}`,
        author: AUTHOR,
        committer: COMMITTER,
        publicChange: classified(['README.md']),
        privateChange: classified([]),
        reviewedMetadata: reviewedMetadata({
          message: `temporary token ghp_${'a'.repeat(36)}`,
        }),
      }),
    /github-token/u
  );
});

test('metadata text scanner permits public-safe attribution and role addresses', () => {
  const findings = scanPublicMetadataText(
    [
      'Contact legal@exawatt.ai or fixture@example.test.',
      '',
      'Co-authored-by: Person <person@contributors.example.net>',
    ].join('\n')
  );
  assert.deepEqual(findings, []);
});

test('an identity trailer cannot self-approve a private address', () => {
  const trailer = `Co-authored-by: Private Person <${PERSONAL_EMAIL}>`;
  assert.deepEqual(
    scanPublicMetadataText(trailer).map(entry => entry.rule),
    ['unapproved-message-email']
  );
  assert.deepEqual(
    scanPublicMetadataText(`summary\r\n\r\n${trailer}`, {
      approvedIdentityEmails: [PERSONAL_EMAIL],
    }),
    []
  );
  assert.deepEqual(
    scanPublicMetadataText(`${PERSONAL_EMAIL}\n\n${trailer}`, {
      approvedIdentityEmails: [PERSONAL_EMAIL],
    }).map(entry => entry.rule),
    ['unapproved-message-email']
  );
});

test('reviewed authors require canonical noreply or exact consent', () => {
  const privateAuthor = { ...AUTHOR, email: PERSONAL_EMAIL };
  const input = {
    sourceSha: SHA,
    message: 'source message',
    author: privateAuthor,
    committer: COMMITTER,
    publicChange: classified(['README.md']),
    privateChange: classified([]),
  };
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        ...input,
        reviewedMetadata: reviewedMetadata({
          message: 'reviewed message',
          author: privateAuthor,
        }),
      }),
    /unapproved-identity-email/u
  );

  const consented = projectPublicCommitMetadata({
    ...input,
    reviewedMetadata: reviewedMetadata({
      message: 'reviewed message',
      author: privateAuthor,
      approvedIdentityEmails: [PERSONAL_EMAIL],
    }),
  });
  assert.equal(consented.author.email, PERSONAL_EMAIL);

  const noreply = [
    '12345+outside-contributor',
    'users.noreply.github.com',
  ].join('@');
  assert.equal(isCanonicalGitHubNoreplyEmail(noreply), true);
  assert.equal(
    isCanonicalGitHubNoreplyEmail(['person', 'noreply.github.com'].join('@')),
    false
  );
  assert.equal(
    projectPublicCommitMetadata({
      ...input,
      reviewedMetadata: reviewedMetadata({
        message: 'reviewed message',
        author: { ...AUTHOR, email: noreply },
      }),
    }).author.email,
    noreply
  );
});

test('complete commit scanning applies consent policy to author identities', () => {
  const commit = {
    sha: SHA,
    message: 'reviewed public message',
    author: { ...AUTHOR, email: PERSONAL_EMAIL },
    committer: { ...PUBLIC_PROJECTOR_IDENTITY, date: COMMITTER.date },
  };
  const denied = scanPublicCommitMetadata(commit);
  assert.deepEqual(
    denied.map(entry => entry.rule),
    ['unapproved-identity-email']
  );
  assert.deepEqual(
    scanPublicCommitMetadata(commit, {
      approvedIdentityEmails: [PERSONAL_EMAIL],
    }),
    []
  );
  assert.equal(
    new Set(denied.map(entry => `${entry.surface}:${entry.line}:${entry.rule}`))
      .size,
    denied.length
  );
});

test('reviewed metadata is source-bound and vocabulary-scanned', () => {
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: 'source message',
        author: AUTHOR,
        committer: COMMITTER,
        publicChange: classified(['README.md']),
        privateChange: classified([]),
        reviewedMetadata: {
          ...reviewedMetadata({
            message: 'Public words about Acme Confidential',
            forbiddenVocabulary: ['Acme Confidential'],
          }),
          sourceSha: '2'.repeat(40),
        },
      }),
    /sourceSha must match/u
  );
  assert.throws(
    () =>
      projectPublicCommitMetadata({
        sourceSha: SHA,
        message: 'source message',
        author: AUTHOR,
        committer: COMMITTER,
        publicChange: classified(['README.md']),
        privateChange: classified([]),
        reviewedMetadata: reviewedMetadata({
          message: 'Public words about Acme Confidential',
          forbiddenVocabulary: ['Acme Confidential'],
        }),
      }),
    /private-forbidden-vocabulary/u
  );
});

test('metadata text scanner detects but never returns matched private values', () => {
  const privateTerm = 'Acme Confidential';
  const source = [
    `Admin ${PERSONAL_EMAIL}`,
    `Built from ${OPERATOR_HOME}`,
    privateTerm,
    `token ghp_${'z'.repeat(36)}`,
  ].join('\n');
  const findings = scanPublicMetadataText(source, {
    surface: 'fixture',
    forbiddenVocabulary: [privateTerm],
  });

  assert.deepEqual(findings.map(entry => entry.rule).sort(), [
    'github-token',
    'operator-home-path',
    'private-forbidden-vocabulary',
    'unapproved-message-email',
  ]);
  assert.doesNotMatch(JSON.stringify(findings), /gmail|jake|Acme|ghp_/u);
});

test('annotated tag names and messages are part of the boundary', () => {
  const findings = scanPublicTagMetadata(
    {
      name: 'customer-Acme-release',
      target: SHA,
      tagger: AUTHOR,
      message: `Coordinate with ${PERSONAL_EMAIL}`,
    },
    { forbiddenVocabulary: ['Acme'] }
  );
  assert.deepEqual(findings.map(entry => entry.rule).sort(), [
    'private-forbidden-vocabulary',
    'unapproved-message-email',
  ]);
});

test('annotated tagger identities obey the same consent policy', () => {
  const tag = {
    name: 'v0.2.0',
    target: SHA,
    tagger: { ...AUTHOR, email: PERSONAL_EMAIL },
    message: 'Public release',
  };
  assert.deepEqual(
    scanPublicTagMetadata(tag).map(entry => entry.rule),
    ['unapproved-identity-email']
  );
  assert.deepEqual(
    scanPublicTagMetadata(tag, {
      approvedIdentityEmails: [PERSONAL_EMAIL],
    }),
    []
  );
});

function git(root, args, environment = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? '/tmp',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_AUTHOR_NAME: AUTHOR.name,
      GIT_AUTHOR_EMAIL: AUTHOR.email,
      GIT_AUTHOR_DATE: FIXTURE_DATE,
      GIT_COMMITTER_NAME: PUBLIC_PROJECTOR_IDENTITY.name,
      GIT_COMMITTER_EMAIL: PUBLIC_PROJECTOR_IDENTITY.email,
      GIT_COMMITTER_DATE: FIXTURE_DATE,
      ...environment,
    },
  }).trim();
}

test('repository audit previews a reseed and redacts commit and tag findings', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'exawatt-metadata-audit-'));
  try {
    git(root, ['init', '--quiet', '--initial-branch=master', '.']);
    writeFileSync(path.join(root, 'README.md'), '# public\n');
    git(root, ['add', '--', 'README.md']);
    git(root, [
      'commit',
      '--quiet',
      '-m',
      'public root\n\nCo-authored-by: Helper <helper@example.test>',
    ]);
    git(root, ['tag', '-a', 'v0.1.0', '-m', 'Public release']);

    let metadata = await readPublicGitMetadata({
      repo: root,
      refs: ['master'],
    });
    let audit = auditPublicGitMetadata(metadata);
    assert.equal(audit.reseedRequired, false);
    assert.equal(audit.commits, 1);
    assert.equal(audit.tags, 1);

    mkdirSync(path.join(root, 'src'));
    writeFileSync(
      path.join(root, 'src', 'next.ts'),
      'export const next = 1;\n'
    );
    git(root, ['add', '--', 'src/next.ts']);
    git(root, [
      'commit',
      '--quiet',
      '-m',
      `wire admin ${PERSONAL_EMAIL} for Acme Confidential`,
    ]);
    git(root, [
      'tag',
      '-a',
      'customer-Acme',
      '-m',
      'Private launch for Acme Confidential',
    ]);

    metadata = await readPublicGitMetadata({ repo: root, refs: ['master'] });
    audit = auditPublicGitMetadata(metadata, {
      forbiddenVocabulary: ['Acme Confidential', 'customer-Acme'],
    });
    assert.equal(audit.reseedRequired, true);
    assert.equal(audit.commits, 2);
    assert.equal(audit.tags, 2);
    assert.equal(audit.byRule['unapproved-message-email'], 1);
    assert.equal(audit.byRule['private-forbidden-vocabulary'], 3);

    const report = renderPublicMetadataAudit(audit);
    assert.match(report, /RESEED REQUIRED/u);
    assert.match(report, /commit [0-9a-f]{40} message/u);
    assert.match(report, /tag customer-Acme/u);
    assert.doesNotMatch(report, /gmail|Confidential|private\.person/u);
    assert.equal(git(root, ['status', '--short']), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('all-refs audit catches metadata kept reachable outside master', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'exawatt-metadata-refs-'));
  try {
    git(root, ['init', '--quiet', '--initial-branch=master', '.']);
    writeFileSync(path.join(root, 'README.md'), '# public\n');
    git(root, ['add', '--', 'README.md']);
    git(root, ['commit', '--quiet', '-m', 'public root']);
    git(root, ['checkout', '--quiet', '-b', 'automation/private-history']);
    writeFileSync(path.join(root, 'hidden.txt'), 'historical fixture\n');
    git(root, ['add', '--', 'hidden.txt']);
    git(root, [
      'commit',
      '--quiet',
      '-m',
      `private automation contact ${PERSONAL_EMAIL}`,
    ]);
    git(root, ['checkout', '--quiet', 'master']);

    const allRefs = auditPublicGitMetadata(
      await readPublicGitMetadata({ repo: root }),
      { enforceProjectorCommitter: false }
    );
    assert.equal(allRefs.refs >= 2, true);
    assert.equal(allRefs.commits, 2);
    assert.equal(allRefs.byRule['unapproved-message-email'], 1);

    const masterOnly = auditPublicGitMetadata(
      await readPublicGitMetadata({ repo: root, refs: ['master'] }),
      { enforceProjectorCommitter: false }
    );
    assert.equal(masterOnly.refs, 1);
    assert.equal(masterOnly.commits, 1);
    assert.equal(masterOnly.reseedRequired, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('audit CLI arguments are repeatable and remain read-only by construction', () => {
  assert.deepEqual(
    parseArgs([
      '--repo',
      '/tmp/public',
      '--ref',
      'master',
      '--ref',
      'release',
      '--format',
      'json',
      '--forbidden-vocabulary',
      '/tmp/private-terms',
      '--allow-legacy-committer',
    ]),
    {
      repo: '/tmp/public',
      refs: ['master', 'release'],
      format: 'json',
      forbiddenVocabulary: '/tmp/private-terms',
      allowLegacyCommitter: true,
      help: false,
    }
  );
  assert.deepEqual(parseArgs([]).refs, []);
  assert.throws(() => parseArgs(['--format', 'yaml']), /text or json/u);
  assert.throws(() => parseArgs(['--unknown']), /unknown argument/u);
});

test('mixed message helper rejects a pathless projection', () => {
  assert.throws(() => mixedCommitMessage([]), /needs a public path/u);
});
