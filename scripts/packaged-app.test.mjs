// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareDistribution } from './lib/distribution-build.mjs';
import { encodeAsar } from './lib/asar.mjs';
import {
  LSREGISTER,
  assertPackagedContract,
  assertPackagedSource,
  forgetLaunchedPackage,
  launchServicesBundles,
  readPackagedBuildInfo,
  repositoryBundlePredicate,
  resolvePackagedApp,
  sweepLaunchServices,
} from './lib/packaged-app.mjs';

/**
 * BUG-043. Every packaged eval used to spell `Exawatt.app` out, so the ENFORCED
 * packaged gate launched a bundle the default contract does not produce, and
 * asserted an updater capability that contract deliberately excludes.
 */

const officialFixture = new URL(
  './distribution.official.example.json',
  import.meta.url
);

// A path that need not exist: resolution is a question about the contract.
const ROOT = path.join(tmpdir(), 'exawatt-packaged-app-fixture');

test('the packaged bundle and its owed capabilities come from the contract', async () => {
  const community = await resolvePackagedApp({
    root: ROOT,
    appPathOverride: undefined,
    inputJson: undefined,
  });
  assert.equal(community.identity.productName, 'Exawatt Community');
  assert.equal(community.identity.appId, 'ai.exawatt.community');
  assert.equal(community.identity.protocolScheme, null);
  // A community build carries its OWN mark rather than none: absence left it
  // wearing Electron's default, which is correct on trademark and unfinished
  // as a product. The Exawatt mark is not in the public tree, so this cannot
  // become the official icon by accident.
  assert.equal(
    community.identity.iconPath,
    'electron/resources/icon-community.icns'
  );
  assert.equal(community.identity.updateChannel, null);
  assert.equal(
    community.executablePath,
    path.join(
      ROOT,
      'release/mac-arm64/Exawatt Community.app/Contents/MacOS/Exawatt Community'
    )
  );
  assert.equal(community.productUpdatesEnabled, false);

  const official = await resolvePackagedApp({
    root: ROOT,
    appPathOverride: undefined,
    inputJson: await readFile(officialFixture, 'utf8'),
  });
  assert.equal(official.identity.productName, 'Exawatt');
  assert.equal(official.identity.appId, 'ai.exawatt.desktop');
  assert.equal(official.identity.protocolScheme, 'exawatt');
  assert.equal(official.identity.iconPath, 'electron/resources/icon.icns');
  assert.equal(official.identity.updateChannel, 'stable');
  assert.equal(
    official.executablePath,
    path.join(ROOT, 'release/mac-arm64/Exawatt.app/Contents/MacOS/Exawatt')
  );
  assert.equal(official.productUpdatesEnabled, true);
  assert.notEqual(community.digest, official.digest);
  for (const field of [
    'appId',
    'productName',
    'protocolScheme',
    'iconPath',
    'updateChannel',
    'stateNamespace',
    'cacheNamespace',
  ]) {
    assert.notEqual(community.identity[field], official.identity[field], field);
  }
});

test('the resolver reads the shell contract, not the last build left on disk', async () => {
  // Resolving from `.exawatt-build/distribution.json` is what made the first
  // official-contract run of the repaired gate PASS while testing the community
  // package — incident `0015`'s false comfort with the arrow reversed. The
  // resolved identity must follow the INPUT, whatever a prepared artifact says.
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-packaged-app-'));
  const prepared = await prepareDistribution({ root, inputJson: undefined });
  const official = await resolvePackagedApp({
    root,
    appPathOverride: undefined,
    inputJson: await readFile(officialFixture, 'utf8'),
  });
  assert.equal(official.identity.productName, 'Exawatt');
  assert.notEqual(official.digest, prepared.digest);
});

test('implicit package resolution uses the canonical distribution profile selector', async () => {
  const previousProfile = process.env.EXAWATT_DISTRIBUTION_PROFILE;
  const previousJson = process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON;
  try {
    delete process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON;
    process.env.EXAWATT_DISTRIBUTION_PROFILE = 'misspelled-profile';
    await assert.rejects(
      resolvePackagedApp({ root: ROOT, appPathOverride: undefined }),
      /must be "official" or "community"/
    );

    const explicitCommunity = await resolvePackagedApp({
      root: ROOT,
      appPathOverride: undefined,
      inputJson: undefined,
    });
    assert.equal(explicitCommunity.identity.appId, 'ai.exawatt.community');
  } finally {
    if (previousProfile === undefined)
      delete process.env.EXAWATT_DISTRIBUTION_PROFILE;
    else process.env.EXAWATT_DISTRIBUTION_PROFILE = previousProfile;
    if (previousJson === undefined)
      delete process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON;
    else process.env.EXAWATT_DISTRIBUTION_CONFIG_JSON = previousJson;
  }
});

