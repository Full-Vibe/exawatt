import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { format } from 'prettier';
import {
  ALLOWED_LICENSE_EXPRESSIONS,
  flattenLicenseReport,
  normalizePlatformRows,
  renderNotice,
  runLicenseCheck,
  validateNotice,
} from './check-dependency-licenses.mjs';
import {
  isProjectedPublicManifest,
  OPEN_SOURCE_PATH_MANIFEST,
  readPathManifest,
} from './lib/open-source-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function text(file) {
  return readFile(path.join(ROOT, file), 'utf8');
}

test(
  'the reviewed dependency graph and generated notices are current',
  {
    timeout: 30_000,
  },
  async () => {
    // Exercise native and Linux policy against one real installed inventory
    // and the checked-in formatted notice, including on the macOS maintainer.
    const result = await runLicenseCheck({ additionalPlatforms: ['linux'] });
    assert.ok(result.packageVersions > 800);
  }
);

test('license report expansion is deterministic and excludes workspace code', () => {
  const rows = flattenLicenseReport({
    MIT: [
      {
        name: 'zeta',
        versions: ['2.0.0', '1.0.0'],
        license: 'MIT',
      },
      {
        name: '@exawatt/core',
        versions: ['0.0.1'],
        license: 'AGPL-3.0-or-later',
      },
    ],
    'Apache-2.0': [
      {
        name: 'alpha',
        versions: ['1.0.0'],
        license: 'Apache-2.0',
      },
    ],
  });
  assert.deepEqual(rows, [
    { name: 'alpha', version: '1.0.0', license: 'Apache-2.0' },
    { name: 'zeta', version: '1.0.0', license: 'MIT' },
    { name: 'zeta', version: '2.0.0', license: 'MIT' },
  ]);
  assert.equal(ALLOWED_LICENSE_EXPRESSIONS.has('GPL-2.0-only'), false);
});

test('reviewed native attribution follows the installed libvips version', () => {
  const rows = [
    {
      name: '@img/sharp-libvips-<platform>',
      version: '9.8.7',
      license: 'LGPL-3.0-or-later',
    },
  ];
  assert.match(renderNotice(rows), /@img\/sharp-libvips-<platform> 9\.8\.7/u);
  assert.throws(() => renderNotice([]), /no reviewed sharp-libvips row/u);
});

const inventoryFixture = [
  {
    name: '@img/sharp-libvips-<platform>',
    version: '9.8.7',
    license: 'LGPL-3.0-or-later',
  },
  { name: '@types/dependency__core', version: '1.2.3', license: 'MIT' },
  { name: 'mac-only-dependency', version: '4.5.6', license: 'Apache-2.0' },
];

async function noticeFixture() {
  const lockfileHash = 'fixture-lockfile-sha256';
  const expectedNotice = await format(
    renderNotice(inventoryFixture, lockfileHash),
    { parser: 'markdown' }
  );
  return {
    actualNotice: expectedNotice,
    expectedNotice,
    lockfileHash,
    noticeRows: inventoryFixture.slice(0, 2),
    platform: 'linux',
  };
}

test('Linux inventory comparison accepts formatted table cells, Markdown escapes and a platform subset', async () => {
  const fixture = await noticeFixture();
  assert.deepEqual(validateNotice(fixture), []);
  assert.deepEqual(
    validateNotice({
      ...fixture,
      actualNotice: renderNotice(inventoryFixture, fixture.lockfileHash),
    }),
    []
  );
});

test('Linux inventory comparison rejects missing packages, version drift and license drift with the exact tuple', async () => {
  const fixture = await noticeFixture();
  for (const change of [
    { name: 'missing-dependency' },
    { version: '2.0.0' },
    { license: 'Apache-2.0' },
  ]) {
    const missing = { ...inventoryFixture[1], ...change };
    const failures = validateNotice({ ...fixture, noticeRows: [missing] });
    assert.ok(
      failures.some(
        failure =>
          failure.includes(`${missing.name}@${missing.version}`) &&
          failure.includes(missing.license)
      ),
      failures.join('\n')
    );
  }
});

// BUG-316. rollup 4.64.6 declares `@napi-rs/lzma-linux-x64-gnu` as an
// optional dependency, so a Linux install has a package no macOS install can
// resolve, and the macOS notice can never list it. Installed manifests carry
// npm's `os` field; that is what tells it apart from a platform family member.
test('Linux inventory comparison leaves out only what no macOS install resolves', async () => {
  const fixture = await noticeFixture();
  const installed = [
    {
      name: '@napi-rs/lzma-linux-x64-gnu',
      version: '1.5.1',
      license: 'MIT',
      os: ['linux'],
    },
    { name: 'not-on-macos', version: '1.0.0', license: 'MIT', os: ['!darwin'] },
    {
      name: '@rollup/rollup-linux-x64-gnu',
      version: '4.64.6',
      license: 'MIT',
      os: ['linux'],
    },
    {
      name: 'linux-and-macos',
      version: '1.0.0',
      license: 'MIT',
      os: ['darwin', 'linux'],
    },
    { name: 'portable', version: '1.0.0', license: 'MIT' },
  ];
  const failures = validateNotice({
    ...fixture,
    noticeRows: normalizePlatformRows(installed),
  }).join('\n');
  for (const required of [
    '@rollup/rollup-<platform>@4.64.6',
    'linux-and-macos@1.0.0',
    'portable@1.0.0',
  ]) {
    assert.ok(failures.includes(required), `${required} must be listed`);
  }
  assert.doesNotMatch(failures, /lzma|not-on-macos/u);
});

