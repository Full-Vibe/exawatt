#!/usr/bin/env node

import { lstat, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPEN_SOURCE_PATH_MANIFEST,
  createPathClassifier,
  readPathManifest,
} from './lib/open-source-paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The lookbehind deliberately excludes only characters that continue a
// local part in real text (alphanumerics, `.`, `_`, `-`, `+`). RFC atext
// also permits `` ` `` `{|}~` and friends, but in this repository those are
// code-span and template delimiters, and treating them as address characters
// made every address written as `\`user@host\`` in a doc comment invisible to
// this gate (found 2026-08-17 in `src/lib/auth/admin.ts`).
const EMAIL_PATTERN =
  /(?<![a-z0-9._+-])([a-z0-9][a-z0-9.!#$%&'*+/=?^_`{|}~-]*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})(?![a-z0-9-])/giu;
const MAC_HOME_PATTERN = /\/Users\/([^/\s"'`\\]+)/gu;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const EXIF_SIGNATURE = Buffer.from([69, 120, 105, 102, 0, 0]);
const EXIF_LABEL = Buffer.from([69, 120, 105, 102]);
const PNG_TEXT_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt']);
const IMAGE_EXTENSIONS = new Set([
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

// Reserved domains are safe fixture vocabulary. The remaining addresses are
// intentional public destinations, not operator identities: product role
// accounts plus a public maintainer contact embedded in registry lock metadata.
const APPROVED_PUBLIC_EMAILS = new Set([
  'i@izs.me',
  'legal@exawatt.ai',
  'privacy@exawatt.ai',
]);
const RESERVED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.net',
  'example.org',
]);

// These names carry no operator identity and are already conventional in
// path-oriented tests. A real person's machine name must not be added here.
const APPROVED_HOME_FIXTURES = new Set([
  'dev',
  'example',
  'fixture',
  'op',
  'operator',
  'runner',
  'shared',
  'test',
  'tester',
  'user',
  'x',
]);

function normalizedPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function locationAt(source, offset) {
  const before = source.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: lines.at(-1).length + 1 };
}

function finding(file, rule, message, source, offset = 0) {
  const location = source === undefined ? {} : locationAt(source, offset);
  return { file, ...location, rule, message };
}

export function isApprovedEmail(address) {
  const normalized = address.toLowerCase();
  // Apple iconsets require literal names such as icon_16x16@2x.png. Keep the
  // exception exact so an arbitrary image-like or unapproved address still
  // enters the publication findings.
  if (/^icon_(\d+)x\1@2x\.png$/u.test(normalized)) return true;
  if (APPROVED_PUBLIC_EMAILS.has(normalized)) return true;
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  if (RESERVED_EMAIL_DOMAINS.has(domain)) return true;
  if (
    [...RESERVED_EMAIL_DOMAINS].some(reserved =>
      domain.endsWith(`.${reserved}`)
    )
  ) {
    return true;
  }
  return domain.endsWith('.test') || domain.endsWith('.invalid');
}

function cleanHomeSegment(segment) {
  return segment.replace(/[),.;:\]}]+$/u, '');
}

export function isApprovedHomeFixture(segment) {
  const normalized = cleanHomeSegment(segment).toLowerCase();
  if (APPROVED_HOME_FIXTURES.has(normalized)) return true;
  return (
    /^<[^>]+>$/u.test(normalized) ||
    /^\$\{[^}]+\}$/u.test(normalized) ||
    /^\{[^}]+\}$/u.test(normalized) ||
    /^\[[^\]]+\]$/u.test(normalized) ||
    normalized.includes('*')
  );
}

export function findTextFindings(
  source,
  relativePath,
  forbiddenVocabulary = [],
  { allowThirdPartyEmailMetadata = false } = {}
) {
  const file = normalizedPath(relativePath);
  const findings = [];

  if (!allowThirdPartyEmailMetadata) {
    for (const match of source.matchAll(EMAIL_PATTERN)) {
      const nextCharacter = source[(match.index ?? 0) + match[0].length];
      // `git@github.com:org/repo` and `ssh://git@github.com/org/repo` are
      // remote URLs, not addresses.
      if (
        match[1].toLowerCase().startsWith('git@') &&
        (nextCharacter === ':' || nextCharacter === '/')
      ) {
        continue;
      }
      if (isApprovedEmail(match[1])) continue;
      findings.push(
        finding(
          file,
          'unapproved-email',
          'replace the real address with approved fixture vocabulary',
          source,
          match.index
        )
      );
    }
  }

  for (const match of source.matchAll(MAC_HOME_PATTERN)) {
    if (isApprovedHomeFixture(match[1])) continue;
    findings.push(
      finding(
        file,
        'operator-home-path',
        'replace the machine user with an approved fixture name',
        source,
        match.index
      )
    );
  }

  const folded = source.toLocaleLowerCase('en-US');
  for (const term of forbiddenVocabulary) {
    const offset = folded.indexOf(term.toLocaleLowerCase('en-US'));
    if (offset === -1) continue;
    findings.push(
      finding(
        file,
        'private-forbidden-vocabulary',
        'private forbidden vocabulary matched; replace it with public-safe copy',
        source,
        offset
      )
    );
  }

  return findings;
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
      findings.push({
        file: normalizedPath(relativePath),
        rule: 'png-text-metadata',
        message: `strip the PNG ${type} metadata chunk`,
      });
    }
    if (type === 'eXIf') {
      findings.push({
        file: normalizedPath(relativePath),
        rule: 'image-exif-metadata',
        message: 'strip the PNG eXIf metadata chunk',
      });
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
        {
          file: normalizedPath(relativePath),
          rule: 'image-exif-metadata',
          message: 'strip the JPEG EXIF metadata segment',
        },
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
        {
          file: normalizedPath(relativePath),
          rule: 'image-exif-metadata',
          message: 'strip the WebP EXIF metadata chunk',
        },
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
  if (!IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
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
    {
      file: normalizedPath(relativePath),
      rule: 'image-exif-metadata',
      message: 'strip the image EXIF metadata',
    },
  ];
}

