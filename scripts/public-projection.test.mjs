import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertFastForward,
  buildProjectionPlan,
  projectPublicHistory,
} from './lib/public-projection.mjs';
import { renderRecipeOutput } from './lib/recipe-renderers.mjs';
import {
  findImageMetadataFindings,
  findTextFindings,
  readForbiddenVocabulary,
} from './public-content-scan.mjs';

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
    assert.deepEqual(
      git(later.destination, ['log', '--format=%s', 'master'])
        .split('\n')
        .sort(),
      ['add public file', 'edit public file', 'root']
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
