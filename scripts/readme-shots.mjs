#!/usr/bin/env node

/**
 * Regenerate the README product screenshots (OS5).
 *
 * The public README leads with two images. They are repository content under
 * the repository license, so they are generated here rather than pasted in:
 * a screenshot nobody can reproduce is a screenshot nobody can refresh, and a
 * stale one is worse than none.
 *
 * Three things this script is careful about:
 *
 * 1. **Never Personal truth.** A public asset must never carry the operator's
 *    real projects, session titles, or spend. Demo Mode is SET here, not
 *    assumed, and every shot ASSERTS its surface is showing demo content
 *    before a byte is written. Fail closed: no assertion, no file.
 * 2. **No web-build chrome.** These surfaces ship in the Mac app, which has no
 *    site header. The web header is hidden so the image shows the app's own
 *    surface. It is hidden by matching the wordmark, not by a blanket `header`
 *    rule — the Fleet status bar is a `<header>` too, and it carries the
 *    entire point of the shot.
 * 3. **No metadata, no post-processing.** Chromium's PNG encoder writes no
 *    tEXt/EXIF; ImageMagick would add `date:create` and `Software` chunks that
 *    `pnpm assets:check` then flags. So the capture geometry is exact and the
 *    bytes go straight to disk. Do not pipe these through `magick`.
 *
 * Hiding the header shifts the page up and leaves an equal band of background
 * at the bottom, so each shot is clipped by exactly the header's height. Both
 * images therefore land at the same dimensions, which is also what makes them
 * sit well together in the README.
 *
 * Run:  pnpm dev -p 7146
 *       EXA_BASE=http://localhost:7146 pnpm shots:readme
 */

import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordGeneratedAssetProvenance } from './lib/asset-provenance-record.mjs';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.EXA_BASE || 'http://localhost:7146';
const OUT_DIR = join(ROOT, 'public/images/readme');

// src/lib/tenancy/workspace-scope.ts
const ACTIVE_WORKSPACE_STORAGE_KEY = 'exawatt:active-workspace:v1';
const DEMO_WORKSPACE_ID = 'demo';

// 1600 x 1.5 = 2400px wide: retina-sharp in GitHub's ~890px README column
// without shipping a 3200px file.
const VIEWPORT = { width: 1600, height: 1000 };
const SCALE = 1.5;

const SHOTS = [
  { name: 'fleet', path: '/fleet/spatial', settleMs: 10_000 },
  { name: 'usage', path: '/usage', settleMs: 6_000 },
];

/**
 * Both surfaces mount WorkspaceScopeGate, which stamps the active tenant onto
 * the DOM. Personal truth carries no such attribute, so requiring the Demo
 * stamp is the proof that no operator data is on screen.
 */
async function assertDemoTenant(page, routePath) {
  try {
    await page
      .locator(`[data-tenant-workspace-scope="${DEMO_WORKSPACE_ID}"]`)
      .first()
      .waitFor({ state: 'attached', timeout: 30_000 });
  } catch {
    throw new Error(
      `${routePath}: the Demo tenant is not on screen. Refusing to photograph ` +
        'a surface that may be showing Personal truth.'
    );
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({
  viewport: VIEWPORT,
  deviceScaleFactor: SCALE,
  colorScheme: 'dark',
});
await primeEvalBrowserPage(page);
await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
  key: ACTIVE_WORKSPACE_STORAGE_KEY,
  value: DEMO_WORKSPACE_ID,
});

for (const shot of SHOTS) {
  await page.goto(BASE + shot.path, {
    waitUntil: 'networkidle',
    timeout: 60_000,
  });
  await assertDemoTenant(page, shot.path);
  await page.waitForTimeout(shot.settleMs);

  const headerHeight = await page.evaluate(() => {
    for (const header of document.querySelectorAll('header')) {
      if (!header.textContent?.includes('Exawatt Community')) continue;
      const { height } = header.getBoundingClientRect();
      header.style.display = 'none';
      return height;
    }
    return 0;
  });
  if (!headerHeight) {
    throw new Error(
      `${shot.path}: no site header found to hide. If the web build stopped ` +
        'rendering one, drop this step rather than shipping a clipped image.'
    );
  }
  await page.waitForTimeout(1_000); // reflow settles after the header goes

  const file = join(OUT_DIR, `${shot.name}.png`);
  await page.screenshot({
    path: file,
    clip: {
      x: 0,
      y: 0,
      width: VIEWPORT.width,
      height: VIEWPORT.height - headerHeight,
    },
  });
  const record = await recordGeneratedAssetProvenance({
    root: ROOT,
    assetPath: file,
    bytes: await readFile(file),
  });
  console.log(
    `shot ${shot.name} → ${record.relative}${record.changed ? ' (re-attested)' : ''}`
  );
}

await browser.close();
console.log(`done → ${OUT_DIR}`);
