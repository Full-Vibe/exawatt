import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkAssetProvenance,
  findAssetImageMetadataFindings,
  sha256,
} from './check-asset-provenance.mjs';
import { findImageMetadataFindings as findGateBImageMetadataFindings } from './public-content-scan.mjs';

test('the package exposes the asset gate as an independently runnable check', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.equal(
    packageJson.scripts['assets:check'],
    'node scripts/check-asset-provenance.mjs'
  );
});

function pngChunk(type, data = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, data, Buffer.alloc(4)]);
}

function png(...chunks) {
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    ...chunks,
    pngChunk('IEND'),
  ]);
}

function jpegWithExif() {
  const payload = Buffer.from([69, 120, 105, 102, 0, 0]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    length,
    payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

function webpWithExif() {
  const payload = Buffer.from([69, 120, 105, 102, 0, 0]);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.write('EXIF', 0, 'ascii');
  chunkHeader.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([Buffer.from('WEBP'), chunkHeader, payload]);
  const riffHeader = Buffer.alloc(8);
  riffHeader.write('RIFF', 0, 'ascii');
  riffHeader.writeUInt32LE(body.length, 4);
  return Buffer.concat([riffHeader, body]);
}

function tiffWithExifDirectory() {
  const buffer = Buffer.alloc(26);
  buffer.write('II', 0, 'ascii');
  buffer.writeUInt16LE(42, 2);
  buffer.writeUInt32LE(8, 4);
  buffer.writeUInt16LE(1, 8);
  buffer.writeUInt16LE(0x8769, 10);
  buffer.writeUInt16LE(4, 12);
  buffer.writeUInt32LE(1, 14);
  buffer.writeUInt32LE(0, 18);
  buffer.writeUInt32LE(0, 22);
  return buffer;
}

function provenance(pathname, buffer, overrides = {}) {
  return {
    path: pathname,
    status: 'included',
    kind: 'test fixture',
    sha256: sha256(buffer),
    origin: 'created by the test',
    distributionBasis: 'test fixture; no distribution',
    ...overrides,
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-assets-'));
  await mkdir(path.join(root, 'public'), { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeManifest(root, assets) {
  await writeFile(
    path.join(root, 'ASSET_PROVENANCE.json'),
    `${JSON.stringify(
      { manifestVersion: 1, shippedAssetRoots: ['public'], assets },
      null,
      2
    )}\n`
  );
}

test('an included manifest asset must exist', async t => {
  const root = await fixture(t);
  await writeManifest(root, [
    provenance('public/missing.png', Buffer.from('expected')),
  ]);

  const result = await checkAssetProvenance(root);
  assert.deepEqual(
    result.findings.map(finding => [finding.file, finding.rule]),
    [['public/missing.png', 'missing-asset']]
  );
});

test('every shipped asset must be listed', async t => {
  const root = await fixture(t);
  await writeFile(path.join(root, 'public', 'unlisted.png'), png());
  await writeManifest(root, []);

  const result = await checkAssetProvenance(root);
  assert.deepEqual(
    result.findings.map(finding => [finding.file, finding.rule]),
    [['public/unlisted.png', 'unlisted-asset']]
  );
});

test('asset bytes must match the reviewed hash', async t => {
  const root = await fixture(t);
  const original = png(pngChunk('IHDR', Buffer.alloc(13)));
  const changed = png(pngChunk('IHDR', Buffer.alloc(13)), pngChunk('IDAT'));
  await writeFile(path.join(root, 'public', 'icon.png'), changed);
  await writeManifest(root, [provenance('public/icon.png', original)]);

  const result = await checkAssetProvenance(root);
  assert.deepEqual(
    result.findings.map(finding => [finding.file, finding.rule]),
    [['public/icon.png', 'asset-hash-mismatch']]
  );
});

test('PNG, JPEG, WebP, HEIC, and TIFF metadata are refused', async t => {
  const root = await fixture(t);
  const fixtures = new Map([
    [
      'public/capture.heic',
      Buffer.concat([
        Buffer.from('ftypheic', 'ascii'),
        Buffer.from('Exif', 'ascii'),
      ]),
    ],
    ['public/capture.jpg', jpegWithExif()],
    ['public/capture.png', png(pngChunk('tEXt', Buffer.from('private note')))],
    ['public/capture.tiff', tiffWithExifDirectory()],
    ['public/capture.webp', webpWithExif()],
  ]);
  for (const [pathname, buffer] of fixtures) {
    await writeFile(path.join(root, pathname), buffer);
    assert.deepEqual(
      findAssetImageMetadataFindings(buffer, pathname),
      findGateBImageMetadataFindings(buffer, pathname),
      `${pathname} must keep the same metadata semantics as Gate B`
    );
  }
  await writeManifest(
    root,
    [...fixtures].map(([pathname, buffer]) => provenance(pathname, buffer))
  );

  const result = await checkAssetProvenance(root);
  assert.deepEqual(
    result.findings.map(finding => [finding.file, finding.rule]),
    [
      ['public/capture.heic', 'image-exif-metadata'],
      ['public/capture.jpg', 'image-exif-metadata'],
      ['public/capture.png', 'png-text-metadata'],
      ['public/capture.tiff', 'image-exif-metadata'],
      ['public/capture.webp', 'image-exif-metadata'],
    ]
  );
});

test('a deliberate exclusion may exist privately or be absent from the public seed', async t => {
  const root = await fixture(t);
  const privateBytes = png(
    pngChunk('tEXt', Buffer.from('private-site metadata'))
  );
  await writeFile(
    path.join(root, 'public', 'private-site-only.png'),
    privateBytes
  );
  await writeManifest(root, [
    provenance('public/private-site-only.png', privateBytes, {
      status: 'excluded-from-public-seed',
      exclusionReason: 'private-site-only licensed material',
    }),
  ]);

  const privateResult = await checkAssetProvenance(root);
  assert.deepEqual(privateResult.findings, []);
  assert.equal(privateResult.excludedAssets, 1);

  await rm(path.join(root, 'public', 'private-site-only.png'));
  const publicSeedResult = await checkAssetProvenance(root);
  assert.deepEqual(publicSeedResult.findings, []);
  assert.equal(publicSeedResult.excludedAssets, 1);
});
