#!/usr/bin/env node

/**
 * Browser-paint regression for the public home -> architecture command path.
 *
 * The two surfaces author dark grounds, so a light pixel at the stable probe
 * point is a real navigation discontinuity rather than a theme preference.
 * Run against a worktree server with:
 *
 *   EXA_BASE=http://localhost:<port> pnpm eval:navigation-paint
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = (process.env.EXA_BASE || 'http://localhost:7000').replace(
  /\/$/,
  ''
);
const OUTPUT = resolve(
  process.env.EXAWATT_NAVIGATION_PAINT_SCREENSHOTS ||
    '.artifacts/navigation-paint'
);
const SAMPLE_POINT = { x: 100, y: 500 };
const HEADER_SAMPLE_POINT = { x: 720, y: 24 };
const LIGHT_CHANNEL_FLOOR = 220;
const TIMEOUT_MS = 12_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Read RGB at viewport points from ONE full-viewport PNG capture.
 *
 * The capture has to be one atomic viewport frame (BUG-212). Playwright's
 * clipped `page.screenshot` turns a viewport clip into a document rectangle
 * with a separate `Page.getLayoutMetrics` round trip before it captures, so a
 * navigation that resets scroll between the two reads a pixel of the NEW
 * document at the OLD page's offset: 6.8k px down a 4.5k document, which is
 * the bare canvas, not anything a reader saw. Only the rows up to the lowest
 * point are unfiltered, which keeps a sample cheaper than two clipped shots.
 */
function readViewportPixels(png, points) {
  const signature = png.subarray(0, 8).toString('hex');
  assert(signature === '89504e470d0a1a0a', 'Screenshot was not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageData = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  assert(bitDepth === 8, `Expected 8-bit PNG channels, got ${bitDepth}`);
  assert(interlace === 0, 'Expected a non-interlaced PNG');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert(channels > 0, `Unsupported PNG color type ${colorType}`);
  for (const { x, y } of points) {
    assert(
      x < width && y < height,
      `Sample point ${x},${y} is outside the ${width}x${height} capture`
    );
  }

  const stride = width * channels;
  const rows = inflateSync(Buffer.concat(imageData));
  const lastRow = Math.max(...points.map(point => point.y));
  for (let y = 0; y <= lastRow; y += 1) {
    const start = y * (stride + 1) + 1;
    const filter = rows[start - 1];
    const above = start - (stride + 1);
    if (filter === 0) continue;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? rows[start + x - channels] : 0;
      const b = y > 0 ? rows[above + x] : 0;
      let predictor;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const c = x >= channels && y > 0 ? rows[above + x - channels] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else throw new Error(`Unknown PNG filter ${filter}`);
      rows[start + x] = (rows[start + x] + predictor) & 0xff;
    }
  }

  return points.map(({ x, y }) => {
    const index = y * (stride + 1) + 1 + x * channels;
    return { r: rows[index], g: rows[index + 1], b: rows[index + 2] };
  });
}

function isLightFlash({ r, g, b }) {
  return (
    r >= LIGHT_CHANNEL_FLOOR &&
    g >= LIGHT_CHANNEL_FLOOR &&
    b >= LIGHT_CHANNEL_FLOOR
  );
}

mkdirSync(OUTPUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
  reducedMotion: 'no-preference',
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);

// Hold any automatic architecture prefetch until the command is pressed, then
// add a bounded response delay. This forces the real App Router pending path
// through the pixel sampler instead of letting a warm local cache hide it.
let navigationArmed = false;
await page.route('**/architecture**', async route => {
  while (!navigationArmed) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  await new Promise(resolve => setTimeout(resolve, 600));
  await route.continue();
});

const errors = [];
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

