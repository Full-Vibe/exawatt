#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const OUTPUT = resolve(
  process.env.EXAWATT_THEME_SCREENSHOTS || '.artifacts/eng-032-t2'
);

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to shared caches.
  }
  const home = process.env.HOME || '';
  for (const root of [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ]) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root)) {
      if (!directory.startsWith('chromium')) continue;
      for (const candidate of [
        join(root, directory, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, directory, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const executablePath = resolveChromium();
if (executablePath === null) {
  throw new Error(
    'Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
  );
}

mkdirSync(OUTPUT, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath || undefined,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

async function select(name) {
  await page.getByRole('button', { name, exact: true }).click();
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => {
          window.__EVAL_INVALIDATE__?.();
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
      )
  );
}

async function assertPreview({ theme, contrast, transparency, scale = '100' }) {
  const preview = page.locator('[data-testid="theme-system-preview"]');
  await preview.waitFor();
  await page.waitForFunction(
    expected => {
      const element = document.querySelector(
        '[data-testid="theme-system-preview"]'
      );
      return (
        element?.getAttribute('data-exa-theme') === expected.theme &&
        element.getAttribute('data-exa-contrast') === expected.contrast &&
        element.getAttribute('data-exa-transparency') ===
          expected.transparency &&
        element.getAttribute('data-interface-scale') === expected.scale
      );
    },
    { theme, contrast, transparency, scale }
  );
  const state = await preview.evaluate(element => ({
    theme: element.getAttribute('data-exa-theme'),
    contrast: element.getAttribute('data-exa-contrast'),
    transparency: element.getAttribute('data-exa-transparency'),
    scale: element.getAttribute('data-interface-scale'),
    statusCount: element.querySelectorAll('[data-status-state]').length,
    typeScaleCount: element.querySelectorAll('[data-type-scale]').length,
    materialCount: element.querySelectorAll('[data-material-role]').length,
    ansiCount: element.querySelectorAll('[data-ansi-color]').length,
    hasDomSpatial: Boolean(
      element.querySelector('[data-theme-dom-spatial-study]')
    ),
    hasWebglSpatial: Boolean(
      element.querySelector('[data-theme-spatial-study] canvas')
    ),
    bloom: element
      .querySelector('[data-theme-spatial-study]')
      ?.getAttribute('data-theme-spatial-bloom'),
    consumptionChannels: element.querySelectorAll(
      '[data-channel="consumption"] [role="img"]'
    ).length,
    readinessChannels: element.querySelectorAll('[data-channel="readiness"]')
      .length,
    selectedCommandMarked: Boolean(
      element.querySelector('[data-command-selected][aria-current="true"]')
    ),
    materialOpacity: getComputedStyle(element).getPropertyValue(
      '--exa-material-chrome-opacity'
    ),
    materialBlur: getComputedStyle(element).getPropertyValue(
      '--exa-material-chrome-blur'
    ),
  }));
  assert(state.theme === theme, `theme mismatch: ${JSON.stringify(state)}`);
  assert(
    state.contrast === contrast,
    `contrast mismatch: ${JSON.stringify(state)}`
  );
  assert(
    state.transparency === transparency,
    `transparency mismatch: ${JSON.stringify(state)}`
  );
  assert(state.scale === scale, `scale mismatch: ${JSON.stringify(state)}`);
  assert(state.statusCount === 5, `D40 matrix incomplete: ${JSON.stringify(state)}`);
  assert(state.typeScaleCount === 4, `type matrix incomplete: ${JSON.stringify(state)}`);
  assert(state.materialCount === 3, `material matrix incomplete: ${JSON.stringify(state)}`);
  assert(state.ansiCount === 16, `ANSI matrix incomplete: ${JSON.stringify(state)}`);
  assert(state.hasDomSpatial, 'DOM spatial sibling is missing');
  assert(state.hasWebglSpatial, 'R3F spatial sibling did not mount');
  assert(state.bloom === 'off', 'Air/Night spatial specimen still uses bloom');
  assert(state.consumptionChannels === 5, 'Consumption ramp is incomplete');
  assert(state.readinessChannels === 1, 'Readiness grammar is missing');
  assert(state.selectedCommandMarked, 'Command selection lacks a non-color mark');
  if (transparency === 'reduced') {
    assert(state.materialOpacity.trim() === '1', 'opaque fallback is not opaque');
    assert(state.materialBlur.trim() === '0px', 'opaque fallback retained blur');
  }
}

async function assertNoHorizontalOverflow(width) {
  const metrics = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  assert(
    metrics.document <= metrics.viewport + 1,
    `${width}px viewport overflows horizontally: ${JSON.stringify(metrics)}`
  );
}

try {
  await page.goto(`${BASE}/hud-gallery/theme-system`, {
    waitUntil: 'load',
    timeout: 30_000,
  });
  await page.locator('[data-theme-system-study]').waitFor();
  await page.locator('[data-theme-spatial-study] canvas').waitFor({
    timeout: 15_000,
  });
  await page.evaluate(() => window.__EVAL_INVALIDATE__?.());
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );

  const rootTheme = await page.evaluate(
    () => document.documentElement.dataset.exaTheme
  );
  assert(
    rootTheme === 'exawatt-classic-dark',
    `gallery preview mutated the app theme: ${rootTheme}`
  );

  await assertPreview({
    theme: 'exawatt-air-light',
    contrast: 'standard',
    transparency: 'standard',
  });

  for (const viewport of [
    { width: 560, height: 400, theme: 'Air' },
    { width: 900, height: 700, theme: 'Night' },
    { width: 1400, height: 900, theme: 'Air' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await select(viewport.theme);
    await select('Layered');
    await select('Standard');
    await select('100% interface scale');
    await page.evaluate(() => window.scrollTo(0, 0));
    await assertNoHorizontalOverflow(viewport.width);
    await page.screenshot({
      path: join(
        OUTPUT,
        `${viewport.theme.toLowerCase()}-${viewport.width}x${viewport.height}.png`
      ),
    });
  }

  await page.setViewportSize({ width: 1400, height: 900 });
  const states = [
    {
      name: 'layered-standard',
      material: 'Layered',
      contrastButton: 'Standard',
      contrast: 'standard',
      transparency: 'standard',
    },
    {
      name: 'opaque-standard',
      material: 'Opaque',
      contrastButton: 'Standard',
      contrast: 'standard',
      transparency: 'reduced',
    },
    {
      name: 'layered-enhanced',
      material: 'Layered',
      contrastButton: 'Enhanced',
      contrast: 'enhanced',
      transparency: 'standard',
    },
  ];
  for (const [label, id] of [
    ['Air', 'exawatt-air-light'],
    ['Night', 'exawatt-night-dark'],
  ]) {
    for (const state of states) {
      await select(label);
      await select(state.material);
      await select(state.contrastButton);
      await select('100% interface scale');
      await assertPreview({
        theme: id,
        contrast: state.contrast,
        transparency: state.transparency,
      });
      await page.locator('[data-testid="theme-system-preview"]').screenshot({
        path: join(
          OUTPUT,
          `${label.toLowerCase()}-${state.name}-100.png`
        ),
      });
    }
  }

  await page.setViewportSize({ width: 560, height: 400 });
  await select('Air');
  await select('Layered');
  await select('Standard');
  for (const scale of ['90', '120']) {
    await select(`${scale}% interface scale`);
    await assertPreview({
      theme: 'exawatt-air-light',
      contrast: 'standard',
      transparency: 'standard',
      scale,
    });
    await assertNoHorizontalOverflow(560);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(OUTPUT, 'air-560x400-scale120.png') });

  const finalRootTheme = await page.evaluate(
    () => document.documentElement.dataset.exaTheme
  );
  assert(
    finalRootTheme === 'exawatt-classic-dark',
    `gallery preview persisted theme state: ${finalRootTheme}`
  );
  assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
  console.log(
    `PASS theme system: Air/Night state matrix at 100% + 560/900/1400 layouts + narrow 90/120 scales; screenshots: ${OUTPUT}`
  );
} finally {
  await browser.close();
}
