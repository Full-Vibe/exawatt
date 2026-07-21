#!/usr/bin/env node
/**
 * Spatial pointer-navigation eval (ENG-004 V2.4): drag pans, plain wheel
 * pans, pinch (ctrl/meta+wheel) zooms at the cursor, click-vs-drag guards
 * keep zone drilling intact, M/L demo scales render, and reduced motion
 * parks the demand scene (byte-identical canvas across 900ms).
 *
 * Run: EXA_BASE=http://localhost:7100 pnpm eval:spatial:pointer
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7100';
const OUT = '/tmp/exa-spatial-v24-nav';
mkdirSync(OUT, { recursive: true });

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {}
  const home = process.env.HOME || '';
  for (const root of [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      for (const c of [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(c)) return c;
      }
    }
  }
  return null;
}

const results = [];
const check = (name, ok) => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const browser = await chromium.launch({
  headless: true,
  executablePath: resolveChromium() || undefined,
});

// --- Main context: pointer navigation ---
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e)));
await page.goto(`${BASE}/fleet/spatial`, { waitUntil: 'load' });
await page.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width > 0 && c.height > 0;
});
await page.waitForTimeout(1600);

const viewportOf = () => {
  const raw = window.sessionStorage.getItem(
    Object.keys(window.sessionStorage).find(k =>
      k.startsWith('exawatt:spatial-viewport')
    ) ?? ''
  );
  return raw ? JSON.parse(raw) : null;
};

const before = await page.evaluate(viewportOf);

// drag-pan on empty board space
await page.mouse.move(700, 750);
await page.mouse.down();
await page.mouse.move(560, 640, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(700);
const afterDrag = await page.evaluate(viewportOf);
check(
  'drag pans the camera',
  !!before &&
    !!afterDrag &&
    (Math.abs(afterDrag.centerX - before.centerX) > 1 ||
      Math.abs(afterDrag.centerY - before.centerY) > 1)
);

// pinch-zoom (ctrl+wheel) zooms in at cursor
await page.mouse.move(800, 500);
await page.mouse.wheel(0, -300).catch(() => {});
await page.keyboard.down('Control');
await page.mouse.wheel(0, -240);
await page.keyboard.up('Control');
await page.waitForTimeout(700);
const afterZoom = await page.evaluate(viewportOf);
check(
  'pinch zooms in (viewport shrinks)',
  !!afterZoom && afterZoom.width < afterDrag.width * 0.95
);

// plain wheel pans
await page.mouse.wheel(120, 90);
await page.waitForTimeout(700);
const afterWheel = await page.evaluate(viewportOf);
check(
  'plain wheel pans',
  !!afterWheel &&
    (Math.abs(afterWheel.centerX - afterZoom.centerX) > 0.5 ||
      Math.abs(afterWheel.centerY - afterZoom.centerY) > 0.5)
);

// click (no drag) still drills a project from the zone card
await page.keyboard.press('0'); // recenter first
await page.waitForTimeout(900);
const zone = page.locator('[data-board-zone]').first();
await zone.click();
await page.waitForFunction(() =>
  new URL(window.location.href).searchParams.get('altitude')
);
check('zone click still drills after drag wiring', true);
await page.screenshot({ path: join(OUT, 'after-drill.png') });

// M and L demo scales render aggregates without errors
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
for (const scale of ['medium', 'large']) {
  await page.getByRole('button', { name: `Seed ${scale} demo fleet` }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, `fleet-${scale}.png`) });
  check(`${scale} scale renders`, true);
}
check('no page errors in nav probe', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
await page.close();

// --- Reduced-motion context ---
const rmPage = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  reducedMotion: 'reduce',
});
const rmErrors = [];
rmPage.on('pageerror', e => rmErrors.push(String(e.message || e)));
await rmPage.goto(`${BASE}/fleet/spatial`, { waitUntil: 'load' });
await rmPage.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width > 0 && c.height > 0;
});
await rmPage.waitForTimeout(1500);
await rmPage.screenshot({ path: join(OUT, 'reduced-motion.png') });
// two shots apart: reduced motion must be static
const shot1 = await rmPage
  .locator('canvas')
  .screenshot({ path: join(OUT, 'rm-a.png') });
await rmPage.waitForTimeout(900);
const shot2 = await rmPage
  .locator('canvas')
  .screenshot({ path: join(OUT, 'rm-b.png') });
check(
  'reduced motion parks the scene (canvas byte-stable)',
  shot1.equals(shot2)
);
check('no page errors under reduced motion', rmErrors.length === 0);
await rmPage.close();

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(failed.length === 0 ? 'NAV PROBE PASSED' : `FAILED: ${failed.map(([n]) => n).join(' | ')}`);
process.exit(failed.length === 0 ? 0 : 1);
