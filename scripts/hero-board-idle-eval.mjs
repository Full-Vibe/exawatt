#!/usr/bin/env node
/**
 * Hero board idle eval (ENG-031 W2).
 *
 * The homepage hero's budget is a MEASUREMENT, so this measures it instead of
 * asserting it: two frames one second apart, compared per channel. It reads
 * `window.__HERO_MEASURE__`, which the eval route builds from the same module
 * the study displays, so a number here and a number on screen cannot disagree.
 *
 * The operator chose the scroll-driven board on 2026-08-17, so the at-rest
 * budget is now a HARD gate: mean delta and changed-pixel share join the
 * structural checks (WebGL errors, draw calls, DPR, frames rendered while
 * parked, a reduced-motion path that still mounts a canvas). The number under
 * scroll is recorded, never gated: that motion is input-driven, and a visitor
 * scrolling is the whole point.
 *
 * Budget (`docs/engineering/projects/website-overhaul.md` → "The hero board"):
 *   mean per-channel delta < 2/255 · changed pixels < 5%/s · DPR <= 1.5 ·
 *   <= 4 draw calls · zero frames while parked · zero canvases when reduced.
 *
 * Run:  pnpm dev -p 7141
 *       EXA_BASE=http://localhost:7141 pnpm eval:hero-board
 *       EXA_BASE=... pnpm eval:hero-board -- --poster   (regenerates the poster)
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const EXA_BASE = process.env.EXA_BASE || 'http://localhost:7000';
const WRITE_POSTER = process.argv.includes('--poster');
const SAMPLES = Number(process.env.HERO_EVAL_SAMPLES || 6);
const VIEWPORT = { width: 1440, height: 810 };
// The poster is regenerated at the fold band's final aspect in W3; this is a
// wide default so `object-cover` crops rather than letterboxes.
const POSTER_VIEWPORT = { width: 1600, height: 800 };
const POSTER_PATH = join(ROOT, 'public/images/hero-board-poster.jpg');

const BUDGET = {
  meanChannelDelta: 2,
  changedPixelShare: 0.05,
  maxDpr: 1.5,
  maxDrawCalls: 4,
};

const HARD_FAIL = [
  'THREE.WebGLProgram',
  'shader',
  'GL_INVALID',
  'context lost',
  'WebGL context',
];

async function openBoard(browser, query, { deviceScaleFactor, viewport } = {}) {
  const page = await browser.newPage({
    viewport: viewport ?? VIEWPORT,
    ...(deviceScaleFactor ? { deviceScaleFactor } : {}),
  });
  const errors = [];
  page.on('pageerror', event => errors.push(String(event.message || event)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${EXA_BASE}/eval/t12-hero-board?${query}`, {
    waitUntil: 'load',
    timeout: 60_000,
  });
  await page.waitForSelector('[data-hero-board]', { timeout: 30_000 });
  return { page, errors };
}

async function waitForFirstFrame(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return !!canvas && canvas.width > 0 && canvas.height > 0;
    },
    { timeout: 30_000 }
  );
  await page.waitForFunction(
    () => {
      const gl = window.__EVAL_GL__;
      return !!(gl && gl.info && gl.info.render && gl.info.render.calls > 0);
    },
    { timeout: 30_000 }
  );
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))
      )
  );
}

/** N one-second samples, averaged. The first is discarded: it primes the
 *  comparison and straddles the fade-in. */
async function measureIdle(page, samples = SAMPLES) {
  await page.evaluate(() => window.__HERO_MEASURE__());
  const readings = [];
  for (let index = 0; index < samples; index += 1) {
    await page.waitForTimeout(1_000);
    const reading = await page.evaluate(() => window.__HERO_MEASURE__());
    if (reading) readings.push(reading);
  }
  if (readings.length === 0) return null;
  const mean = key =>
    readings.reduce((sum, reading) => sum + reading[key], 0) / readings.length;
  return {
    meanChannelDelta: mean('meanChannelDelta'),
    changedPixelShare: mean('changedPixelShare'),
    maxChannelDelta: Math.max(...readings.map(r => r.maxChannelDelta)),
    drawCalls: Math.max(...readings.map(r => r.drawCalls)),
    dpr: readings[0].dpr,
    framesPerSecond:
      (readings[readings.length - 1].frame - readings[0].frame) /
      Math.max(1, readings.length - 1),
    samples: readings.length,
    pixels: readings[0].pixels,
  };
}

