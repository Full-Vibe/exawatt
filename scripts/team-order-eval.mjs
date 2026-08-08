/**
 * Team ordering gates (ENG-015 S6.3, FIX-008) — run against
 * `/hud-gallery/team-order`, the deterministic rig for the shipped surface.
 *
 *   1. Started order is the default: oldest first, the newest Agent last
 *      (Chrome's model), regardless of manual array order.
 *   2. The Activity sort leads each Project with working Agents and
 *      needs-you second — through the PRODUCTION control in the Team chrome.
 *   3. The re-sort GLIDES: at least one tile carries a mid-flight FLIP
 *      transform. The operator asked for the animation by name; a silent
 *      snap would pass every order assertion and still be a regression.
 *   4. The choice is stored: a reload comes back in the Activity sort.
 */
import { chromium } from 'playwright-core';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';

const browser = await chromium.launch({
  ...(await resolveQaBrowserLaunchOptions(chromium)),
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
await primeEvalBrowserPage(page);
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));

const titles = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-expose-tile]')).map(
      node => node.getAttribute('aria-label')?.split(',')[0] ?? ''
    )
  );

try {
  await page.goto(`${BASE}/hud-gallery/team-order`, {
    waitUntil: 'networkidle',
  });
  await page.waitForSelector('[data-expose-tile]');
  await page.waitForTimeout(600);

  // Gate 1 — Started default. Fixture manual order puts the newest first;
  // the view must put it last.
  const createdOrder = await titles();
  const exawattCreated = createdOrder.slice(0, 5);
  if (
    exawattCreated[0] !== 'Review keyboard navigation' ||
    exawattCreated.at(-1) !== 'Ship the launcher redraw'
  ) {
    throw new Error(
      `started order gate: expected oldest→newest, got ${JSON.stringify(createdOrder)}`
    );
  }
  console.log('[team-order] gate ok: Started default is oldest→newest');

  // Gate 2+3 — select Activity through the production control; the order
  // changes AND glides.
  await page.getByRole('radio', { name: 'Activity' }).click();
  // sample transforms mid-flight: FLIP applies an inverted translate and
  // releases it over ~320ms, so shortly after the click at least one tile
  // slot must carry a non-identity transform
  await page.waitForTimeout(80);
  const midFlight = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll('[data-expose-tile-slot]')
    ).filter(node => {
      const transform = getComputedStyle(node).transform;
      return transform && transform !== 'none';
    }).length
  );
  await page.waitForTimeout(600);
  const activeOrder = await titles();
  if (activeOrder[0] !== 'Fix Sessions rendering') {
    throw new Error(
      `activity gate: working Agent does not lead, got ${JSON.stringify(activeOrder)}`
    );
  }
  if (activeOrder[1] !== 'Review keyboard navigation') {
    throw new Error(
      `activity gate: needs-you Agent is not second, got ${JSON.stringify(activeOrder)}`
    );
  }
  console.log('[team-order] gate ok: Activity leads with working, needs-you second');
  if (midFlight === 0) {
    throw new Error(
      'glide gate: no tile carried a FLIP transform mid-flight — the re-sort snapped'
    );
  }
  console.log(`[team-order] gate ok: ${midFlight} tiles glided`);

  // Gate 4 — the preference survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-expose-tile]');
  await page.waitForTimeout(600);
  const reloaded = await titles();
  if (reloaded[0] !== 'Fix Sessions rendering') {
    throw new Error(
      `persistence gate: reload lost the Activity sort, got ${JSON.stringify(reloaded)}`
    );
  }
  const checked = await page
    .getByRole('radio', { name: 'Activity' })
    .getAttribute('aria-checked');
  if (checked !== 'true') {
    throw new Error(
      'persistence gate: the control does not show the stored sort'
    );
  }
  console.log('[team-order] gate ok: the Activity sort survives a reload');

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log('PASS team ordering: Started default, live Activity glide, stored choice');
} finally {
  await browser.close();
}
