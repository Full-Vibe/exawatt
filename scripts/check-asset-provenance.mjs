#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_MANIFEST = 'ASSET_PROVENANCE.json';
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXIF_SIGNATURE = Buffer.from([69, 120, 105, 102, 0, 0]);
const EXIF_LABEL = Buffer.from([69, 120, 105, 102]);
const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);
const EXIF_IMAGE_EXTENSIONS = new Set([
  '.avif',
  '.heic',
  '.heif',
  '.jpeg',
  '.jpg',
  '.png',
  '.tif',
  '.tiff',
  '.webp',
]);

// These are source assets copied into the web or desktop distribution. Keep
// the list here, rather than in the editable manifest, so removing an
// extension cannot make a newly added asset invisible to the gate.
const SHIPPED_ASSET_EXTENSIONS = new Set([
  '.aac',
  '.avif',
  '.flac',
  '.gif',
  '.glb',
  '.gltf',
  '.heic',
  '.heif',
  '.hdr',
  '.icns',
  '.ico',
  '.jpeg',
  '.jpg',
  '.m4a',
  '.mp3',
  '.mp4',
  '.ogg',
  '.otf',
  '.pdf',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.ttf',
  '.wav',
  '.webp',
  '.webm',
  '.woff',
  '.woff2',
]);

const STATUSES = new Set(['included', 'excluded-from-public-seed']);

function imageFinding(file, rule, message) {
  return { file: normalizedPath(file), rule, message };
}

function pngMetadataFindings(buffer, relativePath) {
  if (
    buffer.length < PNG_SIGNATURE.length ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return [];
  }

  const findings = [];
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) break;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (PNG_TEXT_CHUNKS.has(type)) {
      findings.push(
        imageFinding(
          relativePath,
          'png-text-metadata',
          `strip the PNG ${type} metadata chunk`
        )
      );
    }
    if (type === 'eXIf') {
      findings.push(
        imageFinding(
          relativePath,
          'image-exif-metadata',
          'strip the PNG eXIf metadata chunk'
        )
      );
    }
    offset = chunkEnd;
    if (type === 'IEND') break;
  }
  return findings;
}

function jpegExifFindings(buffer, relativePath) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return [];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) break;
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2;
      continue;
    }
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if (
      marker === 0xe1 &&
      buffer
        .subarray(offset + 4, offset + 4 + EXIF_SIGNATURE.length)
        .equals(EXIF_SIGNATURE)
    ) {
      return [
        imageFinding(
          relativePath,
          'image-exif-metadata',
          'strip the JPEG EXIF metadata segment'
        ),
      ];
    }
    offset += 2 + length;
  }
  return [];
}

function webpExifFindings(buffer, relativePath) {
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return [];
  }
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    if (type === 'EXIF') {
      return [
        imageFinding(
          relativePath,
          'image-exif-metadata',
          'strip the WebP EXIF metadata chunk'
        ),
      ];
    }
    const next = offset + 8 + length + (length % 2);
    if (next <= offset || next > buffer.length) break;
    offset = next;
  }
  return [];
}

function tiffCarriesExif(buffer) {
  if (buffer.length < 8) return false;
  const littleEndian =
    buffer[0] === 0x49 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x2a &&
    buffer[3] === 0;
  const bigEndian =
    buffer[0] === 0x4d &&
    buffer[1] === 0x4d &&
    buffer[2] === 0 &&
    buffer[3] === 0x2a;
  if (!littleEndian && !bigEndian) return false;
  const read16 = offset =>
    littleEndian ? buffer.readUInt16LE(offset) : buffer.readUInt16BE(offset);
  const read32 = offset =>
    littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
  let directory = read32(4);
  const visited = new Set();
  while (
    directory > 0 &&
    directory + 2 <= buffer.length &&
    !visited.has(directory)
  ) {
    visited.add(directory);
    const entries = read16(directory);
    const end = directory + 2 + entries * 12;
    if (end + 4 > buffer.length) return false;
    for (let index = 0; index < entries; index += 1) {
      const tag = read16(directory + 2 + index * 12);
      if (tag === 0x8769 || tag === 0x8825) return true;
    }
    directory = read32(end);
  }
  return false;
}

