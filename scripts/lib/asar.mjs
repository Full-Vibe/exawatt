// Read an `app.asar` archive's directory with no dependencies (BUG-030).
//
// Same doctrine as `app-icon.mjs`: GENERATING the artifact may need a
// toolchain, but CHECKING it must not, because the check runs on every
// landing and in CI and a guard that cannot run is not a guard. The release
// assertions read what is actually inside the bundle, so the bundle's
// container format has to be readable from plain Node.
//
// The format is two chromium pickles followed by the file data:
//
//   [0..3]   uint32  4                  — the size pickle's payload length
//   [4..7]   uint32  headerSize         — the header pickle's total length
//   [8..11]  uint32  headerSize - 4     — the header pickle's payload length
//   [12..15] uint32  jsonLength         — the JSON directory's byte length
//   [16..]           json               — padded to a 4-byte boundary
//   [8 + headerSize..]                  — file contents, at the offsets the
//                                         JSON records relative to this point
import { closeSync, openSync, readSync, statSync } from 'node:fs';

const ALIGNMENT = 4;

function aligned(size) {
  const remainder = size % ALIGNMENT;
  return remainder === 0 ? size : size + (ALIGNMENT - remainder);
}

/** The parsed JSON directory of an asar archive. Throws if `file` is not one. */
export function readAsarDirectory(file) {
  const size = statSync(file).size;
  if (size < 16) throw new Error(`${file} is too small to be an asar archive`);
  const fd = openSync(file, 'r');
  try {
    const prefix = Buffer.alloc(16);
    readSync(fd, prefix, 0, 16, 0);
    if (prefix.readUInt32LE(0) !== ALIGNMENT) {
      throw new Error(`${file} is not an asar archive`);
    }
    const headerSize = prefix.readUInt32LE(4);
    const jsonLength = prefix.readUInt32LE(12);
    if (headerSize < 8 || 16 + jsonLength > size) {
      throw new Error(`${file} has a corrupt asar header`);
    }
    const json = Buffer.alloc(jsonLength);
    readSync(fd, json, 0, jsonLength, 16);
    return JSON.parse(json.toString('utf8'));
  } finally {
    closeSync(fd);
  }
}

/**
 * Every file in the archive as a POSIX path relative to the archive root,
 * with its recorded size. This is the whole surface the payload assertions
 * need: what is in the bundle, and how much of the user's download it is.
 */
export function asarFiles(directory) {
  const files = [];
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node?.files ?? {})) {
      const entryPath = prefix ? `${prefix}/${name}` : name;
      if (entry?.files) walk(entry, entryPath);
      else files.push({ path: entryPath, size: entry?.size ?? 0 });
    }
  };
  walk(directory, '');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

/** `readAsarDirectory` + `asarFiles` against a path. */
export function readAsarFiles(file) {
  return asarFiles(readAsarDirectory(file));
}

/** Read one packed file from an asar without extracting the archive. */
export function readAsarFile(file, entryPath) {
  const segments = entryPath.split('/').filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some(segment => segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid asar entry path: ${entryPath}`);
  }

  let entry = readAsarDirectory(file);
  for (const segment of segments) {
    entry = entry?.files?.[segment];
    if (!entry) throw new Error(`${file} has no ${entryPath}`);
  }
  if (entry.files || entry.unpacked || entry.link) {
    throw new Error(`${file} entry ${entryPath} is not a packed file`);
  }

  const offset = Number(entry.offset);
  const entrySize = Number(entry.size);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(entrySize) ||
    entrySize < 0
  ) {
    throw new Error(`${file} entry ${entryPath} has invalid bounds`);
  }

  const archiveSize = statSync(file).size;
  const fd = openSync(file, 'r');
  try {
    const prefix = Buffer.alloc(8);
    if (readSync(fd, prefix, 0, prefix.length, 0) !== prefix.length) {
      throw new Error(`${file} has a truncated asar prefix`);
    }
    const dataOffset = 8 + prefix.readUInt32LE(4);
    const position = dataOffset + offset;
    if (position < dataOffset || position + entrySize > archiveSize) {
      throw new Error(`${file} entry ${entryPath} exceeds the archive`);
    }
    const contents = Buffer.alloc(entrySize);
    if (readSync(fd, contents, 0, entrySize, position) !== entrySize) {
      throw new Error(`${file} entry ${entryPath} is truncated`);
    }
    return contents;
  } finally {
    closeSync(fd);
  }
}

/**
 * Write an asar archive containing `files` (a map of POSIX path to contents).
 *
 * The encoder exists so the release tests can build a bundle whose asar is a
 * REAL asar rather than a placeholder — the same reason `app-icon.mjs` exports
 * `encodeIcns` beside `parseIcns`. A guard tested against a fake container
 * proves nothing about the container it will actually meet.
 */
export function encodeAsar(files) {
  const directory = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [entryPath, contents] of Object.entries(files)) {
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents ?? '');
    const segments = entryPath.split('/').filter(Boolean);
    let node = directory;
    for (const segment of segments.slice(0, -1)) {
      node.files[segment] ??= { files: {} };
      node = node.files[segment];
    }
    node.files[segments.at(-1)] = { size: body.length, offset: String(offset) };
    chunks.push(body);
    offset += body.length;
  }

  const json = Buffer.from(JSON.stringify(directory), 'utf8');
  const payloadLength = ALIGNMENT + aligned(json.length);
  const headerSize = ALIGNMENT + payloadLength;
  const prefix = Buffer.alloc(16 + aligned(json.length));
  prefix.writeUInt32LE(ALIGNMENT, 0);
  prefix.writeUInt32LE(headerSize, 4);
  prefix.writeUInt32LE(payloadLength, 8);
  prefix.writeUInt32LE(json.length, 12);
  json.copy(prefix, 16);
  return Buffer.concat([prefix, ...chunks]);
}