try {
  await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 30_000 });
  // The footer is the ONLY route from `/` to `/architecture` now: ENG-031 W6
  // took Architecture out of the header's primary navigation and the fold
  // carries no call to action of its own (operator, 2026-08-17), so this is
  // the real reader's path rather than a convenient handle. Reading the
  // header's link instead is what left this eval red for five weeks with
  // nothing running it (BUG-211).
  const command = page.locator('#site-footer a[href="/architecture"]');
  await command.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.documentElement.dataset.exaTheme === 'exawatt-air-light'
  );
  await page.screenshot({ path: join(OUTPUT, 'before.png') });

  const beforeChrome = await page
    .locator('#site-header')
    .getAttribute('data-public-dark-chrome');
  const samples = [];
  const cdp = await context.newCDPSession(page);
  let firstLightFrame = null;

  navigationArmed = true;
  await command.click({ noWaitAfter: true });
  const startedAt = performance.now();

  while (performance.now() - startedAt < TIMEOUT_MS) {
    // Without a clip, Chromium captures the viewport as it is composited, in
    // one step, so both pixels come from the same painted frame.
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      optimizeForSpeed: true,
    });
    const framePng = Buffer.from(data, 'base64');
    const [bodyPixel, headerPixel] = readViewportPixels(framePng, [
      SAMPLE_POINT,
      HEADER_SAMPLE_POINT,
    ]);
    if (
      !firstLightFrame &&
      (isLightFlash(bodyPixel) || isLightFlash(headerPixel))
    ) {
      firstLightFrame = framePng;
    }
    const state = await page.evaluate(() => ({
      path: location.pathname,
      theme: document.documentElement.dataset.exaTheme,
      transitionCurtains: document.querySelectorAll(
        '[data-architecture-transition-curtain]'
      ).length,
      architectureLoading: !!document.querySelector(
        '[data-architecture-loading]'
      ),
      headerDarkChrome: document
        .querySelector('#site-header')
        ?.getAttribute('data-public-dark-chrome'),
    }));
    samples.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      bodyPixel,
      headerPixel,
      ...state,
    });

    if (state.path === '/architecture' && samples.length > 1) {
      await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      break;
    }
    await page.waitForTimeout(20);
  }

  await page.locator('main h1').waitFor();
  await page.screenshot({ path: join(OUTPUT, 'after.png') });
  // The document canvas is what a reader sees past either end of the page on
  // a rubber-band overscroll, so it has to be the exhibition's ground too.
  const documentGround = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.documentElement)
      .backgroundColor.match(/\d+(\.\d+)?/g)
      .map(Number);
    return { r, g, b };
  });

  const bodyFlashSamples = samples.filter(sample =>
    isLightFlash(sample.bodyPixel)
  );
  const headerFlashSamples = samples.filter(sample =>
    isLightFlash(sample.headerPixel)
  );
  const curtainSamples = samples.filter(
    sample => sample.transitionCurtains > 0
  );
  const mismatchedChromeSamples = samples.filter(
    sample => sample.headerDarkChrome !== 'true'
  );
  const loadingSamples = samples.filter(sample => sample.architectureLoading);
  const final = samples.at(-1);

  if (firstLightFrame) {
    writeFileSync(join(OUTPUT, 'failure-light-frame.png'), firstLightFrame);
  }

  assert(samples.length > 1, 'Navigation paint sampler captured no transition');
  assert(final?.path === '/architecture', `Navigation ended at ${final?.path}`);
  assert(
    bodyFlashSamples.length === 0,
    `Detected ${bodyFlashSamples.length} light body frames: ${JSON.stringify(bodyFlashSamples)}`
  );
  assert(
    headerFlashSamples.length === 0,
    `Detected ${headerFlashSamples.length} light header frames: ${JSON.stringify(headerFlashSamples)}`
  );
  assert(
    curtainSamples.length === 0,
    `Obsolete full-screen transition curtain mounted: ${JSON.stringify(curtainSamples)}`
  );
  assert(beforeChrome === 'true', 'Home chrome did not own its dark surface');
  assert(
    mismatchedChromeSamples.length === 0,
    `Dark public chrome ownership broke during navigation: ${JSON.stringify(mismatchedChromeSamples)}`
  );
  assert(
    loadingSamples.every(sample => !isLightFlash(sample.bodyPixel)),
    `Architecture loading floor exposed a light frame: ${JSON.stringify(loadingSamples)}`
  );
  assert(
    !isLightFlash(documentGround),
    `Architecture's document ground is light under the dark page: ${JSON.stringify(documentGround)}`
  );
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  console.log(
    `PASS navigation paint: ${samples.length} sampled frames, ` +
      `Air stayed dark from home to architecture; screenshots: ${OUTPUT}`
  );
} finally {
  await context.close();
  await browser.close();
}