test('Linux inventory comparison still requires the lockfile hash', async () => {
  const fixture = await noticeFixture();
  const failures = validateNotice({
    ...fixture,
    lockfileHash: 'different-lockfile-sha256',
  });
  assert.ok(failures.some(failure => /lockfile/i.test(failure)));
});

test('Linux inventory rows outside the inventory section cannot satisfy attribution', async () => {
  const fixture = await noticeFixture();
  assert.notDeepEqual(
    validateNotice({
      ...fixture,
      actualNotice: fixture.actualNotice.replace(
        '## Installed package inventory',
        '## Some other table'
      ),
    }),
    []
  );
});

test('macOS notice comparison retains exact formatting and the complete inventory', async () => {
  const fixture = await noticeFixture();
  assert.deepEqual(validateNotice({ ...fixture, platform: 'darwin' }), []);
  assert.notDeepEqual(
    validateNotice({
      ...fixture,
      platform: 'darwin',
      actualNotice: renderNotice(inventoryFixture, fixture.lockfileHash),
    }),
    []
  );
  assert.notDeepEqual(
    validateNotice({
      ...fixture,
      platform: 'darwin',
      actualNotice: await format(
        renderNotice(fixture.noticeRows, fixture.lockfileHash),
        { parser: 'markdown' }
      ),
    }),
    []
  );
});

test('first-party package metadata declares AGPL and the public repository', async () => {
  const expectations = new Map([
    ['package.json', undefined],
    ['packages/core/package.json', 'packages/core'],
    ['packages/ui-model/package.json', 'packages/ui-model'],
  ]);
  for (const [file, directory] of expectations) {
    const manifest = JSON.parse(await text(file));
    assert.equal(manifest.license, 'AGPL-3.0-or-later', file);
    assert.equal(
      manifest.repository.url,
      'git+https://github.com/Full-Vibe/exawatt.git',
      file
    );
    assert.equal(manifest.repository.directory, directory, file);
    if (file === 'package.json') {
      assert.equal(
        manifest.scripts['electron:prepare-licenses'],
        'node node_modules/electron/install.js'
      );
      const packageScripts = Object.entries(manifest.scripts).filter(
        ([, command]) => /\belectron-builder(?:\s|$)/u.test(command)
      );
      assert.ok(
        packageScripts.length >= 2,
        'expected the macOS build scripts to invoke electron-builder'
      );
      for (const [script, command] of packageScripts) {
        assert.match(command, /pnpm electron:prepare-licenses/u, script);
      }
      // Release custody is private (AGENTS.md): the source routes its release
      // app through the prepared build, and the public tree has no release
      // lane at all.
      const projected = isProjectedPublicManifest(
        await readPathManifest(path.join(ROOT, OPEN_SOURCE_PATH_MANIFEST))
      );
      if (projected) {
        assert.deepEqual(
          Object.keys(manifest.scripts).filter(name =>
            name.startsWith('electron:release')
          ),
          []
        );
      } else {
        assert.match(
          manifest.scripts['electron:release:app'],
          /pnpm electron:release:app:prepared/u
        );
      }
    }
  }
});

test('the Apache carve-out stays narrow and generated bindings stay AGPL', async () => {
  const licensing = await text('LICENSING.md');
  for (const pathRule of [
    'docs/product/reference/roadmap-convention.md',
    'contracts/**',
    'schemas/**',
    'examples/compatibility/**',
    'fixtures/conformance/**',
  ]) {
    assert.match(licensing, new RegExp(pathRule.replaceAll('*', '\\*')));
  }
  assert.match(
    await text('docs/product/reference/roadmap-convention.md'),
    /^<!-- SPDX-License-Identifier: Apache-2\.0 -->/u
  );
  for (const generated of [
    'packages/core/src/generated/agent-source-ids.ts',
    'src/generated/agent-source-declarations.ts',
    'electron/main/pty/generated-agent-source-declarations.ts',
  ]) {
    assert.match(
      await text(generated),
      /^\/\/ SPDX-License-Identifier: AGPL-3\.0-or-later/u,
      generated
    );
  }
});

test('cmdk attribution and legal resources survive macOS packaging config', async () => {
  const patch = await text('patches/cmdk.patch');
  assert.match(patch, /^# Third-party notice: cmdk 1\.1\.1/u);
  assert.match(patch, /Copyright \(c\) 2022 Paco Coursey/u);
  assert.match(patch, /https:\/\/github\.com\/dip\/cmdk\/issues/u);

  const builder = parse(await text('electron-builder.yml'));
  const resources = new Map(
    builder.extraResources.map(resource => [resource.from, resource.to])
  );
  assert.equal(resources.get('LICENSE'), 'licenses/AGPL-3.0.txt');
  assert.equal(resources.get('LICENSING.md'), 'licenses/LICENSING.md');
  assert.equal(
    resources.get('THIRD_PARTY_NOTICES.md'),
    'licenses/THIRD_PARTY_NOTICES.md'
  );
  assert.equal(resources.get('LICENSES'), 'licenses');
  assert.equal(
    resources.get('node_modules/electron/dist/LICENSE'),
    'licenses/Electron-LICENSE'
  );
  assert.equal(
    resources.get('node_modules/electron/dist/LICENSES.chromium.html'),
    'licenses/LICENSES.chromium.html'
  );
});
