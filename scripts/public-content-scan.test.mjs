import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  findImageMetadataFindings,
  findTextFindings,
  scanChangedFiles,
} from './public-content-scan.mjs';

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

test('generic text checks reject real identities and accept fixture vocabulary', () => {
  const unapprovedEmail = ['person', 'company.dev'].join('@');
  const unapprovedHome = ['/Users', 'specific-name', 'project'].join('/');
  const findings = findTextFindings(
    `${unapprovedEmail}\n${unapprovedHome}`,
    'fixture.txt'
  );
  assert.deepEqual(
    findings.map(entry => entry.rule),
    ['unapproved-email', 'operator-home-path']
  );

  assert.deepEqual(
    findTextFindings(
      [
        'agent@example.com',
        'agent@source.test',
        'privacy@exawatt.ai',
        'git@github.com:example/repository.git',
        '/Users/tester/project',
        '/Users/<name>/project',
      ].join('\n'),
      'clean-fixture.txt'
    ),
    []
  );
});

test('PNG text chunks and image EXIF are rejected while clean images pass', () => {
  const cleanPng = png(pngChunk('IHDR', Buffer.alloc(13)));
  assert.deepEqual(findImageMetadataFindings(cleanPng, 'clean.png'), []);

  const pngWithText = png(
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('note'))
  );
  assert.deepEqual(
    findImageMetadataFindings(pngWithText, 'annotated.png').map(
      entry => entry.rule
    ),
    ['png-text-metadata']
  );

  const exifPayload = Buffer.from([69, 120, 105, 102, 0, 0]);
  const segmentLength = Buffer.alloc(2);
  segmentLength.writeUInt16BE(exifPayload.length + 2);
  const jpegWithExif = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    segmentLength,
    exifPayload,
    Buffer.from([0xff, 0xd9]),
  ]);
  assert.deepEqual(
    findImageMetadataFindings(jpegWithExif, 'capture.jpg').map(
      entry => entry.rule
    ),
    ['image-exif-metadata']
  );

  const heicWithExifItem = Buffer.concat([
    Buffer.from('ftypheic', 'ascii'),
    Buffer.from([69, 120, 105, 102]),
  ]);
  assert.deepEqual(
    findImageMetadataFindings(heicWithExifItem, 'capture.heic').map(
      entry => entry.rule
    ),
    ['image-exif-metadata']
  );
});

test('changed-file scan checks positive and negative fixtures and skips deletes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-content-scan-'));
  t.after(() =>
    import('node:fs/promises').then(fs => fs.rm(root, { recursive: true }))
  );
  const unapprovedEmail = ['person', 'company.dev'].join('@');
  const unapprovedHome = ['/Users', 'specific-name', 'project'].join('/');
  await writeFile(path.join(root, 'clean.md'), 'agent@example.com\n');
  await writeFile(path.join(root, 'leak.md'), `${unapprovedEmail}\n`);
  await symlink(unapprovedHome, path.join(root, 'linked-project'));

  const result = await scanChangedFiles(root, [
    'deleted.md',
    'clean.md',
    'leak.md',
    'linked-project',
    'clean.md',
  ]);
  assert.equal(result.checkedFiles, 3);
  assert.deepEqual(
    result.findings.map(entry => [entry.file, entry.rule]),
    [
      ['leak.md', 'unapproved-email'],
      ['linked-project', 'operator-home-path'],
    ]
  );
});

test('private vocabulary is optional, private, and redacted from findings', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'exawatt-private-vocab-'));
  t.after(() =>
    import('node:fs/promises').then(fs => fs.rm(root, { recursive: true }))
  );
  const vocabulary = path.join(root, '.private-vocabulary');
  const privateTerm = ['hidden', 'launch'].join(' ');
  await writeFile(vocabulary, `# private company-side input\n${privateTerm}\n`);
  await writeFile(
    path.join(root, 'copy.md'),
    `The ${privateTerm} is pending.\n`
  );

  const withoutPrivatePolicy = await scanChangedFiles(root, ['copy.md']);
  assert.deepEqual(withoutPrivatePolicy.findings, []);

  const withPrivatePolicy = await scanChangedFiles(
    root,
    ['.private-vocabulary', 'copy.md'],
    { forbiddenVocabularyPath: vocabulary }
  );
  assert.deepEqual(
    withPrivatePolicy.findings.map(entry => entry.rule),
    ['private-forbidden-vocabulary']
  );
  assert.doesNotMatch(
    JSON.stringify(withPrivatePolicy.findings),
    /hidden launch/i
  );
});
