// Generated for the public repository by the "public-update-config-test" recipe.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const {
  appUpdateConfig,
  resolvePublishConfig,
  writeAppUpdateConfig,
} = require('./app-update-config.cjs');

const GENERIC = {
  provider: 'generic',
  url: 'https://example.test/desktop-updates/macos/arm64',
};

test('the written config carries the provider, the url, and the cache dir', () => {
  assert.deepEqual(
    appUpdateConfig({
      publish: GENERIC,
      updaterCacheDirName: 'exawatt-updater',
    }),
    { ...GENERIC, updaterCacheDirName: 'exawatt-updater' }
  );
});

test('the platform publish block wins over the top level', () => {
  const platform = { provider: 'generic', url: 'https://mac.example.test' };
  assert.equal(
    appUpdateConfig({
      publish: GENERIC,
      platformPublish: platform,
      updaterCacheDirName: 'exawatt-updater',
    }).url,
    platform.url
  );
});

test('the first entry wins, matching publishConfigs[0]', () => {
  assert.equal(
    resolvePublishConfig([GENERIC, { provider: 'github' }]),
    GENERIC
  );
});

test('a bare provider string is a config', () => {
  assert.deepEqual(resolvePublishConfig('github'), { provider: 'github' });
});

// Each of these produced a build that fails on every launch, which is the
// failure BUG-015 shipped six times. They must be loud at build time.
test('no publish configuration is a build error, not an empty file', () => {
  assert.throws(
    () => appUpdateConfig({ updaterCacheDirName: 'exawatt-updater' }),
    /No publish configuration/
  );
});

test('a publish entry with no provider is a build error', () => {
  assert.throws(
    () =>
      appUpdateConfig({
        publish: { url: 'https://example.test' },
        updaterCacheDirName: 'exawatt-updater',
      }),
    /no provider/
  );
});

test('a missing updaterCacheDirName is a build error', () => {
  assert.throws(
    () => appUpdateConfig({ publish: GENERIC }),
    /updaterCacheDirName/
  );
});

test('the hook writes parseable yaml into the bundle Resources', async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'exa-app-update-'));
  try {
    const resources = path.join(out, 'Exawatt.app', 'Contents', 'Resources');
    mkdirSync(resources, { recursive: true });
    await writeAppUpdateConfig({
      electronPlatformName: 'darwin',
      appOutDir: out,
      packager: {
        config: { publish: GENERIC },
        platformSpecificBuildOptions: {},
        appInfo: {
          productFilename: 'Exawatt',
          updaterCacheDirName: 'exawatt-updater',
        },
      },
    });
    const written = path.join(resources, 'app-update.yml');
    assert.ok(existsSync(written), 'app-update.yml was not written');
    assert.deepEqual(parse(readFileSync(written, 'utf8')), {
      ...GENERIC,
      updaterCacheDirName: 'exawatt-updater',
    });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('a non-darwin pack writes nothing', async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'exa-app-update-'));
  try {
    await writeAppUpdateConfig({
      electronPlatformName: 'win32',
      appOutDir: out,
      packager: null,
    });
    assert.equal(existsSync(path.join(out, 'Exawatt.app')), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