function genericExifFindings(buffer, relativePath) {
  if (!EXIF_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    return [];
  }
  if (
    buffer.indexOf(EXIF_SIGNATURE) === -1 &&
    buffer.indexOf(EXIF_LABEL) === -1 &&
    !tiffCarriesExif(buffer)
  ) {
    return [];
  }
  return [
    imageFinding(
      relativePath,
      'image-exif-metadata',
      'strip the image EXIF metadata'
    ),
  ];
}

export function findAssetImageMetadataFindings(buffer, relativePath) {
  const findings = [
    ...pngMetadataFindings(buffer, relativePath),
    ...jpegExifFindings(buffer, relativePath),
    ...webpExifFindings(buffer, relativePath),
  ];
  if (findings.some(entry => entry.rule === 'image-exif-metadata')) {
    return findings;
  }
  return [...findings, ...genericExifFindings(buffer, relativePath)];
}

function normalizedPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function comparePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertRepositoryPath(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty repository-relative path`);
  }
  if (value.includes('\\')) {
    throw new Error(`${label} must use forward slashes: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error(
      `${label} must be a normalized repository-relative path: ${value}`
    );
  }
  return normalized;
}

function isInsideRoot(file, root) {
  return file === root || file.startsWith(`${root}/`);
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

export function validateAssetManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('asset provenance manifest must be a JSON object');
  }
  if (manifest.manifestVersion !== 1) {
    throw new Error('asset provenance manifestVersion must be 1');
  }
  if (
    !Array.isArray(manifest.shippedAssetRoots) ||
    manifest.shippedAssetRoots.length === 0
  ) {
    throw new Error('shippedAssetRoots must be a non-empty array');
  }
  if (!Array.isArray(manifest.assets)) {
    throw new Error('assets must be an array');
  }

  const roots = manifest.shippedAssetRoots.map((root, index) =>
    assertRepositoryPath(root, `shippedAssetRoots[${index}]`)
  );
  if (new Set(roots).size !== roots.length) {
    throw new Error('shippedAssetRoots contains duplicate paths');
  }
  if (
    roots.some(
      (root, index) => index > 0 && comparePaths(root, roots[index - 1]) < 0
    )
  ) {
    throw new Error('shippedAssetRoots must be sorted');
  }

  const seen = new Set();
  let previousPath = '';
  const assets = manifest.assets.map((asset, index) => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) {
      throw new Error(`assets[${index}] must be an object`);
    }
    const assetPath = assertRepositoryPath(asset.path, `assets[${index}].path`);
    if (seen.has(assetPath))
      throw new Error(`duplicate asset path: ${assetPath}`);
    if (previousPath && comparePaths(assetPath, previousPath) < 0) {
      throw new Error('assets must be sorted by path');
    }
    if (!roots.some(root => isInsideRoot(assetPath, root))) {
      throw new Error(`${assetPath} is outside shippedAssetRoots`);
    }
    if (
      !SHIPPED_ASSET_EXTENSIONS.has(path.posix.extname(assetPath).toLowerCase())
    ) {
      throw new Error(
        `${assetPath} does not have a recognized shipped-asset extension`
      );
    }
    if (!STATUSES.has(asset.status)) {
      throw new Error(
        `${assetPath} has unsupported status ${JSON.stringify(asset.status)}`
      );
    }
    if (!/^[a-f0-9]{64}$/u.test(asset.sha256 ?? '')) {
      throw new Error(`${assetPath} must have a lowercase SHA-256 digest`);
    }
    assertNonEmptyString(asset.kind, `${assetPath}.kind`);
    assertNonEmptyString(asset.origin, `${assetPath}.origin`);
    assertNonEmptyString(
      asset.distributionBasis,
      `${assetPath}.distributionBasis`
    );
    if (asset.status === 'excluded-from-public-seed') {
      assertNonEmptyString(
        asset.exclusionReason,
        `${assetPath}.exclusionReason`
      );
    }
    seen.add(assetPath);
    previousPath = assetPath;
    return { ...asset, path: assetPath };
  });

  return { ...manifest, shippedAssetRoots: roots, assets };
}