function grade(reading) {
  return {
    meanOk: reading.meanChannelDelta < BUDGET.meanChannelDelta,
    shareOk: reading.changedPixelShare < BUDGET.changedPixelShare,
    dprOk: reading.dpr <= BUDGET.maxDpr,
    drawCallsOk: reading.drawCalls <= BUDGET.maxDrawCalls,
  };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    ...(await resolveQaBrowserLaunchOptions(chromium)),
  });
  const results = [];
  let failures = 0;

  {
    const { page, errors } = await openBoard(browser, 'board=1');
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_200);
    const idle = await measureIdle(page);
    const row = { option: 'at rest', idle, scrolling: null, errors: [] };

    // The budget is an IDLE budget, so the resting number is the one that
    // gates. The driven number is recorded because a visitor scrolling is the
    // board's entire point, and it must not be hidden.
    await page.evaluate(() => window.__HERO_MEASURE__());
    const driven = [];
    for (let step = 0; step < 6; step += 1) {
      await page.evaluate(value => {
        window.__HERO_PROGRESS__(value);
      }, step / 5);
      await page.waitForTimeout(1_000);
      const reading = await page.evaluate(() => window.__HERO_MEASURE__());
      if (reading) driven.push(reading);
    }
    if (driven.length) {
      row.scrolling = {
        meanChannelDelta:
          driven.reduce((sum, r) => sum + r.meanChannelDelta, 0) /
          driven.length,
        changedPixelShare:
          driven.reduce((sum, r) => sum + r.changedPixelShare, 0) /
          driven.length,
      };
    }

    row.errors = errors.filter(text =>
      HARD_FAIL.some(needle => text.includes(needle))
    );
    if (row.errors.length) failures += 1;
    if (!idle) failures += 1;
    else {
      const verdict = grade(idle);
      row.verdict = verdict;
      // The chosen board is gated on its own budget, not just on structure.
      if (
        !verdict.dprOk ||
        !verdict.drawCallsOk ||
        !verdict.meanOk ||
        !verdict.shareOk
      )
        failures += 1;
    }
    results.push(row);
    await page.close();
  }

  // Attribution: where the at-rest budget actually goes. The D40 rule that
  // only Active moves is product canon, and it is also the single largest line
  // item on the hero's budget, so it is measured apart.
  // The pinned sequence's RESTING state is a highlighted one (W4), so the
  // budget is measured there too rather than assumed from the plain board.
  {
    const { page } = await openBoard(browser, 'highlight=needs-you');
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_200);
    const idle = await measureIdle(page);
    const verdict = idle ? grade(idle) : null;
    results.push({ option: 'highlighted', idle, verdict, errors: [] });
    if (!idle) failures += 1;
    else if (
      !verdict.dprOk ||
      !verdict.drawCallsOk ||
      !verdict.meanOk ||
      !verdict.shareOk
    )
      failures += 1;
    await page.close();
  }

  for (const [label, query] of [
    ['no-turn', 'protocol=0'],
    ['no-changes', 'changes=0'],
    ['still', 'protocol=0&changes=0'],
  ]) {
    const { page } = await openBoard(browser, query);
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_000);
    const idle = await measureIdle(page, 4);
    results.push({
      option: label,
      idle,
      verdict: idle ? grade(idle) : null,
      errors: [],
    });
    await page.close();
  }

  // Parked: a frozen board must render zero frames after its first paint.
  {
    const { page } = await openBoard(browser, 'force=frozen');
    await waitForFirstFrame(page);
    await page.waitForTimeout(500);
    const before = await page.evaluate(
      () => window.__EVAL_GL__.info.render.frame
    );
    await page.waitForTimeout(3_000);
    const after = await page.evaluate(
      () => window.__EVAL_GL__.info.render.frame
    );
    const parkedFrames = after - before;
    results.push({ option: 'frozen', parkedFrames, ok: parkedFrames === 0 });
    if (parkedFrames !== 0) failures += 1;
    await page.close();
  }

  // Reduced motion: canvas count drops to zero, the poster takes the same box.
  {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${EXA_BASE}/eval/t12-hero-board`, {
      waitUntil: 'load',
      timeout: 60_000,
    });
    await page.waitForSelector('[data-hero-board]', { timeout: 30_000 });
    await page.waitForTimeout(600);
    const reduced = await page.evaluate(() => {
      const frame = document.querySelector('[data-hero-board]');
      const rect = frame.getBoundingClientRect();
      return {
        mode: frame.getAttribute('data-hero-board-mode'),
        canvases: document.querySelectorAll('canvas').length,
        poster: !!document.querySelector('[data-hero-board-poster]'),
        stamp: document
          .querySelector('[data-hero-board-stamp]')
          ?.textContent?.trim(),
        box: { width: Math.round(rect.width), height: Math.round(rect.height) },
      };
    });
    const ok =
      reduced.mode === 'poster' &&
      reduced.canvases === 0 &&
      reduced.poster &&
      !!reduced.stamp;
    results.push({ option: 'reduced-motion', ...reduced, ok });
    if (!ok) failures += 1;
    await page.close();
  }

  if (WRITE_POSTER) {
    const { page } = await openBoard(browser, 'force=frozen', {
      deviceScaleFactor: 1.5,
      viewport: POSTER_VIEWPORT,
    });
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_200);
    mkdirSync(dirname(POSTER_PATH), { recursive: true });
    // The BOARD FRAME, minus anything that renders live on top of the poster.
    // The Project labels are part of the composition and must be in the
    // substitute, or a reduced-motion visitor gets unnamed circles; the stamp,
    // the counts, and the legend render over the poster, so baking them in
    // would double them. The site header is hidden because an element
    // screenshot of a box taller than the viewport otherwise captures it
    // (it baked the app chrome into the first poster W2 shipped).
    await page.addStyleTag({
      content:
        '#site-header{display:none!important}' +
        // The dev server's issue indicator is a portal on top of everything.
        'nextjs-portal{display:none!important}' +
        '[data-hero-overlay-fixed],[data-hero-board-stamp]{display:none!important}',
    });
    await page.waitForTimeout(400);
    const buffer = await page
      .locator('[data-hero-board]')
      .screenshot({ type: 'jpeg', quality: 82 });
    writeFileSync(POSTER_PATH, buffer);
    results.push({
      option: 'poster',
      path: POSTER_PATH,
      bytes: buffer.length,
      ok: true,
    });
    await page.close();
  }

  await browser.close();

  console.log('\nHero board idle eval —', EXA_BASE);
  console.log(
    'budget: mean Δ < 2/255 · changed < 5%/s · dpr ≤ 1.5 · draw calls ≤ 4\n'
  );
  for (const row of results) {
    if (row.idle) {
      const { idle, verdict } = row;
      console.log(
        `${row.option.padEnd(10)} meanΔ ${idle.meanChannelDelta.toFixed(3).padStart(6)}  ` +
          `changed ${(idle.changedPixelShare * 100).toFixed(2).padStart(6)}%  ` +
          `calls ${String(idle.drawCalls).padStart(2)}  dpr ${idle.dpr.toFixed(2)}  ` +
          `fps ${idle.framesPerSecond.toFixed(0).padStart(3)}  ` +
          `${verdict.meanOk && verdict.shareOk ? 'PASS' : 'OVER BUDGET'}`
      );
      if (row.scrolling)
        console.log(
          `${''.padEnd(10)} under scroll: meanΔ ${row.scrolling.meanChannelDelta.toFixed(3)}  changed ${(row.scrolling.changedPixelShare * 100).toFixed(2)}%`
        );
      if (row.errors.length) console.log('  errors:', row.errors);
    } else {
      console.log(`${row.option.padEnd(10)} ${JSON.stringify(row)}`);
    }
  }
  console.log(
    failures === 0 ? '\nAll gates passed.' : `\n${failures} gate(s) failed.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
