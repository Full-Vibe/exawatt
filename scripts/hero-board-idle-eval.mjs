#!/usr/bin/env node
/**
 * Hero board idle eval (ENG-031 W2).
 *
 * The homepage hero's budget is a MEASUREMENT, so this measures it instead of
 * asserting it: two frames one second apart, compared per channel, over each
 * of the three idle options. It reads `window.__HERO_MEASURE__`, which the
 * eval route builds from the same module the study displays, so a number here
 * and a number on screen cannot disagree.
 *
 * The budget verdict is ADVISORY while the operator is still choosing: option 3
 * is expected to be over, and that is the finding, not a broken build. The
 * script exits non-zero only on structural failures (WebGL errors, draw calls,
 * DPR, frames rendered while parked, a reduced-motion path that still mounts a
 * canvas). When an option ships, promote its budget line to a hard gate here.
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

const OPTIONS = ['planted', 'scroll', 'orbit'];

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

  for (const option of OPTIONS) {
    const { page, errors } = await openBoard(browser, `option=${option}`);
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_200);
    const idle = await measureIdle(page);
    const row = { option, idle, scrolling: null, errors: [] };

    if (option === 'scroll') {
      // The budget is an IDLE budget, so the resting number is the one that
      // counts. The driven number is recorded because a visitor scrolling is
      // the option's entire point, and it must not be hidden.
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
    }

    row.errors = errors.filter(text =>
      HARD_FAIL.some(needle => text.includes(needle))
    );
    if (row.errors.length) failures += 1;
    if (!idle) failures += 1;
    else {
      const verdict = grade(idle);
      row.verdict = verdict;
      // Structural only. The idle budget is reported, not gated, until the
      // operator picks an option.
      if (!verdict.dprOk || !verdict.drawCallsOk) failures += 1;
    }
    results.push(row);
    await page.close();
  }

  // Attribution: where the planted option's idle budget actually goes. The
  // D40 rule that only Active moves is product canon, and it is also the
  // single largest line item on the hero's budget, so it is measured apart.
  for (const [label, query] of [
    ['no-turn', 'option=planted&protocol=0'],
    ['no-changes', 'option=planted&changes=0'],
    ['still', 'option=planted&protocol=0&changes=0'],
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
    const { page } = await openBoard(browser, 'option=planted&force=frozen');
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
    await page.goto(`${EXA_BASE}/eval/t12-hero-board?option=planted`, {
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
    const { page } = await openBoard(browser, 'option=planted&force=frozen', {
      deviceScaleFactor: 1.5,
      viewport: POSTER_VIEWPORT,
    });
    await waitForFirstFrame(page);
    await page.waitForTimeout(1_200);
    mkdirSync(dirname(POSTER_PATH), { recursive: true });
    // The CANVAS only. The demo/synthetic stamp is part of the hero frame and
    // renders over the poster too, so baking it in would double it.
    const buffer = await page
      .locator('[data-hero-board] canvas')
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
        `${row.option.padEnd(8)} meanΔ ${idle.meanChannelDelta.toFixed(3).padStart(6)}  ` +
          `changed ${(idle.changedPixelShare * 100).toFixed(2).padStart(6)}%  ` +
          `calls ${String(idle.drawCalls).padStart(2)}  dpr ${idle.dpr.toFixed(2)}  ` +
          `fps ${idle.framesPerSecond.toFixed(0).padStart(3)}  ` +
          `${verdict.meanOk && verdict.shareOk ? 'PASS' : 'OVER BUDGET'}`
      );
      if (row.scrolling)
        console.log(
          `${''.padEnd(8)} under scroll: meanΔ ${row.scrolling.meanChannelDelta.toFixed(3)}  changed ${(row.scrolling.changedPixelShare * 100).toFixed(2)}%`
        );
      if (row.errors.length) console.log('  errors:', row.errors);
    } else {
      console.log(`${row.option.padEnd(8)} ${JSON.stringify(row)}`);
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
