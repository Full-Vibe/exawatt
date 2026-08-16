import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import {
  buildSeedPlan,
  createPathClassifier,
  projectPublicPathManifest,
  validatePathManifest,
  validateTrackedPathCoverage,
} from './lib/open-source-paths.mjs';

const execFileAsync = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function fixtureManifest() {
  return {
    schemaVersion: 1,
    rules: [
      {
        id: 'public-source',
        classification: 'PUBLIC',
        include: ['src/**'],
        exclude: ['src/private/**'],
      },
      {
        id: 'private-source',
        classification: 'PRIVATE',
        include: ['src/private/**'],
        exclude: [],
      },
    ],
    exceptions: [
      {
        path: 'mixed.md',
        classification: 'GENERATED',
        recipe: 'public-variant',
        reason: 'mixed source',
      },
      {
        path: 'local.tmp',
        classification: 'EXCLUDED',
        reason: 'machine local',
      },
    ],
    recipes: {
      'public-variant': {
        kind: 'fixture-renderer',
        inputs: ['mixed.md', 'src/private/data.md'],
        outputs: [
          { path: 'generated/new.txt', mode: '100644' },
          { path: 'mixed.md', mode: '100644' },
        ],
      },
    },
  };
}

function fixtureEntries() {
  return [
    { path: 'local.tmp', mode: '100644', object: 'local-object' },
    { path: 'mixed.md', mode: '100644', object: 'mixed-object' },
    { path: 'src/private/data.md', mode: '100644', object: 'private-object' },
    { path: 'src/public.ts', mode: '100755', object: 'public-object' },
  ];
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('the repository manifest classifies every currently tracked path', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['scripts/open-source-paths.mjs', 'check'],
    { cwd: root }
  );
  assert.match(stdout, /classified \d+ tracked paths/);
});

test('coverage fails closed while exact exceptions override directory rules', () => {
  const manifest = fixtureManifest();
  const classified = validateTrackedPathCoverage(manifest, fixtureEntries());
  assert.deepEqual(
    classified.map(entry => [entry.path, entry.classification]),
    [
      ['local.tmp', 'EXCLUDED'],
      ['mixed.md', 'GENERATED'],
      ['src/private/data.md', 'PRIVATE'],
      ['src/public.ts', 'PUBLIC'],
    ]
  );
  const classify = createPathClassifier(manifest);
  assert.throws(() => classify('new-root.txt'), /no classification/);
});

test('ambiguous rules, stale exceptions, stale excludes, and root catch-alls fail', () => {
  const ambiguous = fixtureManifest();
  ambiguous.rules.push({
    id: 'second-public-source',
    classification: 'PUBLIC',
    include: ['src/public*'],
    exclude: [],
  });
  assert.throws(
    () => validateTrackedPathCoverage(ambiguous, fixtureEntries()),
    /ambiguous classifications/
  );

  const staleException = fixtureManifest();
  staleException.exceptions.push({
    path: 'missing.md',
    classification: 'PRIVATE',
    reason: 'stale',
  });
  assert.throws(
    () => validateTrackedPathCoverage(staleException, fixtureEntries()),
    /stale exact exception/
  );

  const staleExclude = fixtureManifest();
  staleExclude.rules[0].exclude.push('src/absent/**');
  assert.throws(
    () => validateTrackedPathCoverage(staleExclude, fixtureEntries()),
    /stale exclude pattern/
  );

  const catchAll = fixtureManifest();
  catchAll.rules[0].include = ['**'];
  assert.throws(() => validatePathManifest(catchAll), /catch-all/);
});

test('generated paths require owned recipes with safe, collision-free outputs', () => {
  const missing = fixtureManifest();
  missing.exceptions[0].recipe = 'absent';
  assert.throws(() => validatePathManifest(missing), /unknown recipe/);

  const collision = fixtureManifest();
  collision.recipes.second = {
    kind: 'fixture',
    inputs: ['mixed.md'],
    outputs: [{ path: 'mixed.md', mode: '100644' }],
  };
  assert.throws(() => validatePathManifest(collision), /owned by both/);

  const unsafe = fixtureManifest();
  unsafe.recipes['public-variant'].outputs[0].path = '../escape.txt';
  assert.throws(() => validatePathManifest(unsafe), /normalized/);
});

