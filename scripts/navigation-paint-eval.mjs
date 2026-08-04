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

import { mkdirSync } from 'node:fs';
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

function readOnePixelPng(png) {
  const signature = png.subarray(0, 8).toString('hex');
  assert(signature === '89504e470d0a1a0a', 'Screenshot was not a PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
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
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  assert(
    width === 1 && height === 1,
    `Expected a 1px PNG, got ${width}x${height}`
  );
  assert(bitDepth === 8, `Expected 8-bit PNG channels, got ${bitDepth}`);
  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  assert(channels > 0, `Unsupported PNG color type ${colorType}`);

  const scanline = inflateSync(Buffer.concat(imageData));
  assert(scanline.length >= channels + 1, 'PNG scanline was incomplete');
  // The first pixel has no left or prior-row neighbor, so every PNG filter
  // reconstructs its channels directly from the encoded bytes.
  const values = [...scanline.subarray(1, channels + 1)];
  if (colorType === 0) return { r: values[0], g: values[0], b: values[0] };
  return { r: values[0], g: values[1], b: values[2] };
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
  const command = page.locator('[data-command-key-button]');
  await command.waitFor({ state: 'attached' });
  await page.waitForFunction(
    () => document.documentElement.dataset.exaTheme === 'exawatt-air-light'
  );
  await page.screenshot({ path: join(OUTPUT, 'before.png') });

  const beforeChrome = await page
    .locator('#site-header')
    .getAttribute('data-public-dark-chrome');
  const samples = [];

  // Use the real pointer path: the command control owns a physical-release
  // contract before it asks Next to navigate.
  navigationArmed = true;
  await command.click({ noWaitAfter: true });
  const startedAt = performance.now();

  while (performance.now() - startedAt < TIMEOUT_MS) {
    const bodyPng = await page.screenshot({
      clip: { ...SAMPLE_POINT, width: 1, height: 1 },
      type: 'png',
    });
    const headerPng = await page.screenshot({
      clip: { ...HEADER_SAMPLE_POINT, width: 1, height: 1 },
      type: 'png',
    });
    const bodyPixel = readOnePixelPng(bodyPng);
    const headerPixel = readOnePixelPng(headerPng);
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

  if (bodyFlashSamples.length > 0 || headerFlashSamples.length > 0) {
    await page.screenshot({ path: join(OUTPUT, 'failure-current-frame.png') });
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
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  console.log(
    `PASS navigation paint: ${samples.length} sampled frames, ` +
      `Air stayed dark from home to architecture; screenshots: ${OUTPUT}`
  );
} finally {
  await context.close();
  await browser.close();
}
