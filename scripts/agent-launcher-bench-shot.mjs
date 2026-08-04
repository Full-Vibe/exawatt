#!/usr/bin/env node

/**
 * Screenshot every New Agent launcher bench case (ENG-016 D49).
 *
 * Headless by default (standing rule). One shot per scenario per chip variant
 * plus a full-page contact sheet, so a design iteration can be compared
 * against the previous round without re-driving the app by hand.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7049';
const OUT = process.env.EXA_LAUNCHER_SHOTS || '/tmp/exawatt-launcher-bench';
const VARIANTS = (process.env.EXA_LAUNCHER_VARIANTS || 'role-tag').split(',');
const APPEARANCE_KEY = 'exawatt.appearance.v1';

const appearancePreference = themeId => ({
  schemaVersion: 1,
  selection: { mode: 'manual', themeId },
  autoPair: {
    lightThemeId: 'exawatt-air-light',
    darkThemeId: 'exawatt-night-dark',
  },
  accentSource: 'theme',
  interfaceFont: 'theme',
  interfaceScale: 100,
  contrast: 'system',
  transparency: 'system',
});

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({
  viewport: { width: 1600, height: 1200 },
  deviceScaleFactor: 2,
});
await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
  key: APPEARANCE_KEY,
  value: JSON.stringify(appearancePreference('exawatt-night-dark')),
});

const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

await page.goto(`${BASE}/hud-gallery/agent-launcher`, {
  waitUntil: 'networkidle',
});
await page.waitForSelector('[data-launcher-bench]');

for (const variant of VARIANTS) {
  await page.click(`[data-bench-variant="${variant}"]`);
  await page.waitForTimeout(450);

  const cases = await page.$$eval('[data-bench-case]', nodes =>
    nodes.map(node => node.getAttribute('data-bench-case'))
  );

  for (const id of cases) {
    const element = await page.$(`[data-bench-case="${id}"]`);
    if (!element) continue;
    await element.screenshot({ path: join(OUT, `${variant}--${id}.png`) });
  }

  await page.screenshot({
    path: join(OUT, `${variant}--contact-sheet.png`),
    fullPage: true,
  });
  console.log(`[launcher-bench] ${variant}: ${cases.length} cases`);
}

await browser.close();

if (errors.length > 0) {
  console.error('[launcher-bench] page errors:');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`[launcher-bench] screenshots in ${OUT}`);
