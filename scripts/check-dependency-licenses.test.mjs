import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import {
  ALLOWED_LICENSE_EXPRESSIONS,
  flattenLicenseReport,
  renderNotice,
  runLicenseCheck,
} from './check-dependency-licenses.mjs';

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
    const result = await runLicenseCheck();
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
  assert.match(
    renderNotice(rows),
    /@img\/sharp-libvips-<platform> 9\.8\.7/u
  );
  assert.throws(
    () => renderNotice([]),
    /no reviewed sharp-libvips row/u
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
      for (const script of [
        'electron:build',
        'electron:build:dir',
        'electron:release:app',
      ]) {
        assert.match(
          manifest.scripts[script],
          /pnpm electron:prepare-licenses/u,
          script
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