async function discoverAssets(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `shipped asset root does not exist: ${relativeDirectory}`
      );
    }
    throw error;
  }

  const assets = [];
  for (const entry of entries.sort((left, right) =>
    comparePaths(left.name, right.name)
  )) {
    const relative = normalizedPath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      assets.push(...(await discoverAssets(root, relative)));
      continue;
    }
    if (SHIPPED_ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      assets.push(relative);
    }
  }
  return assets;
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function checkAssetProvenance(
  root,
  manifestFile = DEFAULT_MANIFEST
) {
  const source = await readFile(path.resolve(root, manifestFile), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${manifestFile} is not valid JSON: ${error.message}`);
  }
  const manifest = validateAssetManifest(parsed);
  const discovered = (
    await Promise.all(
      manifest.shippedAssetRoots.map(assetRoot =>
        discoverAssets(root, assetRoot)
      )
    )
  )
    .flat()
    .sort(comparePaths);
  const discoveredSet = new Set(discovered);
  const listed = new Map(manifest.assets.map(asset => [asset.path, asset]));
  const findings = [];

  for (const assetPath of discovered) {
    if (!listed.has(assetPath)) {
      findings.push({
        file: assetPath,
        rule: 'unlisted-asset',
        message:
          'record the asset origin, distribution basis, and SHA-256 in ASSET_PROVENANCE.json',
      });
    }
  }

  for (const asset of manifest.assets) {
    if (!discoveredSet.has(asset.path)) {
      if (asset.status === 'included') {
        findings.push({
          file: asset.path,
          rule: 'missing-asset',
          message:
            'the manifest lists an included asset that is absent from the shipped tree',
        });
      }
      continue;
    }

    const buffer = await readFile(path.join(root, asset.path));
    const actualHash = sha256(buffer);
    if (actualHash !== asset.sha256) {
      findings.push({
        file: asset.path,
        rule: 'asset-hash-mismatch',
        message:
          'the asset bytes changed; review provenance and update the recorded SHA-256',
      });
    }
    // Deliberately excluded assets are not part of the public distribution.
    // Their hash is still pinned so a replacement cannot inherit the exception.
    if (asset.status === 'included') {
      findings.push(...findAssetImageMetadataFindings(buffer, asset.path));
    }
  }

  return {
    checkedAssets: discovered.length,
    includedAssets: manifest.assets.filter(asset => asset.status === 'included')
      .length,
    excludedAssets: manifest.assets.filter(
      asset => asset.status === 'excluded-from-public-seed'
    ).length,
    findings,
  };
}

function formatFinding(finding) {
  return `${finding.file} [${finding.rule}] ${finding.message}`;
}

async function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write(
      [
        'Usage: node scripts/check-asset-provenance.mjs [manifest-file]',
        '',
        'Checks every shipped source asset for provenance, hash drift, and image metadata.',
        '',
      ].join('\n')
    );
    return;
  }

  const manifestFile = process.argv[2] ?? DEFAULT_MANIFEST;
  const result = await checkAssetProvenance(ROOT, manifestFile);
  if (result.findings.length > 0) {
    process.stderr.write(
      [
        `[asset-provenance] blocked ${result.findings.length} finding(s):`,
        ...result.findings.map(formatFinding),
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `[asset-provenance] checked ${result.checkedAssets} asset(s): ` +
      `${result.includedAssets} included, ${result.excludedAssets} excluded\n`
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[asset-provenance] ${error.message}\n`);
    process.exitCode = 1;
  });
}