test('EXAWATT_APP_PATH moves the bundle without moving the expectations', async () => {
  const resolved = await resolvePackagedApp({
    root: ROOT,
    appPathOverride: '/tmp/elsewhere/Renamed.app/Contents/MacOS/Renamed',
    inputJson: undefined,
  });
  assert.equal(
    resolved.executablePath,
    '/tmp/elsewhere/Renamed.app/Contents/MacOS/Renamed'
  );
  assert.equal(resolved.appPath, '/tmp/elsewhere/Renamed.app');
  assert.equal(resolved.productUpdatesEnabled, false);
});

test('a package built from another contract is refused by digest, not by capability', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-packaged-app-'));
  const app = path.join(root, 'Exawatt Community.app');
  const renderer = path.join(app, 'Contents', 'Resources', 'renderer');
  await mkdir(renderer, { recursive: true });
  assert.throws(
    () => assertPackagedContract(app, 'a'.repeat(64)),
    /renderer\/distribution\.sha256/
  );
  await writeFile(path.join(renderer, 'distribution.sha256'), 'b'.repeat(64));
  assert.throws(
    () => assertPackagedContract(app, 'a'.repeat(64)),
    /was built from distribution bbbbbbbbbbbb/
  );
  assert.doesNotThrow(() => assertPackagedContract(app, 'b'.repeat(64)));
});

test('a stale package is refused by the source SHA embedded in app.asar', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-packaged-source-'));
  const app = path.join(root, 'Exawatt Community.app');
  const resources = path.join(app, 'Contents', 'Resources');
  await mkdir(resources, { recursive: true });
  await writeFile(
    path.join(resources, 'app.asar'),
    encodeAsar({
      'dist-electron/build-info.json': `${JSON.stringify({ sha: 'source-a' })}\n`,
    })
  );

  assert.equal(readPackagedBuildInfo(app).sha, 'source-a');
  assert.doesNotThrow(() => assertPackagedSource(app, 'source-a'));
  assert.throws(
    () => assertPackagedSource(app, 'source-b'),
    /was built from source source-a.*expects source-b/
  );
});

// Launch Services (BUG-305, BUG-083). The dump below has the shape
// `lsregister -dump Bundle` prints on macOS 26: a dashed separator, then the
// record's kind on its first line; only bundle records name a bundle path.
const SEPARATOR = '-'.repeat(80);
const record = (kind, fields) =>
  `${SEPARATOR}\n${kind}\n${fields.map(([key, value]) => `${`${key}:`.padEnd(28)}${value}`).join('\n')}\n`;
const DUMP = [
  record('bundle id:                  Exawatt (0x1084)', [
    ['container', '/ (0x4)'],
    [
      'path',
      '/Users/dev/src/exawatt-gone/release/mac-arm64/Exawatt.app (0x204c)',
    ],
    ['identifier', 'ai.exawatt.desktop'],
  ]),
  record('bundle id:                  Exawatt (0x1085)', [
    ['path', '/Applications/Exawatt.app (0x2050)'],
    ['identifier', 'ai.exawatt.desktop'],
  ]),
  record('bundle id:                  Electron (0x1086)', [
    [
      'path',
      '/Users/dev/src/exawatt/node_modules/electron/dist/Electron.app (0x2054)',
    ],
    ['identifier', 'com.github.Electron'],
  ]),
  record('bundle id:                  Exawatt (0x1087)', [
    [
      'path',
      '/private/var/T/exawatt-dogfood-source-AbC123/source/release/mac-arm64/Exawatt.app (0x2058)',
    ],
    ['identifier', 'ai.exawatt.desktop'],
  ]),
  record('bundle id:                  Other (0x1088)', [
    ['path', '/Users/dev/src/other/Other.app (0x205c)'],
    ['identifier', 'com.example.other'],
  ]),
  record('claim id:                   Exawatt (0x2000)', [
    [
      'path',
      '/Users/dev/src/exawatt-gone/release/mac-arm64/Exawatt.app (0x204c)',
    ],
  ]),
].join('');

const belongs = repositoryBundlePredicate({
  mainCheckout: '/Users/dev/src/exawatt',
  temporaryDirectories: ['/private/var/T'],
});

