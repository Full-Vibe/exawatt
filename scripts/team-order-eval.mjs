/**
 * Team ordering and grid-navigation gates (ENG-015 S6.3 / FIX-008,
 * FIX-002) — run against `/hud-gallery/team-order`, the deterministic rig
 * for the shipped surface.
 *
 *   1. Started order is the default: oldest first, the newest Agent last
 *      (Chrome's model), regardless of manual array order.
 *   2. The Activity sort leads each Project with working Agents and
 *      needs-you second — through the PRODUCTION control in the Team chrome.
 *   3. The re-sort GLIDES: at least one tile carries a mid-flight FLIP
 *      transform. The operator asked for the animation by name; a silent
 *      snap would pass every order assertion and still be a regression.
 *   4. The choice is stored: a reload comes back in the Activity sort.
 *   5. The keyboard owns the grid ACROSS A PROJECT BOUNDARY while the
 *      pointer rests on a tile (FIX-002, reopened 2026-08-16). This is the
 *      only gate that reaches the reopened defect: the geometry was right
 *      and the selection was taken back after the fact, by a mouse event
 *      Chromium re-dispatched at the resting cursor when the grid scrolled.
 *      Unit tests over hand-written rects cannot see it; a keyboard-only
 *      browser test cannot either.
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

  // Gate 1b — opening with a STORED sort settles silently. The order that
  // arrives with the preference is a starting point, not a re-sort, and an
  // unearned animation on every open is the thing this catches.
  await page.evaluate(() =>
    window.localStorage.setItem('exawatt.team-order.v1', 'activity')
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-expose-tile]');
  const settleTransforms = await page.evaluate(
    () =>
      Array.from(document.querySelectorAll('[data-expose-tile-slot]')).filter(
        node => {
          const transform = getComputedStyle(node).transform;
          return transform && transform !== 'none';
        }
      ).length
  );
  if (settleTransforms > 0) {
    throw new Error(
      `settle gate: ${settleTransforms} tiles animated while applying the stored sort on open`
    );
  }
  const settled = await titles();
  if (settled[0] !== 'Fix Sessions rendering') {
    throw new Error(
      `settle gate: the stored sort was not applied on the first paint, got ${JSON.stringify(settled)}`
    );
  }
  console.log('[team-order] gate ok: a stored sort settles on open without animating');

  // back to the default for the toggle gates
  await page.evaluate(() =>
    window.localStorage.removeItem('exawatt.team-order.v1')
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-expose-tile]');
  await page.waitForTimeout(600);

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

  // Gate 5 — FIX-002 reopened: ArrowDown out of a Project's last row must
  // reach the tile BENEATH it in the next Project's row, with the pointer
  // resting on the grid the whole time.
  await page.evaluate(() =>
    window.localStorage.removeItem('exawatt.team-order.v1')
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-expose-tile]');
  await page.waitForTimeout(700);

  const selection = () =>
    page.evaluate(() =>
      document
        .querySelector('[data-expose-tile][data-selected]')
        ?.getAttribute('data-expose-tab')
    );
  const scrollTop = () =>
    page.evaluate(() =>
      Math.round(
        document.querySelector('[data-expose] .overflow-y-auto')?.scrollTop ??
          -1
      )
    );

  // Where the geometry says Down goes, read off the RENDERED layout: the
  // nearest row below the selection, then the tile in it whose horizontal
  // centre is closest. Asserting against measured rects rather than a
  // hard-coded id keeps the gate true if the fixture or column count moves.
  const plan = await page.evaluate(() => {
    const box = node => {
      const r = node.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    };
    const project = node =>
      node
        .closest('[data-expose-project]')
        ?.getAttribute('data-expose-project');
    const tiles = Array.from(document.querySelectorAll('[data-expose-tile]'));
    const origin = document.querySelector('[data-expose-tile][data-selected]');
    if (!origin) return { error: 'nothing selected on open' };
    const o = box(origin);
    const sameRow = b => b.top < o.bottom && o.top < b.bottom;
    // a tile the pointer can rest on: same row as the selection, left of it
    const rest = tiles.find(
      n => n !== origin && sameRow(box(n)) && box(n).cx < o.cx
    );
    const below = tiles
      .map(n => ({ n, b: box(n) }))
      .filter(e => !sameRow(e.b) && e.b.cy > o.cy);
    if (below.length === 0)
      return { error: 'the selection has no row below it' };
    const closest = below.reduce((best, e) =>
      Math.abs(e.b.cy - o.cy) < Math.abs(best.b.cy - o.cy) ? e : best
    );
    const row = below.filter(
      e => e.b.top < closest.b.bottom && closest.b.top < e.b.bottom
    );
    const target = row.reduce((best, e) =>
      Math.abs(e.b.cx - o.cx) < Math.abs(best.b.cx - o.cx) ? e : best
    );
    return {
      origin: origin.getAttribute('data-expose-tab'),
      originProject: project(origin),
      target: target.n.getAttribute('data-expose-tab'),
      targetProject: project(target.n),
      // the tiles in that row the operator must NOT land on
      others: row
        .filter(e => e.n !== target.n)
        .map(e => e.n.getAttribute('data-expose-tab')),
      rest: rest
        ? {
            id: rest.getAttribute('data-expose-tab'),
            x: Math.round(box(rest).cx),
            y: Math.round(box(rest).cy),
          }
        : null,
    };
  });
  if (plan.error) throw new Error(`grid gate: ${plan.error}`);
  if (!plan.rest) {
    throw new Error(
      'grid gate: the fixture no longer puts a second tile in the selection row — the rig cannot express the reported case'
    );
  }
  if (plan.originProject === plan.targetProject) {
    throw new Error(
      `grid gate: the fixture no longer crosses a Project boundary here (${plan.originProject} → ${plan.targetProject})`
    );
  }

  const before = await scrollTop();
  await page.mouse.move(plan.rest.x, plan.rest.y);
  await page.waitForTimeout(300);
  const resting = await selection();
  if (resting !== plan.origin) {
    throw new Error(
      `grid gate: a pointer that came to rest took the selection (${plan.origin} → ${resting})`
    );
  }
  console.log(
    '[team-order] gate ok: a resting pointer leaves the selection alone'
  );

  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(500);
  const landed = await selection();
  const after = await scrollTop();
  if (landed !== plan.target) {
    throw new Error(
      `grid gate: ArrowDown from ${plan.origin} (${plan.originProject}) landed on ${landed}, not the tile beneath it (${plan.target} in ${plan.targetProject}); the other tiles in that row are ${JSON.stringify(plan.others)}`
    );
  }
  if (after === before) {
    throw new Error(
      'grid gate: crossing the Project boundary no longer scrolls the grid, so the gate no longer exercises the scroll that re-dispatches the pointer'
    );
  }
  console.log(
    `[team-order] gate ok: ArrowDown crossed ${plan.originProject} → ${plan.targetProject} to the tile beneath it (scrolled ${after - before}px under a resting pointer)`
  );

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log(
    'PASS team ordering: Started default, live Activity glide, stored choice, spatial grid across a Project boundary'
  );
} finally {
  await browser.close();
}
