/**
 * The macOS app icon, as data the release path can check (BUG-005).
 *
 * `electron/resources/icon.icns` shipped the WEB FAVICON for six releases: a
 * bare transparent hexagon ring, off-centre and taller than wide, with no
 * container at all. Packaging was correct the whole time — the bundle's
 * `icon.icns` was byte-identical to the repo's and `CFBundleIconFile` resolved
 * to it — so every existing check passed while the Dock showed a naked glyph
 * among squircles.
 *
 * A binary asset nobody can read is a binary asset nobody can check. These
 * helpers decode `.icns`/PNG far enough to answer three questions about a
 * REAL bundle: is this the committed artwork, is it the artwork we generated
 * from the brand master, and is it shaped like a macOS app icon at all.
 *
 * Deliberately dependency-free (`node:zlib` only). The release path already
 * runs on a machine with no image toolchain guaranteed, and a guard that
 * cannot run is not a guard.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC-32 (PNG chunk checksums). */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function isPng(buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/**
 * Decode a non-interlaced 8-bit truecolour PNG to RGBA.
 *
 * That is the only shape `.icns` slices take (colour type 6 or 2, depth 8,
 * interlace 0) and the only shape the generator writes, so anything else is a
 * signal the asset was produced by an unexpected tool, not a case to support.
 */
export function decodePng(buffer) {
  if (!isPng(buffer)) throw new Error('not a PNG');
  let offset = 8;
  let header = null;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  if (!header) throw new Error('PNG has no IHDR');
  const { width, height, bitDepth, colorType, interlace } = header;
  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(
      `unsupported PNG (bitDepth ${bitDepth}, colorType ${colorType}, interlace ${interlace}); ` +
        'app icon slices must be 8-bit non-interlaced RGB/RGBA'
    );
  }

  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      if (filter === 1) line[x] = (line[x] + a) & 0xff;
      else if (filter === 2) line[x] = (line[x] + b) & 0xff;
      else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) line[x] = (line[x] + paeth(a, b, c)) & 0xff;
      else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
    }
    for (let x = 0; x < width; x += 1) {
      const to = (y * width + x) * 4;
      const from = x * channels;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous = line;
  }
  return { width, height, data: out };
}

/** Encode RGBA pixels as a PNG (used to build fixtures and fake bundles). */
export function encodePng({ width, height, data }) {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1
    );
  }
  const chunk = (type, body) => {
    const out = Buffer.alloc(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** `.icns` is a flat list of 4-byte-tagged chunks after an 8-byte header. */
export function parseIcns(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'icns') throw new Error('not an .icns file');
  const declared = buffer.readUInt32BE(4);
  if (declared !== buffer.length) {
    throw new Error(`.icns declares ${declared} bytes but is ${buffer.length}`);
  }
  const chunks = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > buffer.length) {
      throw new Error(`.icns chunk ${type} has a bad length ${length}`);
    }
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + length) });
    offset += length;
  }
  return chunks;
}

export function encodeIcns(chunks) {
  const bodies = chunks.map(({ type, data }) => {
    const out = Buffer.alloc(8 + data.length);
    out.write(type, 0, 'ascii');
    out.writeUInt32BE(8 + data.length, 4);
    data.copy(out, 8);
    return out;
  });
  const body = Buffer.concat(bodies);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

/** Every PNG-carrying slice in an `.icns`, decoded, largest first. */
export function icnsImageSlices(buffer) {
  return parseIcns(buffer)
    .filter(chunk => isPng(chunk.data))
    .map(chunk => ({ type: chunk.type, png: chunk.data, image: decodePng(chunk.data) }))
    .sort((a, b) => b.image.width - a.image.width);
}

const BBOX_ALPHA = 16;
const SOLID_ALPHA = 200;

/**
 * Reduce an icon slice to the four numbers that separate an app icon from a
 * favicon: how much of the canvas the artwork spans, whether that span is
 * square, whether it is centred, and how solidly it fills its own box.
 */
export function measureIcon({ width, height, data }) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3] < BBOX_ALPHA) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) {
    return { width, height, empty: true };
  }
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  let solid = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (data[(y * width + x) * 4 + 3] >= SOLID_ALPHA) solid += 1;
    }
  }
  return {
    width,
    height,
    empty: false,
    box: { x: minX, y: minY, width: boxWidth, height: boxHeight },
    // fraction of the canvas the artwork spans on each axis
    spanX: boxWidth / width,
    spanY: boxHeight / height,
    // how far the artwork's centre sits from the canvas centre, as a fraction
    offsetX: (minX + maxX + 1 - width) / 2 / width,
    offsetY: (minY + maxY + 1 - height) / 2 / height,
    // how much of its own bounding box the artwork actually paints. A squircle
    // container is ~0.96; a bare ring glyph is roughly half that.
    fill: solid / (boxWidth * boxHeight),
  };
}

/**
 * The macOS icon grid, as tolerances (recipe: 824pt container centred on a
 * 1024pt canvas, corner radius 185).
 *
 * `span` brackets 824/1024 = 0.805 loosely enough for antialiasing at small
 * slices but tightly enough to refuse the favicon (0.695 x 0.797 — a glyph
 * drawn to no container, so its span is whatever the artwork happened to be).
 * `fill` is the assertion that a container exists at all: the squircle paints
 * 0.90-0.96 of its bounding box across slices, the shipped hexagon ring paints
 * 0.49-0.53 and leaves the corners fully transparent, which is exactly why it
 * read as a naked glyph in the Dock.
 */