test('Launch Services bundle records are read from the dump, and nothing else is', () => {
  assert.deepEqual(
    launchServicesBundles(DUMP).map(bundle => bundle.path),
    [
      '/Users/dev/src/exawatt-gone/release/mac-arm64/Exawatt.app',
      '/Applications/Exawatt.app',
      '/Users/dev/src/exawatt/node_modules/electron/dist/Electron.app',
      '/private/var/T/exawatt-dogfood-source-AbC123/source/release/mac-arm64/Exawatt.app',
      '/Users/dev/src/other/Other.app',
    ]
  );
  assert.equal(launchServicesBundles(DUMP)[0].identifier, 'ai.exawatt.desktop');
});

test('only this repository’s worktrees are ours, and /Applications never is', () => {
  assert.equal(
    belongs('/Users/dev/src/exawatt/release/mac-arm64/Exawatt.app'),
    true
  );
  assert.equal(belongs('/Users/dev/src/exawatt-slug/release/X.app'), true);
  assert.equal(
    belongs('/private/var/T/exawatt-dogfood-source-AbC/source/release/X.app'),
    true
  );
  assert.equal(belongs('/Users/dev/src/exawattish/X.app'), false);
  assert.equal(belongs('/Users/dev/src/other/X.app'), false);
  assert.equal(
    belongs('/private/var/T/exawatt-exact-public-1/checkout/X.app'),
    false
  );
  assert.equal(belongs('/Applications/Exawatt.app'), false);
  assert.equal(
    repositoryBundlePredicate({
      mainCheckout: '/Applications',
      temporaryDirectories: [],
    })('/Applications/Exawatt.app'),
    false
  );
});

test('the sweep lists gone registrations under our worktrees, and unregisters only with execute', () => {
  const present = new Set([
    '/Applications/Exawatt.app',
    '/Users/dev/src/exawatt/node_modules/electron/dist/Electron.app',
  ]);
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === '-dump') return DUMP;
    if (args[1].includes('dogfood-source'))
      throw new Error('lsregister: -10814');
    return '';
  };
  const exists = candidate => present.has(candidate);

  const listed = sweepLaunchServices({ run, exists, belongs });
  assert.deepEqual(
    listed.stale.map(bundle => bundle.path),
    [
      '/private/var/T/exawatt-dogfood-source-AbC123/source/release/mac-arm64/Exawatt.app',
      '/Users/dev/src/exawatt-gone/release/mac-arm64/Exawatt.app',
    ]
  );
  assert.deepEqual(calls, [[LSREGISTER, '-dump', 'Bundle']]);

  const swept = sweepLaunchServices({ run, exists, belongs, execute: true });
  assert.deepEqual(
    swept.unregistered.map(bundle => bundle.path),
    ['/Users/dev/src/exawatt-gone/release/mac-arm64/Exawatt.app']
  );
  // A refusal is reported as one, never folded into "nothing to do".
  assert.equal(swept.refused.length, 1);
  assert.match(swept.refused[0].error, /-10814/u);
  assert.ok(
    calls.every(
      ([, flag, target]) =>
        flag !== '-u' || !target.startsWith('/Applications/')
    )
  );
});

test('a launched package is forgotten only when it is ours, never in /Applications', () => {
  const calls = [];
  const run = (command, args) => calls.push([command, ...args]);
  const anywhere = () => true;
  if (process.platform !== 'darwin') {
    assert.equal(
      forgetLaunchedPackage(
        { appPath: '/x/Exawatt.app' },
        { run, belongs: anywhere }
      ),
      'not-macos'
    );
    return;
  }
  assert.equal(
    forgetLaunchedPackage(
      { appPath: '/Applications/Exawatt.app' },
      { run, belongs: anywhere }
    ),
    'not-ours'
  );
  assert.equal(
    forgetLaunchedPackage(
      { appPath: '/Users/dev/src/other/Other.app' },
      { run, belongs }
    ),
    'not-ours'
  );
  assert.equal(
    forgetLaunchedPackage(
      { appPath: '/Users/dev/src/exawatt-slug/release/mac-arm64/Exawatt.app' },
      { run, belongs }
    ),
    'forgotten'
  );
  assert.deepEqual(calls, [
    [
      LSREGISTER,
      '-u',
      '/Users/dev/src/exawatt-slug/release/mac-arm64/Exawatt.app',
    ],
  ]);
  assert.equal(
    forgetLaunchedPackage(
      { appPath: '/Users/dev/src/exawatt-slug/X.app' },
      {
        run: () => {
          throw new Error('denied');
        },
        belongs,
      }
    ),
    'refused'
  );
});