export function findImageMetadataFindings(buffer, relativePath) {
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

function decodeText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) {
    return null;
  }
  return buffer.toString('utf8');
}

export async function readForbiddenVocabulary(filePath) {
  if (!filePath) return [];
  const source = await readFile(filePath, 'utf8');
  return source
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

function resolveCandidate(root, candidate) {
  const absolute = path.resolve(root, candidate);
  const relative = path.relative(root, absolute);
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `changed path must be a file inside the repository: ${candidate}`
    );
  }
  return { absolute, relative: normalizedPath(relative) };
}

export async function scanChangedFiles(
  root,
  changedPaths,
  { forbiddenVocabularyPath, classifyPath } = {}
) {
  const forbiddenVocabulary = await readForbiddenVocabulary(
    forbiddenVocabularyPath
  );
  const vocabularyAbsolute = forbiddenVocabularyPath
    ? path.resolve(forbiddenVocabularyPath)
    : null;
  const findings = [];
  let checkedFiles = 0;
  let skippedFiles = 0;

  for (const candidate of [...new Set(changedPaths)].sort()) {
    const resolved = resolveCandidate(root, candidate);
    if (resolved.absolute === vocabularyAbsolute) continue;
    let details;
    try {
      details = await lstat(resolved.absolute);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const pathPolicy = classifyPath ? classifyPath(resolved.relative) : null;
    if (
      pathPolicy &&
      ['PRIVATE', 'EXCLUDED'].includes(pathPolicy.classification)
    ) {
      skippedFiles += 1;
      continue;
    }
    if (
      pathPolicy &&
      !['PUBLIC', 'GENERATED'].includes(pathPolicy.classification)
    ) {
      throw new Error(
        'unsupported path classification ' +
          pathPolicy.classification +
          ' for ' +
          resolved.relative
      );
    }
    const textOptions = {
      allowThirdPartyEmailMetadata:
        pathPolicy?.contentPolicy?.allowThirdPartyEmailMetadata === true,
    };
    if (details.isSymbolicLink()) {
      checkedFiles += 1;
      const target = await readlink(resolved.absolute);
      findings.push(
        ...findTextFindings(
          target,
          resolved.relative,
          forbiddenVocabulary,
          textOptions
        )
      );
      continue;
    }
    if (!details.isFile()) continue;
    checkedFiles += 1;
    const buffer = await readFile(resolved.absolute);
    findings.push(...findImageMetadataFindings(buffer, resolved.relative));
    const source = decodeText(buffer);
    if (source !== null) {
      findings.push(
        ...findTextFindings(
          source,
          resolved.relative,
          forbiddenVocabulary,
          textOptions
        )
      );
    }
  }

  return { checkedFiles, skippedFiles, findings };
}

function formatFinding(entry) {
  const location = entry.line
    ? `${entry.file}:${entry.line}:${entry.column}`
    : entry.file;
  return `${location} [${entry.rule}] ${entry.message}`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      [
        'Usage: pnpm content:scan -- <changed-path>...',
        '',
        'Optionally set EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE to a',
        'newline-delimited private file. The scanner never prints its terms.',
        '',
      ].join('\n')
    );
    return;
  }

  const manifest = await readPathManifest(
    path.join(ROOT, OPEN_SOURCE_PATH_MANIFEST)
  );
  const result = await scanChangedFiles(ROOT, args, {
    forbiddenVocabularyPath:
      process.env.EXAWATT_PRIVATE_FORBIDDEN_VOCABULARY_FILE,
    classifyPath: createPathClassifier(manifest),
  });
  if (result.findings.length > 0) {
    process.stderr.write(
      [
        `[public-content] blocked ${result.findings.length} finding(s):`,
        ...result.findings.map(formatFinding),
        '',
      ].join('\n')
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    '[public-content] checked ' +
      result.checkedFiles +
      ' public-bound file(s); skipped ' +
      result.skippedFiles +
      ' private/excluded file(s)\n'
  );
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write(`[public-content] ${error.message}\n`);
    process.exitCode = 1;
  });
}
