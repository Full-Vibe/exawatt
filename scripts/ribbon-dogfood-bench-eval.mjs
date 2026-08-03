#!/usr/bin/env node

/**
 * D42 acceptance gates, run against the instrumented dogfood bench
 * (`/hud-gallery/project-ribbon/bench`). The bench mounts the production
 * TabStrip over a fake terminal stage that counts every ResizeObserver
 * delivery — the exact instrument for the round's core contract:
 *
 *   1. ZERO stage resizes across Project switches (selection-invariant height)
 *   2. exactly ONE snap resize when a data change flips the row count
 *   3. hold-⌘ keycaps are VISIBLE on every ordinal-bearing tab, condensed
 *      chips included
 *   4. walking the full ⌘⇧] ring never lands on an invisible active tab
 *   5. pointer reorder commits a same-row swap and Escape cancels
 */

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.EXAWATT_RIBBON_SCREENSHOTS || '/tmp/exawatt-ribbon-bench';

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to the shared Playwright cache.
  }
  const home = process.env.HOME || '';
  for (const root of [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      for (const candidate of [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const executablePath = resolveChromium();
if (executablePath === null) {
  throw new Error(
    'Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
  );
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath || undefined,
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));

const stageResizes = () =>
  page.evaluate(() =>
    Number(
      document
        .querySelector('[data-bench-resize-count]')
        ?.getAttribute('data-bench-resize-count')
    )
  );
const stripState = () =>
  page.evaluate(() => {
    const strip = document.querySelector('[data-workspace-tab-strip]');
    return {
      rows: strip?.getAttribute('data-ribbon-rows'),
      stable: strip?.getAttribute('data-ribbon-stable-rows'),
      height: strip instanceof HTMLElement ? strip.style.height : null,
    };
  });
const setBenchWidth = async width => {
  await page.evaluate(value => {
    const slider = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    set.call(slider, value);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, width);
  await page.waitForTimeout(500);
};
const clickProject = async name => {
  await page
    .locator(`[data-ribbon-item="project"][data-project="${name}"]`)
    .first()
    .click();
  await page.waitForTimeout(450);
};

try {
  await page.goto(`${BASE}/hud-gallery/project-ribbon/bench`, {
    waitUntil: 'networkidle',
  });
  await page.locator('[data-workspace-tab-strip]').waitFor();
  await page.waitForTimeout(700);
  await setBenchWidth(1440);

  // ── Gate 1: zero stage resizes across Project switches ──
  const beforeSwitches = await stageResizes();
  const heightBefore = (await stripState()).height;
  await clickProject('switcheroo');
  await clickProject('gpagent');
  await clickProject('exawatt');
  const afterSwitches = await stageResizes();
  const heightAfter = (await stripState()).height;
  if (afterSwitches !== beforeSwitches || heightAfter !== heightBefore) {
    throw new Error(
      `Project switches resized the stage: ${JSON.stringify({ beforeSwitches, afterSwitches, heightBefore, heightAfter })}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'gate1-switches.png'),
    clip: (await page.locator('[data-bench-root]').boundingBox()) ?? undefined,
  });

  // ── Gate 3: hold-⌘ reveals a VISIBLE keycap on every ordinal tab ──
  await page.keyboard.down('Meta');
  await page.waitForTimeout(300);
  const keycaps = await page.evaluate(() =>
    [...document.querySelectorAll('[data-tab-ordinal]')]
      .filter(wrapper => {
        const item = wrapper.closest('[data-ribbon-item]');
        if (!item || item.getAttribute('aria-hidden') === 'true') return false;
        const chip = wrapper.querySelector('span') ?? wrapper;
        return chip.getBoundingClientRect().width > 0;
      })
      .map(wrapper => wrapper.getAttribute('data-tab-ordinal'))
      .sort((a, b) => Number(a) - Number(b))
  );
  await page.keyboard.up('Meta');
  if (keycaps.join(',') !== '1,2,3,4,5,6,7,8,9') {
    throw new Error(`Keycap coverage incomplete: [${keycaps.join(',')}]`);
  }

  // ── Gate 4: the full ring only ever lands on a visible active tab ──
  const ringStops = 13;
  for (let step = 0; step < ringStops; step += 1) {
    await page.click('[data-bench-ring-next]');
    await page.waitForTimeout(120);
    const landed = await page.evaluate(() => {
      const active = document.querySelector(
        '[data-ribbon-item="initiative"][data-active]'
      );
      if (!active) return { ok: false, reason: 'no active tab node' };
      return {
        ok: active.getAttribute('aria-hidden') !== 'true',
        id: active.getAttribute('data-tab-id'),
      };
    });
    if (!landed.ok) {
      throw new Error(
        `Ring stop ${step} landed on an invisible tab: ${JSON.stringify(landed)}`
      );
    }
  }

  // ── Gate 5: pointer reorder commits; Escape cancels ──
  await clickProject('exawatt');
  const order = () =>
    page.$$eval(
      '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]',
      els =>
        els
          .filter(el => el.getAttribute('aria-hidden') !== 'true')
          .map(el => {
            const box = el.getBoundingClientRect();
            return { id: el.getAttribute('data-tab-id'), x: box.x, y: box.y };
          })
          .sort((a, b) =>
            Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x
          )
          .map(item => item.id)
    );
  const before = await order();
  const src = await page
    .locator(`[data-tab-id="${before[0]}"]`)
    .boundingBox();
  const dst = await page
    .locator(`[data-tab-id="${before[1]}"]`)
    .boundingBox();
  await page.mouse.move(src.x + 30, src.y + 13);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(
      src.x + 30 + ((dst.x + dst.width - 8 - src.x - 30) * i) / 12,
      src.y + 13,
      { steps: 1 }
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(450);
  const swapped = await order();
  if (swapped[0] !== before[1] || swapped[1] !== before[0]) {
    throw new Error(
      `Pointer reorder did not commit: ${JSON.stringify({ before, swapped })}`
    );
  }
  const src2 = await page
    .locator(`[data-tab-id="${swapped[0]}"]`)
    .boundingBox();
  await page.mouse.move(src2.x + 30, src2.y + 13);
  await page.mouse.down();
  await page.mouse.move(src2.x + 260, src2.y + 13, { steps: 8 });
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterEscape = await order();
  if (afterEscape.join() !== swapped.join()) {
    throw new Error(
      `Escape did not cancel the drag: ${JSON.stringify({ swapped, afterEscape })}`
    );
  }

  // ── Gate 2: data changes snap with exactly one resize at the row flip ──
  // Drain every Project's tabs. The reserved row count is the max over all
  // hypothetical selections, so it flips 2→1 exactly once somewhere in the
  // sequence — the stage must see exactly ONE resize across dozens of
  // closes and the interleaved Project switches.
  const resizesBeforeCloses = await stageResizes();
  let stableTrack = (await stripState()).stable;
  let flips = 0;
  for (const name of [
    'exawatt',
    'gpagent',
    'cortex-ehr',
    'workmusic',
    'switcheroo',
    'photo-generator',
  ]) {
    await clickProject(name);
    for (let round = 0; round < 8; round += 1) {
      const closable = page
        .locator(
          '[data-ribbon-item="initiative"]:not([aria-hidden="true"]):not([data-close-stabilized]) button[title^="Close — kept"]'
        )
        .first();
      if (!(await closable.count())) break;
      await closable.click({ force: true });
      // outlast the pointer-close slot-stabilization window so the next
      // iteration cannot re-click the retained ghost
      await page.waitForTimeout(700);
      const stable = (await stripState()).stable;
      if (stable !== stableTrack) {
        flips += 1;
        stableTrack = stable;
      }
    }
  }
  const resizesAfterCloses = await stageResizes();
  const closeDelta = resizesAfterCloses - resizesBeforeCloses;
  if (flips !== 1 || closeDelta !== 1) {
    throw new Error(
      `Row flip contract failed: ${JSON.stringify({ flips, closeDelta, stableTrack })}`
    );
  }

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        gates: {
          switchResizes: afterSwitches - beforeSwitches,
          keycaps,
          ringStops,
          reorder: { before, swapped },
          rowFlip: { flips, closeDelta },
        },
        screenshots: SCREENSHOT_DIR,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