export const APPLE_GRID = {
  minSpan: 0.74,
  maxSpan: 0.87,
  maxOffset: 0.02,
  maxAspectSkew: 0.03,
  minFill: 0.85,
};

/**
 * Throw unless a decoded slice is shaped like a macOS app icon.
 *
 * Applied to slices of 64pt and up. Below that a 1px antialiased edge is
 * several percent of the canvas, so the numbers stop separating a good icon
 * from a bad one, and the small slices are generated from the same master as
 * the large ones anyway.
 */
export function assertAppleIconGrid(image, label = 'icon') {
  const m = measureIcon(image);
  const fail = reason => {
    throw new Error(`${label} does not conform to the macOS icon grid: ${reason}`);
  };
  if (image.width !== image.height) {
    fail(`canvas is ${image.width}x${image.height}, not square`);
  }
  if (m.empty) fail('the canvas is fully transparent');
  if (Math.abs(m.spanX - m.spanY) > APPLE_GRID.maxAspectSkew) {
    fail(
      `artwork is ${m.box.width}x${m.box.height}, not square ` +
        `(span ${m.spanX.toFixed(3)} x ${m.spanY.toFixed(3)}). ` +
        'A macOS icon is a square container, not free-standing artwork.'
    );
  }
  for (const [axis, span] of [
    ['width', m.spanX],
    ['height', m.spanY],
  ]) {
    if (span < APPLE_GRID.minSpan || span > APPLE_GRID.maxSpan) {
      fail(
        `artwork spans ${(span * 100).toFixed(1)}% of the canvas ${axis}, ` +
          `outside the ${APPLE_GRID.minSpan * 100}-${APPLE_GRID.maxSpan * 100}% ` +
          'macOS container band (824 of 1024).'
      );
    }
  }
  for (const [axis, offset] of [
    ['horizontally', m.offsetX],
    ['vertically', m.offsetY],
  ]) {
    if (Math.abs(offset) > APPLE_GRID.maxOffset) {
      fail(`artwork is off-centre ${axis} by ${(offset * 100).toFixed(1)}% of the canvas`);
    }
  }
  if (m.fill < APPLE_GRID.minFill) {
    fail(
      `artwork paints only ${(m.fill * 100).toFixed(1)}% of its own bounds ` +
        `(a container fills ~96%). This is a bare glyph with transparent ` +
        'corners, so it renders as a floating shape among squircles.'
    );
  }
  return m;
}

export const MASTER_SLICE_TYPE = 'ic10';
const REQUIRED_SLICE_SIZES = [32, 64, 128, 256, 512, 1024];
/**
 * `iconutil` writes the 16pt and 32pt representations as raw ARGB (`ic04`,
 * `ic05`) alongside the PNG slices, and Finder's small list views read those.
 * An `.icns` produced by a tool that only emits PNG chunks looks fine in the
 * Dock and renders generically in a list, so require them by presence.
 */
const REQUIRED_RAW_TYPES = ['ic04', 'ic05'];
const GRID_CHECK_MIN_SIZE = 64;

/**
 * Throw unless an `.icns` is the icon we generate from the committed brand
 * master, and unless every slice in it is a conformant app icon.
 *
 * The 1024 slice is compared pixel-for-pixel because the generator writes it
 * from the master unresized: if those two ever diverge, someone hand-edited a
 * binary, which is the failure this whole file exists to make impossible.
 */
export function assertIcnsMatchesMaster(icns, masterPng, label = 'icon.icns') {
  const master = decodePng(masterPng);
  if (master.width !== 1024 || master.height !== 1024) {
    throw new Error(`the icon master must be 1024x1024, got ${master.width}x${master.height}`);
  }
  const chunks = parseIcns(icns);
  const slices = icnsImageSlices(icns);
  const sizes = new Set(slices.map(slice => slice.image.width));
  for (const size of REQUIRED_SLICE_SIZES) {
    if (!sizes.has(size)) {
      throw new Error(
        `${label} has no ${size}pt slice (has ${[...sizes].join(', ') || 'none'}). ` +
          'Regenerate it with `pnpm icon:generate`.'
      );
    }
  }
  for (const type of REQUIRED_RAW_TYPES) {
    if (!chunks.some(chunk => chunk.type === type)) {
      throw new Error(
        `${label} has no ${type} chunk, so Finder's small representations fall ` +
          'back to a generic icon. Regenerate it with `pnpm icon:generate`.'
      );
    }
  }
  // Shape before provenance: "this is not an app icon" is the more actionable
  // failure, and it is the one that refuses the favicon that actually shipped.
  for (const slice of slices) {
    if (slice.image.width < GRID_CHECK_MIN_SIZE) continue;
    assertAppleIconGrid(slice.image, `${label} ${slice.image.width}pt slice`);
  }
  const largest = slices.find(slice => slice.type === MASTER_SLICE_TYPE) ?? slices[0];
  if (!largest || largest.image.width !== 1024) {
    throw new Error(`${label} has no 1024pt ${MASTER_SLICE_TYPE} slice`);
  }
  if (Buffer.compare(Buffer.from(largest.image.data), Buffer.from(master.data)) !== 0) {
    throw new Error(
      `${label}'s 1024pt slice does not match the committed master. ` +
        'The .icns was edited by hand or generated from different artwork; ' +
        'run `pnpm icon:generate` so the binary is derived from the master again.'
    );
  }
  return { slices: slices.length, sizes: [...sizes].sort((a, b) => a - b) };
}
