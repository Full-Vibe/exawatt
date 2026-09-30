#!/usr/bin/env node

/**
 * Usage scenarios eval (ENG-008 E15): screenshot every scenario the
 * `/hud-gallery/usage-scenarios` workbench renders and fail on broken
 * geometry. The workbench mounts the production Overview body and the
 * production chrome meter, so this is the Usage page's own paint.
 *
 * Prerequisite: this worktree's dev server, `pnpm dev -p <port>`, named by
 * `EXA_BASE` (default http://localhost:7461). Headless (standing rule).
 * Shots land in `EXA_USAGE_SHOTS` (default /tmp/exawatt-usage-scenarios).
 *
 * The scenario list is read from the workbench's own navigation, never
 * retyped here, so a new scenario is covered the moment it exists.
 *
 * Asserted per shot, because each is a defect a screenshot skim has missed
 * on this page's ancestors:
 *   - no page errors and no horizontal scroll at desktop or phone width;
 *   - every element inside an account card stays inside the card;
 *   - a meter's percent label never overlaps its bar, and a bar's fill never
 *     outgrows its track;
 *   - no text inside a card is clipped;
 *   - a meter forecasting "runs out" or "spent" implies the headline exists
 *     (the page's one-sentence contract, read from the page's own data);
 *   - the chrome meter's popover opens inside the viewport.
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7461';
const OUT = process.env.EXA_USAGE_SHOTS || '/tmp/exawatt-usage-scenarios';
const APPEARANCE_KEY = 'exawatt.appearance.v1';
const ROUTE = '/hud-gallery/usage-scenarios';

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

const VIEWS = [
  { id: 'night', theme: 'exawatt-night-dark', width: 1280, height: 900 },
  { id: 'air', theme: 'exawatt-air-light', width: 1280, height: 900 },
  { id: 'phone', theme: 'exawatt-night-dark', width: 390, height: 844 },
];

/** Simulated futures worth a shot beyond each scenario's present. */
const SIMULATIONS = [
  { s: 'runs-out-before-reset', h: 18, burn: 1 },
  { s: 'comfortable', h: 60, burn: 3 },
];

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});

const failures = [];
let shots = 0;

/** Geometry the page must hold, measured in the page. */
async function measure(page) {
  return page.evaluate(() => {
    const out = [];
    const rect = el => el.getBoundingClientRect();
    const inside = (inner, outer) =>
      inner.left >= outer.left - 0.5 &&
      inner.right <= outer.right + 0.5 &&
      inner.top >= outer.top - 0.5 &&
      inner.bottom <= outer.bottom + 0.5;
    const overlaps = (a, b) =>
      a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

    if (document.documentElement.scrollWidth > window.innerWidth + 1) {
      out.push(
        `horizontal scroll: ${document.documentElement.scrollWidth}px content in ${window.innerWidth}px`
      );
    }
    for (const card of document.querySelectorAll('main [data-usage-account]')) {
      const box = rect(card);
      const name = card.getAttribute('data-usage-account');
      for (const el of card.querySelectorAll('*')) {
        const r = rect(el);
        if (r.width === 0 && r.height === 0) continue;
        if (!inside(r, box)) {
          out.push(`${name}: <${el.tagName.toLowerCase()}> escapes its card`);
          break;
        }
      }
      for (const el of card.querySelectorAll('span, p, h2')) {
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow === 'hidden') {
          out.push(`${name}: clipped text "${el.textContent}"`);
        }
      }
      for (const meter of card.querySelectorAll('[data-usage-meter]')) {
        const bar = meter.querySelector('[data-usage-bar]');
        if (!bar) continue;
        const barBox = rect(bar);
        for (const label of meter.querySelectorAll('span')) {
          if (!/% used$/u.test(label.textContent ?? '')) continue;
          if (overlaps(rect(label), barBox)) {
            out.push(`${name}: percent label overlaps its bar`);
          }
        }
        const [track, fill] = bar.children;
        if (track && fill && rect(fill).width > rect(track).width + 0.5) {
          out.push(`${name}: bar fill outgrows its track`);
        }
      }
    }
    const alarming = document.querySelector(
      'main [data-usage-forecast="runs-out"], main [data-usage-forecast="spent"]'
    );
    if (alarming && !document.querySelector('main [data-usage-headline]')) {
      out.push('a meter runs out but the page has no headline');
    }
    return out;
  });
}

async function openPage(view) {
  const page = await browser.newPage({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: 2,
  });
  await primeEvalBrowserPage(page);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
    key: APPEARANCE_KEY,
    value: JSON.stringify(appearancePreference(view.theme)),
  });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return { page, errors };
}

async function shoot(page, errors, view, query, name) {
  await page.goto(`${BASE}${ROUTE}?${query}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-usage-scenarios]');
  await page.waitForSelector('main [data-usage-account], main [data-usage-empty]');
  const problems = await measure(page);
  for (const problem of problems) failures.push(`${name} · ${view.id}: ${problem}`);
  for (const error of errors.splice(0)) failures.push(`${name} · ${view.id}: page error ${error}`);
  await page.screenshot({ path: join(OUT, `${name}.${view.id}.png`), fullPage: true });
  shots += 1;
}

const { page: indexPage } = await openPage(VIEWS[0]);
await indexPage.goto(`${BASE}${ROUTE}`, { waitUntil: 'load' });
await indexPage.waitForSelector('nav[aria-label="Scenarios"] a');
const scenarios = await indexPage.$$eval('nav[aria-label="Scenarios"] a', links =>
  links.map(a => new URL(a.href).searchParams.get('s')).filter(Boolean)
);
await indexPage.close();
if (scenarios.length === 0) failures.push('the workbench lists no scenarios');

for (const view of VIEWS) {
  const { page, errors } = await openPage(view);
  for (const s of scenarios) {
    await shoot(page, errors, view, `s=${s}&h=0&burn=1`, s);
  }
  if (view.id === 'night') {
    for (const sim of SIMULATIONS) {
      await shoot(
        page,
        errors,
        view,
        `s=${sim.s}&h=${sim.h}&burn=${sim.burn}`,
        `${sim.s}.plus${sim.h}h.burn${sim.burn}`
      );
    }
    // The glance: hover the chrome meter and hold its popover to the viewport.
    await page.goto(`${BASE}${ROUTE}?s=${scenarios[0]}&h=0&burn=1`, { waitUntil: 'load' });
    await page.hover('[data-consumption-chrome-meter]');
    const popover = await page.waitForSelector('[data-meter-popover]');
    const box = await popover.boundingBox();
    if (!box || box.x < 0 || box.y < 0 || box.x + box.width > view.width) {
      failures.push(`popover · ${view.id}: opens outside the viewport`);
    }
    await page.screenshot({ path: join(OUT, `popover.${view.id}.png`) });
    shots += 1;
  }
  await page.close();
}

await browser.close();

console.log(`[usage-scenarios] ${shots} shots in ${OUT}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`[usage-scenarios] FAIL ${failure}`);
  process.exit(1);
}
console.log('[usage-scenarios] PASS');
