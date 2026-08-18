// Generated for the public repository by the "public-dogfood-tooling" recipe.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareDistribution } from './lib/distribution-build.mjs';
import { encodeAsar } from './lib/asar.mjs';
import {
  assertPackagedContract,
  assertPackagedSource,
  readPackagedBuildInfo,
  resolvePackagedApp,
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
  assert.equal(
    official.identity.iconPath,
    'electron/resources/icon.icns'
  );
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
