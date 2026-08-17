import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  COMPANY_COMPOSITION_RECORD,
  COMPANY_COMPOSITION_STATE,
  applyCompanyOverlayInPlace,
  composeCompanyProfile,
  proveCompanyComposition,
  resolveCompositionProfile,
  resolveCompositionSource,
  validateCompanyOverlayManifest,
} from './lib/company-composition.mjs';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  const { stdout } = await execFileAsync('git', args, { cwd: repo });
  return stdout;
}

async function writeTree(root, files) {
  for (const [relative, value] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    await mkdir(path.dirname(absolute), { recursive: true });
    if (value && typeof value === 'object' && value.symlink) {
      await symlink(value.symlink, absolute);
    } else {
      await writeFile(absolute, String(value));
    }
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** A Gate A manifest that classifies exactly this fixture's shape. */
const PATH_MANIFEST = {
  schemaVersion: 1,
  rules: [
    { id: 'app-public', classification: 'PUBLIC', include: ['src/**'] },
    { id: 'tooling-public', classification: 'PUBLIC', include: ['scripts/**'] },
    {
      id: 'company-private',
      classification: 'PRIVATE',
      include: ['company/**'],
    },
    { id: 'ops-private', classification: 'PRIVATE', include: ['secret/**'] },
  ],
  exceptions: [],
  recipes: {},
};

const OVERLAY_ENTRIES = [
  {
    source: 'company/overlay/web/src/app/api/private/route.ts',
    target: 'src/app/api/private/route.ts',
    role: 'hosted-route',
    profile: 'official-web',
    mode: 'add',
  },
  {
    source: 'company/overlay/web/src/lib/invites/store.ts',
    target: 'src/lib/invites/store.ts',
    role: 'invite',
    profile: 'official-web',
    mode: 'add',
  },
  {
    source: 'company/overlay/desktop/config/brand.json',
    target: 'distribution/brand.json',
    role: 'official-brand',
    profile: 'official-desktop',
    mode: 'add',
  },
];

function fixtureFiles(overrides = {}) {
  return {
    'scripts/open-source-paths.manifest.json': `${JSON.stringify(PATH_MANIFEST, null, 2)}\n`,
    'src/app/page.tsx': 'export default function Page() { return null; }\n',
    'src/lib/invites/contract.ts': 'export const CODE = 1;\n',
    'secret/operations.md': '# private ops\n',
    'company/overlay-manifest.json': `${JSON.stringify(
      { schemaVersion: 1, entries: OVERLAY_ENTRIES },
      null,
      2
    )}\n`,
    'company/overlay/web/src/app/api/private/route.ts':
      'export function GET() { return new Response("hosted"); }\n',
    'company/overlay/web/src/lib/invites/store.ts':
      'export const store = () => null;\n',
    'company/overlay/desktop/config/brand.json': '{ "productName": "Exawatt" }\n',
    ...overrides,
  };
}

async function createRepository(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-company-fixture-'));
  await git(root, ['init', '--quiet']);
  await git(root, ['config', 'user.name', 'Fixture Agent']);
  await git(root, ['config', 'user.email', 'agent@example.com']);
  await writeTree(root, files);
  await git(root, ['add', '.']);
  await git(root, ['commit', '--quiet', '-m', 'fixture']);
  return root;
}

async function withRepository(files, body) {
  const root = await createRepository(files);
  try {
    return await body(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function compose(root, profile, name = profile) {
  return composeCompanyProfile({
    profile,
    repo: root,
    outputDir: path.join(root, '.company-build', name),
  });
}

test('the public base is Gate A, and private paths never enter it', async () => {
  await withRepository(fixtureFiles(), async root => {
    const source = await resolveCompositionSource(root, 'HEAD');
    assert.deepEqual(source.basePaths, [
      'scripts/open-source-paths.manifest.json',
      'src/app/page.tsx',
      'src/lib/invites/contract.ts',
    ]);
    assert.deepEqual(source.withheldPaths, [
      'company/overlay-manifest.json',
      'company/overlay/desktop/config/brand.json',
      'company/overlay/web/src/app/api/private/route.ts',
      'company/overlay/web/src/lib/invites/store.ts',
      'secret/operations.md',
    ]);
  });
});

test('official-web restores hosted routes and official-desktop refuses them', async () => {
  await withRepository(fixtureFiles(), async root => {
    const web = await compose(root, 'official-web');
    const desktop = await compose(root, 'official-desktop');

    for (const target of [
      'src/app/api/private/route.ts',
      'src/lib/invites/store.ts',
    ]) {
      assert.equal(
        await exists(path.join(web.output, ...target.split('/'))),
        true,
        `official-web must contain ${target}`
      );
      assert.equal(
        await exists(path.join(desktop.output, ...target.split('/'))),
        false,
        `official-desktop must not contain ${target}`
      );
    }
    assert.equal(
      await exists(path.join(desktop.output, 'distribution', 'brand.json')),
      true
    );
    assert.equal(
      await exists(path.join(web.output, 'distribution', 'brand.json')),
      false
    );

    // No composition, in any profile, may carry a withheld path.
    for (const output of [web.output, desktop.output]) {
      assert.equal(await exists(path.join(output, 'secret')), false);
      assert.equal(await exists(path.join(output, 'company')), false);
    }

    const record = JSON.parse(
      await readFile(path.join(web.output, COMPANY_COMPOSITION_RECORD), 'utf8')
    );
    assert.equal(record.profile, 'official-web');
    assert.equal(record.entries.length, 2);
    assert.equal(record.source.withheldPathCount, 5);
  });
});

test('composing twice from one commit produces identical digests', async () => {
  await withRepository(fixtureFiles(), async root => {
    const proof = await proveCompanyComposition({ repo: root });
    assert.equal(proof.results.length, 2);
    const web = proof.results.find(result => result.profile === 'official-web');
    assert.equal(web.overlayEntryCount, 2);
    assert.match(web.compositionDigest, /^[0-9a-f]{64}$/);

    const again = await proveCompanyComposition({ repo: root });
    assert.deepEqual(
      again.results.map(result => result.compositionDigest),
      proof.results.map(result => result.compositionDigest)
    );
  });
});

test('an undeclared overlay file fails the composition', async () => {
  await withRepository(
    fixtureFiles({
      'company/overlay/web/src/lib/invites/service.ts': 'export const x = 1;\n',
    }),
    async root => {
      await assert.rejects(
        compose(root, 'official-web'),
        /undeclared tracked: company\/overlay\/web\/src\/lib\/invites\/service\.ts/
      );
    }
  );
});

test('a declared overlay source that is not tracked fails the composition', async () => {
  const files = fixtureFiles();
  const manifest = JSON.parse(files['company/overlay-manifest.json']);
  manifest.entries.push({
    source: 'company/overlay/web/src/lib/invites/absent.ts',
    target: 'src/lib/invites/absent.ts',
    role: 'invite',
    profile: 'official-web',
    mode: 'add',
  });
  files['company/overlay-manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  await withRepository(files, async root => {
    await assert.rejects(
      compose(root, 'official-web'),
      /declared but absent: company\/overlay\/web\/src\/lib\/invites\/absent\.ts/
    );
  });
});

test('an overlay target the public tree already owns is refused', async () => {
  const files = fixtureFiles();
  const manifest = JSON.parse(files['company/overlay-manifest.json']);
  manifest.entries[1].target = 'src/lib/invites/contract.ts';
  files['company/overlay-manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  await withRepository(files, async root => {
    await assert.rejects(
      compose(root, 'official-web'),
      /collides with public path src\/lib\/invites\/contract\.ts/
    );
  });
});

test('a symlinked overlay source is refused', async () => {
  await withRepository(
    fixtureFiles({
      'company/overlay/web/src/lib/invites/store.ts': {
        symlink: '../../../../../../secret/operations.md',
      },
    }),
    async root => {
      await assert.rejects(
        compose(root, 'official-web'),
        /overlay source cannot be a symlink/
      );
    }
  );
});

test('a dirty repository cannot be composed', async () => {
  await withRepository(fixtureFiles(), async root => {
    await writeFile(path.join(root, 'src', 'app', 'page.tsx'), 'edited\n');
    await assert.rejects(compose(root, 'official-web'), /must be clean/);
  });
});

test('the manifest refuses anything but an additive entry', () => {
  assert.throws(
    () =>
      validateCompanyOverlayManifest({
        schemaVersion: 1,
        entries: [{ ...OVERLAY_ENTRIES[0], mode: 'replace' }],
      }),
    /mode must be add/
  );
  assert.throws(
    () =>
      validateCompanyOverlayManifest({
        schemaVersion: 1,
        entries: [{ ...OVERLAY_ENTRIES[0], target: 'company/secret.ts' }],
      }),
    /reserved private or build path/
  );
  assert.throws(
    () =>
      validateCompanyOverlayManifest({
        schemaVersion: 1,
        entries: [
          OVERLAY_ENTRIES[0],
          { ...OVERLAY_ENTRIES[1], target: 'src/app/api/private/route.ts' },
        ],
      }),
    /overlay targets collide/
  );
});

test('in-place composition applies, withdraws, and records what it did', async () => {
  await withRepository(fixtureFiles(), async root => {
    const applied = await applyCompanyOverlayInPlace({
      root,
      profile: 'official-web',
    });
    assert.equal(applied.overlay, 'present');
    assert.deepEqual(
      applied.applied.map(entry => entry.target),
      ['src/app/api/private/route.ts', 'src/lib/invites/store.ts']
    );
    assert.equal(
      await exists(path.join(root, 'src/app/api/private/route.ts')),
      true
    );

    const state = JSON.parse(
      await readFile(path.join(root, COMPANY_COMPOSITION_STATE), 'utf8')
    );
    assert.equal(state.profile, 'official-web');

    // A community build after an official one proves absence rather than
    // inheriting yesterday's routes.
    const community = await applyCompanyOverlayInPlace({
      root,
      profile: 'community',
    });
    assert.deepEqual(community.applied, []);
    assert.deepEqual(community.removed, [
      'src/app/api/private/route.ts',
      'src/lib/invites/store.ts',
    ]);
    assert.equal(
      await exists(path.join(root, 'src/app/api/private/route.ts')),
      false
    );
    // The emptied directory goes with it; a stray `src/app/api/private/`
    // would still be a route segment to Next.
    assert.equal(await exists(path.join(root, 'src/app/api/private')), false);
    assert.equal(
      await exists(path.join(root, 'src/lib/invites/contract.ts')),
      true,
      'withdrawing the overlay must not touch public files'
    );
  });
});

test('in-place composition refuses a target the public tree tracks', async () => {
  const files = fixtureFiles();
  const manifest = JSON.parse(files['company/overlay-manifest.json']);
  manifest.entries[1].target = 'src/lib/invites/contract.ts';
  files['company/overlay-manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
  await withRepository(files, async root => {
    await assert.rejects(
      applyCompanyOverlayInPlace({ root, profile: 'official-web' }),
      /already tracks overlay target\(s\): src\/lib\/invites\/contract\.ts/
    );
  });
});

test('in-place composition fails loudly when an overlay source is gone', async () => {
  await withRepository(fixtureFiles(), async root => {
    await rm(path.join(root, 'company/overlay/web/src/lib/invites/store.ts'));
    await assert.rejects(
      applyCompanyOverlayInPlace({ root, profile: 'official-web' }),
      /overlay source is missing and this build declares official-web/
    );
  });
});

test('a checkout with no overlay manifest composes nothing and says so', async () => {
  const files = fixtureFiles();
  for (const key of Object.keys(files)) {
    if (key.startsWith('company/')) delete files[key];
  }
  await withRepository(files, async root => {
    const result = await applyCompanyOverlayInPlace({
      root,
      profile: 'official-web',
    });
    assert.equal(result.overlay, 'absent');
    assert.deepEqual(result.applied, []);
    assert.equal(await exists(path.join(root, COMPANY_COMPOSITION_STATE)), false);
  });
});

test('the composition profile follows the distribution unless a build declares one', () => {
  assert.equal(
    resolveCompositionProfile({ env: {}, distributionSource: 'community-default' }),
    'community'
  );
  // Incident `0017`: a hosted deployment that cannot say what it is must not
  // quietly become a community artifact.
  assert.equal(
    resolveCompositionProfile({ env: {}, distributionSource: 'env' }),
    'official-web'
  );
  assert.equal(
    resolveCompositionProfile({
      env: { EXAWATT_COMPOSITION_PROFILE: 'official-desktop' },
      distributionSource: 'operator-custody',
    }),
    'official-desktop'
  );
  assert.throws(
    () =>
      resolveCompositionProfile({
        env: { EXAWATT_COMPOSITION_PROFILE: 'offical-web' },
        distributionSource: 'env',
      }),
    /EXAWATT_COMPOSITION_PROFILE must be one of/
  );
});
