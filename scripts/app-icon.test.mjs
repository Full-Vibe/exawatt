import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLE_GRID,
  assertAppleIconGrid,
  assertIcnsMatchesMaster,
  decodePng,
  encodeIcns,
  encodePng,
  icnsImageSlices,
  measureIcon,
  parseIcns,
} from './lib/app-icon.mjs';
import { checkCommittedIcon, ICNS_PATH, MASTER_PATH } from './generate-app-icon.mjs';

const ICNS = readFileSync(ICNS_PATH);
const MASTER = readFileSync(MASTER_PATH);

function canvas(size) {
  return { width: size, height: size, data: new Uint8Array(size * size * 4) };
}

function paint(image, x, y) {
  const i = (y * image.width + x) * 4;
  image.data[i] = 90;
  image.data[i + 1] = 60;
  image.data[i + 2] = 250;
  image.data[i + 3] = 255;
}

/** A filled square container: what a macOS app icon is. */
function square(size, { span = 0.805, offsetX = 0, offsetY = 0, aspect = 1 } = {}) {
  const image = canvas(size);
  const width = Math.round(size * span);
  const height = Math.round(size * span * aspect);
  const left = Math.round((size - width) / 2 + offsetX * size);
  const top = Math.round((size - height) / 2 + offsetY * size);
  for (let y = top; y < top + height; y += 1) {
    for (let x = left; x < left + width; x += 1) paint(image, x, y);
  }
  return image;
}

/** A free-standing glyph: artwork with no container, so its corners are
 *  transparent and it floats among the squircles in the Dock. */
function glyph(size, { span = 0.805 } = {}) {
  const image = canvas(size);
  const radius = (size * span) / 2;
  const centre = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      if (dx * dx + dy * dy <= radius * radius) paint(image, x, y);
    }
  }
  return image;
}

test('the committed icon.icns is the icon generated from the committed master', () => {
  const { sizes } = checkCommittedIcon();
  assert.deepEqual(sizes, [32, 64, 128, 256, 512, 1024]);
});

// The exact artwork that shipped as the macOS app icon from v0.1.4 to v0.1.9:
// correct as a favicon, and as an app icon a bare hexagon ring with no
// container, off-centre and taller than wide (BUG-005). One brand source was
// doing two jobs that need different renderings, and nothing could tell.
test('the web favicon is refused as an app icon', () => {
  const favicon = decodePng(readFileSync('src/app/icon.png'));
  const measured = measureIcon(favicon);
  assert.ok(measured.fill < 0.6, `favicon fills ${measured.fill} of its bounds`);
  assert.throws(
    () => assertAppleIconGrid(favicon, 'src/app/icon.png'),
    /not square|paints only/
  );
});

test('a container that fills the Apple grid conforms', () => {
  for (const size of [64, 128, 512, 1024]) {
    assertAppleIconGrid(square(size), `${size}pt`);
  }
});

test('a free-standing glyph is refused for having no container', () => {
  assert.throws(() => assertAppleIconGrid(glyph(512)), /paints only/);
});

test('a container smaller than the grid is refused', () => {
  assert.throws(() => assertAppleIconGrid(square(512, { span: 0.6 })), /outside the/);
});

test('a container larger than the grid is refused', () => {
  assert.throws(() => assertAppleIconGrid(square(512, { span: 0.95 })), /outside the/);
});

test('an off-centre container is refused', () => {
  assert.throws(
    () => assertAppleIconGrid(square(512, { span: 0.78, offsetX: 0.05 })),
    /off-centre horizontally/
  );
});

test('a non-square container is refused', () => {
  assert.throws(() => assertAppleIconGrid(square(512, { aspect: 0.85 })), /not square/);
});

test('a non-square canvas is refused', () => {
  const wide = square(512);
  assert.throws(
    () => assertAppleIconGrid({ ...wide, height: 256, data: wide.data.slice(0, 512 * 256 * 4) }),
    /not square/
  );
});

test('an empty canvas is refused', () => {
  assert.throws(() => assertAppleIconGrid(canvas(512)), /fully transparent/);
});

test('PNG encode and decode round-trip', () => {
  const image = square(64);
  const decoded = decodePng(encodePng(image));
  assert.equal(decoded.width, 64);
  assert.deepEqual([...decoded.data], [...image.data]);
});

test('icns encode and parse round-trip', () => {
  const chunks = [
    { type: 'ic10', data: encodePng(square(1024)) },
    { type: 'ic04', data: Buffer.from('ARGBraw') },
  ];
  assert.deepEqual(
    parseIcns(encodeIcns(chunks)).map(chunk => chunk.type),
    ['ic10', 'ic04']
  );
});

function withSliceReplaced(type, png) {
  return encodeIcns(
    parseIcns(ICNS).map(chunk => (chunk.type === type ? { type, data: png } : chunk))
  );
}

test('an .icns whose master slice is different artwork is refused', () => {
  const swapped = withSliceReplaced('ic10', encodePng(square(1024, { span: 0.79 })));
  assert.throws(() => assertIcnsMatchesMaster(swapped, MASTER), /does not match the committed master/);
});

test('an .icns carrying the favicon in its master slice is refused', () => {
  const swapped = withSliceReplaced('ic10', readFileSync('src/app/icon.png'));
  assert.throws(() => assertIcnsMatchesMaster(swapped, MASTER), /macOS icon grid/);
});

test('an .icns missing a size is refused', () => {
  const stripped = encodeIcns(parseIcns(ICNS).filter(chunk => chunk.type !== 'ic07'));
  assert.throws(() => assertIcnsMatchesMaster(stripped, MASTER), /has no 128pt slice/);
});

test('an .icns missing the raw small representations is refused', () => {
  const stripped = encodeIcns(parseIcns(ICNS).filter(chunk => chunk.type !== 'ic04'));
  assert.throws(() => assertIcnsMatchesMaster(stripped, MASTER), /has no ic04 chunk/);
});

test('every generated slice clears the grid thresholds with margin', () => {
  for (const slice of icnsImageSlices(ICNS)) {
    if (slice.image.width < 64) continue;
    const m = measureIcon(slice.image);
    assert.ok(
      m.fill > APPLE_GRID.minFill + 0.03,
      `${slice.type} fills only ${m.fill.toFixed(3)}`
    );
  }
});