test('public projection omits private vocabulary and retains generated outputs', () => {
  const manifest = fixtureManifest();
  const classified = validateTrackedPathCoverage(manifest, fixtureEntries());
  const projection = projectPublicPathManifest(manifest, classified);
  const serialized = JSON.stringify(projection);
  assert.doesNotMatch(serialized, /src\/private|PRIVATE|EXCLUDED/);
  assert.equal(
    createPathClassifier(projection)('src/public.ts').classification,
    'PUBLIC'
  );
  assert.equal(
    createPathClassifier(projection)('generated/new.txt').classification,
    'PUBLIC'
  );
  assert.equal(
    createPathClassifier(projection)('mixed.md').classification,
    'PUBLIC'
  );
});

test('seed plans preserve source SHA, blobs, modes, inputs, and deterministic output', async () => {
  const blobs = new Map([
    ['local-object', Buffer.from('local')],
    ['mixed-object', Buffer.from('mixed private and public source')],
    ['private-object', Buffer.from('private input')],
    ['public-object', Buffer.from('public executable')],
  ]);
  const options = {
    manifest: fixtureManifest(),
    source: {
      commit: 'commit-sha',
      tree: 'tree-sha',
      manifestPath: 'scripts/open-source-paths.manifest.json',
      manifestBlob: 'manifest-blob',
    },
    trackedEntries: fixtureEntries(),
    readBlob: async object => blobs.get(object),
  };
  const first = await buildSeedPlan(options);
  const second = await buildSeedPlan(options);
  assert.deepEqual(first, second);
  assert.match(first.planDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.source, options.source);

  const publicOutput = first.outputs.find(
    output => output.path === 'src/public.ts'
  );
  assert.deepEqual(publicOutput, {
    path: 'src/public.ts',
    mode: '100755',
    sourceObject: 'public-object',
    sourceSha256: digest(blobs.get('public-object')),
    recipe: null,
    contentPolicy: null,
  });
  const generated = first.outputs.find(
    output => output.path === 'generated/new.txt'
  );
  assert.equal(generated.recipe, 'public-variant');
  assert.deepEqual(
    generated.inputs.map(input => [input.path, input.object, input.mode]),
    [
      ['mixed.md', 'mixed-object', '100644'],
      ['src/private/data.md', 'private-object', '100644'],
    ]
  );
});

test('reviewed trees must be exact and cannot alter copied PUBLIC bytes or modes', async () => {
  const blobs = new Map([
    ['local-object', Buffer.from('local')],
    ['mixed-object', Buffer.from('mixed')],
    ['private-object', Buffer.from('private')],
    ['public-object', Buffer.from('public')],
  ]);
  const base = {
    manifest: fixtureManifest(),
    source: {
      commit: 'commit',
      tree: 'tree',
      manifestPath: 'manifest',
      manifestBlob: 'blob',
    },
    trackedEntries: fixtureEntries(),
    readBlob: async object => blobs.get(object),
  };
  const reviewedOutputs = [
    {
      path: 'generated/new.txt',
      mode: '100644',
      sha256: digest('rendered'),
    },
    { path: 'mixed.md', mode: '100644', sha256: digest('public variant') },
    {
      path: 'src/public.ts',
      mode: '100755',
      sha256: digest(blobs.get('public-object')),
    },
  ];
  const reviewed = await buildSeedPlan({ ...base, reviewedOutputs });
  assert.match(reviewed.reviewedOutputDigest, /^[a-f0-9]{64}$/);

  await assert.rejects(
    buildSeedPlan({ ...base, reviewedOutputs: reviewedOutputs.slice(1) }),
    /does not exactly match/
  );
  const changedPublic = structuredClone(reviewedOutputs);
  changedPublic.at(-1).sha256 = digest('changed');
  await assert.rejects(
    buildSeedPlan({ ...base, reviewedOutputs: changedPublic }),
    /PUBLIC output changed bytes/
  );
});

test('third-party email exemptions are exact, public-bound dispositions only', () => {
  const manifest = fixtureManifest();
  manifest.exceptions.push({
    path: 'NOTICE',
    classification: 'PUBLIC',
    reason: 'verified third-party notice',
    contentPolicy: { allowThirdPartyEmailMetadata: true },
  });
  const entries = [
    ...fixtureEntries(),
    { path: 'NOTICE', mode: '100644', object: 'notice-object' },
  ];
  const classify = createPathClassifier(manifest);
  assert.equal(
    classify('NOTICE').contentPolicy.allowThirdPartyEmailMetadata,
    true
  );
  assert.doesNotThrow(() => validateTrackedPathCoverage(manifest, entries));

  manifest.exceptions.at(-1).classification = 'PRIVATE';
  assert.throws(() => validatePathManifest(manifest), /public-bound/);
});
