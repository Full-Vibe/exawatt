#!/usr/bin/env node

/**
 * Screenshot the pace-opportunity study (ENG-008 E9 design options).
 *
 * Headless by default (standing rule). One full-section shot per fixture
 * state plus one crop per direction card, so every direction × state ×
 * placement is on disk for the operator pick without re-driving the app.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7143';
const OUT = process.env.EXA_E9_SHOTS || '/tmp/exawatt-e9-opportunity';
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

const STATES = [
  { id: 'comfortable', label: 'Comfortable pace' },
  { id: 'mildly-behind', label: 'Mildly behind' },
  { id: 'strongly-behind', label: 'Strongly behind · near reset' },
  { id: 'expired', label: 'Opportunity expired' },
  { id: 'dual-signal', label: 'Dual signal · hot + expiring' },
];

const DIRECTIONS = [
  { id: 'chip', name: 'Direction A — Quiet chip' },
  { id: 'geometry', name: 'Direction B — Expiry geometry' },
  { id: 'swap', name: 'Direction C — Metric swap + coach' },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({
  viewport: { width: 1720, height: 1400 },
  deviceScaleFactor: 2,
});
await primeEvalBrowserPage(page);
await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
  key: APPEARANCE_KEY,
  value: JSON.stringify(appearancePreference('exawatt-night-dark')),
});

await page.goto(`${BASE}/hud-gallery`, { waitUntil: 'domcontentloaded' });
const section = page.locator('section#pace-opportunity');
await section.waitFor({ state: 'visible', timeout: 60_000 });
await section.scrollIntoViewIfNeeded();
await page.waitForTimeout(600); // reveal transition settles

for (const state of STATES) {
  await page.getByRole('button', { name: state.label, exact: true }).click();
  await page.waitForTimeout(250);
  await section.screenshot({ path: join(OUT, `state-${state.id}.png`) });
  for (const d of DIRECTIONS) {
    await page
      .locator(`section[aria-label="${d.name}"]`)
      .screenshot({ path: join(OUT, `state-${state.id}--${d.id}.png`) });
  }
  console.log(`shot ${state.id}`);
}

await browser.close();
console.log(`done → ${OUT}`);
