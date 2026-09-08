#!/usr/bin/env node

/**
 * Generate a committed macOS icon from its committed brand master (BUG-005).
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
 *   node scripts/generate-app-icon.mjs             regenerate the official icon
 *   node scripts/generate-app-icon.mjs --community regenerate the community icon
 *   node scripts/generate-app-icon.mjs --check     verify every distributed icon
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

export const MASTER_PATH = path.join(
  'electron',
  'resources',
  'icon-master.png'
);
export const ICNS_PATH = path.join('electron', 'resources', 'icon.icns');
export const COMMUNITY_MASTER_PATH = path.join('public', 'icon-community.png');
export const COMMUNITY_ICNS_PATH = path.join(
  'electron',
  'resources',
  'icon-community.icns'
);

const ICON_VARIANTS = Object.freeze({
  official: Object.freeze({
    id: 'official',
    masterPath: MASTER_PATH,
    icnsPath: ICNS_PATH,
    required: false,
  }),
  community: Object.freeze({
    id: 'community',
    masterPath: COMMUNITY_MASTER_PATH,
    icnsPath: COMMUNITY_ICNS_PATH,
    required: true,
  }),
});

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

export function checkCommittedIcon(
  root = process.cwd(),
  variant = ICON_VARIANTS.official
) {
  const master = path.join(root, variant.masterPath);
  const icns = path.join(root, variant.icnsPath);
  for (const file of [master, icns]) {
    if (!existsSync(file))
      throw new Error(`missing ${path.relative(root, file)}`);
  }
  return {
    ...assertIcnsMatchesMaster(
      readFileSync(icns),
      readFileSync(master),
      variant.icnsPath
    ),
    ...variant,
  };
}

/**
 * Community custody is required in every tree. Official custody is required
 * only when either half is present: the public projection deliberately omits
 * both, while a half-present private pair is always a broken build input.
 */
export function checkCommittedIcons(root = process.cwd()) {
  const checked = [];
  for (const variant of Object.values(ICON_VARIANTS)) {
    const masterExists = existsSync(path.join(root, variant.masterPath));
    const icnsExists = existsSync(path.join(root, variant.icnsPath));
    if (!variant.required && !masterExists && !icnsExists) continue;
    checked.push(checkCommittedIcon(root, variant));
  }
  return checked;
}

async function generate(root, variant) {
  const master = path.join(root, variant.masterPath);
  if (!existsSync(master)) throw new Error(`missing ${variant.masterPath}`);
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
    await execFileAsync('/usr/bin/iconutil', [
      '--convert',
      'icns',
      '--output',
      out,
      iconset,
    ]);
    const icns = readFileSync(out);
    // Never write an .icns the guard would refuse: a generator that can emit a
    // non-conformant binary is the same hand-placed asset with extra steps.
    assertIcnsMatchesMaster(icns, readFileSync(master), variant.icnsPath);
    await writeFile(path.join(root, variant.icnsPath), icns);
    console.log(
      `[app-icon] wrote ${variant.icnsPath} (${icns.length} bytes) from ${variant.masterPath}`
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function main() {
  const root = process.cwd();
  if (process.argv.includes('--check')) {
    for (const result of checkCommittedIcons(root)) {
      console.log(
        `[app-icon] ${result.icnsPath} matches ${result.masterPath} (${result.sizes.join(', ')}pt)`
      );
    }
    return;
  }
  await generate(
    root,
    process.argv.includes('--community')
      ? ICON_VARIANTS.community
      : ICON_VARIANTS.official
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(error => {
    console.error(`[app-icon] ${error.message}`);
    process.exit(1);
  });
}
