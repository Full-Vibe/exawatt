#!/usr/bin/env node

/**
 * Generate `electron/resources/icon.icns` from the committed brand master
 * (BUG-005).
 *
 * The app icon used to be a hand-placed binary, and what it actually contained
 * was the web favicon: a bare transparent hexagon ring with no container,
 * off-centre and taller than wide. Nothing could tell, because nothing read
 * it. Now there is exactly one editable source — `icon-master.png`, a 1024pt
 * render of the operator-approved direction (gradient squircle container,
 * hexagon glyph knocked out in white) — and the `.icns` is derived from it.
 *
 * The generated `.icns` is COMMITTED, and `--check` verifies the committed
 * binary against the committed master with no image toolchain at all. The
 * alternative (render at build time) would put ImageMagick on the critical
 * path of every release, on runners where it is not installed by default, to
 * recreate a file that never changes between releases. Generation is the rare
 * step and may need tools; checking is the every-build step and must not.
 *
 * The master must be a 1024x1024 8-bit RGBA PNG:
 *   magick artwork.png -depth 8 -strip PNG32:electron/resources/icon-master.png
 *
 * Usage:
 *   node scripts/generate-app-icon.mjs           regenerate the .icns
 *   node scripts/generate-app-icon.mjs --check   verify the committed .icns
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { assertIcnsMatchesMaster } from './lib/app-icon.mjs';

const execFileAsync = promisify(execFile);

export const MASTER_PATH = path.join('electron', 'resources', 'icon-master.png');
export const ICNS_PATH = path.join('electron', 'resources', 'icon.icns');

/** The .iconset names macOS expects, and the pixel size each one is. */
const SLICES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

const MAGICK = process.env.EXAWATT_MAGICK || '/opt/homebrew/bin/magick';

export function checkCommittedIcon(root = process.cwd()) {
  const master = path.join(root, MASTER_PATH);
  const icns = path.join(root, ICNS_PATH);
  for (const file of [master, icns]) {
    if (!existsSync(file)) throw new Error(`missing ${path.relative(root, file)}`);
  }
  return assertIcnsMatchesMaster(readFileSync(icns), readFileSync(master), ICNS_PATH);
}

async function generate(root) {
  const master = path.join(root, MASTER_PATH);
  if (!existsSync(master)) throw new Error(`missing ${MASTER_PATH}`);
  if (!existsSync(MAGICK)) {
    throw new Error(
      `ImageMagick 7 not found at ${MAGICK}. Generation needs it (checking does ` +
        'not). Install it, or set EXAWATT_MAGICK.'
    );
  }
  const staging = await mkdtemp(path.join(tmpdir(), 'exawatt-icon-'));
  const iconset = path.join(staging, 'icon.iconset');
  try {
    await execFileAsync('/bin/mkdir', ['-p', iconset]);
    for (const [name, size] of SLICES) {
      if (size === 1024) {
        // The 1024pt slice is the master itself, copied rather than resampled,
        // so the guard can compare it to the master pixel-for-pixel. Round-
        // tripping it through the resizer changes transparent pixels and turns
        // that exact comparison into a fuzzy one for no gain.
        await execFileAsync('/bin/cp', [master, path.join(iconset, name)]);
        continue;
      }
      await execFileAsync(MAGICK, [
        master,
        '-filter',
        'Lanczos',
        '-resize',
        `${size}x${size}`,
        '-depth',
        '8',
        '-strip',
        `PNG32:${path.join(iconset, name)}`,
      ]);
    }
    const out = path.join(staging, 'icon.icns');
    await execFileAsync('/usr/bin/iconutil', ['--convert', 'icns', '--output', out, iconset]);
    const icns = readFileSync(out);
    // Never write an .icns the guard would refuse: a generator that can emit a
    // non-conformant binary is the same hand-placed asset with extra steps.
    assertIcnsMatchesMaster(icns, readFileSync(master), ICNS_PATH);
    await writeFile(path.join(root, ICNS_PATH), icns);
    console.log(`[app-icon] wrote ${ICNS_PATH} (${icns.length} bytes) from ${MASTER_PATH}`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const root = process.cwd();
  if (process.argv.includes('--check')) {
    const { sizes } = checkCommittedIcon(root);
    console.log(`[app-icon] ${ICNS_PATH} matches ${MASTER_PATH} (${sizes.join(', ')}pt)`);
    return;
  }
  await generate(root);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    console.error(`[app-icon] ${error.message}`);
    process.exit(1);
  });
}
