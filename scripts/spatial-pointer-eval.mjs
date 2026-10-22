#!/usr/bin/env node
/**
 * Spatial pointer-navigation eval (ENG-004 V3.3): primary drag band-selects,
 * plain wheel pans, pinch (ctrl/meta+wheel) zooms at the cursor,
 * click-vs-drag guards keep zone drilling intact, and reduced motion parks
 * the demand scene (byte-identical canvas across 900ms).
 *
 * Run: EXA_BASE=http://localhost:7100 pnpm eval:spatial:pointer
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

import {
  fleetView,
  fleetViewUrl,
  assertFleetView,
  prepareFleetViewPage,
  runFleetViewMatrix,
} from './lib/fleet-view-eval.mjs';
await runFleetViewMatrix(import.meta.url);

const BASE = process.env.EXA_BASE || 'http://localhost:7100';
const OUT = join('/tmp/exa-spatial-v24-nav', fleetView);
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok) => {
  results.push([name, ok]);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
};

const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});

// --- Main context: pointer navigation ---
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.message || e)));
await prepareFleetViewPage(page);
await page.goto(fleetViewUrl(`${BASE}/fleet/spatial`), { waitUntil: 'load' });
await page.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width > 0 && c.height > 0;
});
await assertFleetView(page);
await page.waitForTimeout(1600);

// Fleet modifier selection must address the clicked Agent, not the Project
// behind it. Read the shared picking slots, project a real body center, and
// assert the command panel's exact IDs rather than only a positive count.
const fleetAgentPoint = excluded =>
  page.evaluate(excluded => {
    if (
      document.querySelector('[data-spatial-board]')?.dataset.boardView === 'v2'
    ) {
      for (const button of document.querySelectorAll('[data-board-agent]')) {
        const id = button.dataset.boardAgent;
        if (excluded.includes(id)) continue;
        const rect = button.getBoundingClientRect();
        const x = rect.x + rect.width / 2,
          y = rect.y + rect.height / 2;
        if (
          document.elementFromPoint(x, y)?.closest('[data-board-agent]') ===
          button
        )
          return { id, x, y };
      }
      return null;
    }
    const node = window.__EVAL_SCENE__?.getObjectByName(
      'fleet-agent-hit-targets'
    );
    const camera = window.__EVAL_CAM__;
    const canvas = document.querySelector('canvas');
    if (!node || !camera || !canvas) return null;
    node.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const box = canvas.getBoundingClientRect();
    const matrix = node.matrix.clone();
    const visibleBody =
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-view') === 'v2'
        ? window.__EVAL_SCENE__?.getObjectByName('tile-agent-bodies')
        : null;
    visibleBody?.updateWorldMatrix(true, false);
    for (let slot = 0; slot < node.count; slot++) {
      const id = node.userData.agentIds[slot];
      if (excluded.includes(id)) continue;
      // v2 uses the visible body's actual center, not the picking geometry.
      const bodySlot = visibleBody?.userData.boardTileBodyIds?.indexOf(
        `agent:${id}`
      );
      if (visibleBody && (bodySlot === undefined || bodySlot < 0)) continue;
      const projectionNode = visibleBody ?? node;
      projectionNode.getMatrixAt(visibleBody ? bodySlot : slot, matrix);
      const point = node.position
        .clone()
        .set(0, 0, 0)
        .applyMatrix4(matrix)
        .applyMatrix4(projectionNode.matrixWorld)
        .project(camera);
      const x = box.x + ((point.x + 1) * box.width) / 2;
      const y = box.y + ((1 - point.y) * box.height) / 2;
      if (document.elementFromPoint(x, y) === canvas) return { id, x, y };
    }
    return null;
  }, excluded);
const expectSelectedIds = async ids => {
  await page.waitForFunction(
    expected => {
      const actual = [...document.querySelectorAll('[data-selection-member]')]
        .map(node => node.getAttribute('data-selection-member'))
        .sort();
      return JSON.stringify(actual) === JSON.stringify(expected);
    },
    [...ids].sort()
  );
};
const shiftClick = async point => {
  if (!point) throw new Error('No unobscured Fleet Agent target');
  if (fleetView === 'v2') {
    await page
      .locator(`[data-board-agent="${point.id}"]`)
      .click({ modifiers: ['Shift'] });
  } else {
    await page.keyboard.down('Shift');
    await page.mouse.click(point.x, point.y);
    await page.keyboard.up('Shift');
  }
};
if (fleetView === 'v2')
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas?.boardEvidence?.gl.info.render.triangles) return false;
    return [...document.querySelectorAll('[data-board-agent]')].some(button => {
      const rect = button.getBoundingClientRect();
      return (
        document
          .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          ?.closest('[data-board-agent]') === button
      );
    });
  });
const firstAgent = await fleetAgentPoint([]);
await shiftClick(firstAgent);
await expectSelectedIds([firstAgent.id]);
check('Fleet Shift-click selects exactly the clicked Agent', true);
// The selection panel can resize the world; read the next center after it opens.
const secondAgent = await fleetAgentPoint([firstAgent.id]);
await shiftClick(secondAgent);
await expectSelectedIds([firstAgent.id, secondAgent.id]);
check('Fleet Shift-click adds exactly one Agent', true);
await page.keyboard.press('Escape');
await expectSelectedIds([]);
const plainAgent = await fleetAgentPoint([]);
if (fleetView === 'v2')
  await page.locator(`[data-board-agent="${plainAgent.id}"]`).click();
else await page.mouse.click(plainAgent.x, plainAgent.y);
await page.waitForURL(/altitude=project/);
check('ordinary Fleet Agent click still drills its Project', true);
await page.keyboard.press('0');
await page.waitForFunction(
  () =>
    document
      .querySelector('[data-spatial-command]')
      ?.getAttribute('data-spatial-altitude') === 'fleet'
);
await page.waitForTimeout(900);

const viewportOf = () => {
  return window.__EVAL_BOARD_VIEWPORT__
    ? { ...window.__EVAL_BOARD_VIEWPORT__ }
    : null;
};

// An inspector can resize the projection without moving a perspective camera.
// Compare its actual pose; orthographic v1 retains its existing viewport check.
const sameCamera = (before, after) => {
  if (!before || !after) return false;
  if (before.perspective && after.perspective) {
    const a = before.perspective,
      b = after.perspective;
    return (
      a.target.every(
        (value, index) => Math.abs(value - b.target[index]) < 0.2
      ) &&
      Math.abs(a.distance - b.distance) < 0.2 &&
      Math.abs(a.azimuth - b.azimuth) < 0.001 &&
      Math.abs(a.polar - b.polar) < 0.001
    );
  }
  return (
    Math.abs(after.centerX - before.centerX) < 0.2 &&
    Math.abs(after.centerY - before.centerY) < 0.2
  );
};
const before = await page.evaluate(viewportOf);

// Primary drag draws a full-board selection band and does not move the camera.
const canvasBox = await page.locator('canvas').boundingBox();
await page.mouse.move(canvasBox.x + 12, canvasBox.y + canvasBox.height - 12);
await page.mouse.down();
await page.mouse.move(canvasBox.x + canvasBox.width - 12, canvasBox.y + 12, {
  steps: 12,
});
await page.mouse.up();
await page.waitForTimeout(700);
const afterDrag = await page.evaluate(viewportOf);
check('primary drag keeps the camera fixed', sameCamera(before, afterDrag));
check(
  'primary drag band-selects Agents',
  Number(
    await page
      .locator('[data-spatial-board]')
      .getAttribute('data-board-multi-count')
  ) > 0
);

// pinch-zoom (ctrl+wheel) zooms in at cursor
await page.mouse.move(800, 500);
await page.locator('canvas').evaluate(canvas => {
  canvas.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 800,
      clientY: 500,
      ctrlKey: true,
      deltaY: -240,
    })
  );
});
await page.waitForTimeout(700);
const afterZoom = await page.evaluate(viewportOf);
check(
  'pinch zooms in (viewport shrinks)',
  !!afterZoom && afterZoom.width < afterDrag.width * 0.95
);

// plain wheel pans
await page.mouse.wheel(120, 90);
await page.waitForTimeout(700);
const afterWheel = await page.evaluate(viewportOf);
check(
  'plain wheel pans',
  !!afterWheel &&
    (Math.abs(afterWheel.centerX - afterZoom.centerX) > 0.5 ||
      Math.abs(afterWheel.centerY - afterZoom.centerY) > 0.5)
);

// click (no drag) still drills a project from the zone card
await page.keyboard.press('0'); // recenter first
await page.waitForTimeout(900);
const zone = page.locator('[data-board-zone]').first();
await zone.click();
await page.waitForFunction(() =>
  new URL(window.location.href).searchParams.get('altitude')
);
check('zone click still drills after drag wiring', true);
await page.screenshot({ path: join(OUT, 'after-drill.png') });

check('no page errors in nav probe', errors.length === 0);
if (errors.length) console.log(errors.slice(0, 5));
await page.close();

// --- Touch context: direct pan/pinch plus explicit band-select mode ---
const touchPage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const touchErrors = [];
touchPage.on('pageerror', e => touchErrors.push(String(e.message || e)));
await prepareFleetViewPage(touchPage);
await touchPage.goto(fleetViewUrl(`${BASE}/fleet/spatial`), {
  waitUntil: 'load',
});
await touchPage.waitForFunction(() => {
  const canvas = document.querySelector('canvas');
  return canvas && canvas.width > 0 && window.__EVAL_BOARD_VIEWPORT__;
});
await touchPage.waitForTimeout(1200);
const touchCanvas = await touchPage.locator('canvas').boundingBox();
// A "clear" touch point must be clear of DOM controls by more than the
// browser's touch-target adjustment radius, not merely hit-test to the
// canvas: Chrome snaps a touch that lands within ~10-20px of a button onto
// that button, so a pan started just beside a zone chip is delivered to the
// chip and the camera never hears it. Measured: a start 7px above a chip's
// box produced pointer events on the chip and a pan of exactly 0.
const TOUCH_ADJUSTMENT_MARGIN = 28;
await assertFleetView(touchPage);
const readClearTouchPoints = () =>
  touchPage.evaluate(margin => {
    const canvas = document.querySelector('canvas');
    const rect = canvas.getBoundingClientRect();
    const controls = Array.from(
      document.querySelectorAll(
        'button, a, [role=button], input, [data-board-zone]'
      )
    )
      .map(el => el.getBoundingClientRect())
      .filter(r => r.width > 0 && r.height > 0);
    const nearControl = (x, y) =>
      controls.some(
        r =>
          x >= r.left - margin &&
          x <= r.right + margin &&
          y >= r.top - margin &&
          y <= r.bottom + margin
      );
    const points = [];
    for (let y = rect.top + 18; y < rect.bottom - 18; y += 24) {
      for (let x = rect.left + 18; x < rect.right - 18; x += 24) {
        if (document.elementFromPoint(x, y) !== canvas) continue;
        if (nearControl(x, y)) continue;
        points.push({ x, y });
      }
    }
    return points;
  }, TOUCH_ADJUSTMENT_MARGIN);
const clearTouchPoints = await readClearTouchPoints();
if (clearTouchPoints.length < 2) {
  throw new Error('Touch fixture has no clear board background gesture area');
}
const cdp = await touchPage.context().newCDPSession(touchPage);
const touchDrag = async (from, to) => {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...from, id: 1 }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / 8,
          y: from.y + ((to.y - from.y) * step) / 8,
          id: 1,
        },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
};
const touchViewport = () =>
  touchPage.evaluate(() => ({ ...window.__EVAL_BOARD_VIEWPORT__ }));
const touchBefore = await touchViewport();
await touchDrag(clearTouchPoints[Math.floor(clearTouchPoints.length / 2)], {
  x: clearTouchPoints[Math.floor(clearTouchPoints.length / 2)].x + 90,
  y: clearTouchPoints[Math.floor(clearTouchPoints.length / 2)].y,
});
await touchPage.waitForTimeout(700);
const touchAfterPan = await touchViewport();
check(
  'one-finger touch drag pans',
  Math.abs(touchAfterPan.centerX - touchBefore.centerX) > 0.5
);

const touchSelect = touchPage.locator('[data-board-touch-select]');
await touchSelect.waitFor({ state: 'visible' });
await touchSelect.click();
check(
  'touch selection mode is explicit',
  (await touchSelect.getAttribute('aria-pressed')) === 'true'
);
const beforeTouchBand = await touchViewport();
const selectionTouchPoints = await readClearTouchPoints();
await touchDrag(selectionTouchPoints[0], {
  x: touchCanvas.x + touchCanvas.width - 8,
  y: touchCanvas.y + touchCanvas.height - 8,
});
await touchPage.waitForTimeout(700);
const afterTouchBand = await touchViewport();
const touchBandCount = Number(
  await touchPage
    .locator('[data-spatial-board]')
    .getAttribute('data-board-multi-count')
);
check(
  'touch selection mode keeps camera fixed',
  sameCamera(beforeTouchBand, afterTouchBand)
);
check('touch selection mode band-selects Agents', touchBandCount > 0);

const pinchBefore = await touchViewport();
const pinchTouchPoints = await readClearTouchPoints();
let pinchPair = null;
for (const first of pinchTouchPoints) {
  for (const second of pinchTouchPoints) {
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    if (distance >= 48 && distance <= 96) {
      pinchPair = [first, second];
      break;
    }
  }
  if (pinchPair) break;
}
if (!pinchPair) throw new Error('Touch fixture has no clear pinch start pair');
const pinchCenter = {
  x: (pinchPair[0].x + pinchPair[1].x) / 2,
  y: (pinchPair[0].y + pinchPair[1].y) / 2,
};
const pinchDx = pinchPair[1].x - pinchPair[0].x;
const pinchDy = pinchPair[1].y - pinchPair[0].y;
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [
    { ...pinchPair[0], id: 1 },
    { ...pinchPair[1], id: 2 },
  ],
});
for (let step = 1; step <= 8; step += 1) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [
      {
        x: pinchCenter.x - pinchDx * (0.5 + step / 16),
        y: pinchCenter.y - pinchDy * (0.5 + step / 16),
        id: 1,
      },
      {
        x: pinchCenter.x + pinchDx * (0.5 + step / 16),
        y: pinchCenter.y + pinchDy * (0.5 + step / 16),
        id: 2,
      },
    ],
  });
}
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchEnd',
  touchPoints: [],
});
await touchPage.waitForTimeout(700);
const pinchAfter = await touchViewport();
const pinchZoomed = pinchBefore.perspective
  ? pinchAfter.perspective.distance < pinchBefore.perspective.distance * 0.95
  : pinchAfter.width < pinchBefore.width * 0.8;
if (!pinchZoomed) console.log('pinch evidence', { pinchBefore, pinchAfter });
check('two-finger touch pinch zooms', pinchZoomed);

// Direct touch selection remains available after camera gestures. Use a
// center whose topmost hit target is the Agent control so the probe tests the
// same 44px tap boundary as an operator, not a forced DOM click.
await touchSelect.click();
await touchPage.keyboard.press('Digit1');
await touchPage.waitForURL(/altitude=project/, { timeout: 10_000 });
await touchPage.waitForTimeout(900);
const tappableAgentId = await touchPage.evaluate(() => {
  for (const element of document.querySelectorAll('[data-board-agent]')) {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2
    );
    if (hit === element || element.contains(hit)) {
      return element.getAttribute('data-board-agent');
    }
  }
  return null;
});
if (!tappableAgentId) throw new Error('No Agent exposes a direct touch target');
await touchPage.locator(`[data-board-agent="${tappableAgentId}"]`).tap();
await touchPage.waitForURL(/altitude=agent/, { timeout: 10_000 });
check('direct touch tap opens an Agent', true);
check('no page errors in touch probe', touchErrors.length === 0);
if (touchErrors.length) console.log(touchErrors.slice(0, 5));
await touchPage.close();

// --- Reduced-motion context ---
const rmPage = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  reducedMotion: 'reduce',
});
const rmErrors = [];
rmPage.on('pageerror', e => rmErrors.push(String(e.message || e)));
await prepareFleetViewPage(rmPage);
// Live Demo records legitimately update every second, even with reduced motion.
// Pixel stability is an ambient-rendering contract only while inputs stay fixed.
await rmPage.goto(
  fleetViewUrl(`${BASE}/eval/t10-board-scale?agents=30&projects=5`),
  { waitUntil: 'load' }
);
await rmPage.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c && c.width > 0 && c.height > 0;
});
await assertFleetView(rmPage);
await rmPage.waitForTimeout(1500);
await rmPage.screenshot({ path: join(OUT, 'reduced-motion.png') });
// two shots apart: reduced motion must be static
const shot1 = await rmPage
  .locator('canvas')
  .screenshot({ path: join(OUT, 'rm-a.png') });
await rmPage.waitForTimeout(900);
const shot2 = await rmPage
  .locator('canvas')
  .screenshot({ path: join(OUT, 'rm-b.png') });
check(
  'reduced motion parks the scene (canvas byte-stable)',
  shot1.equals(shot2)
);
check('no page errors under reduced motion', rmErrors.length === 0);
await rmPage.close();

await browser.close();
const failed = results.filter(([, ok]) => !ok);
console.log(
  failed.length === 0
    ? 'NAV PROBE PASSED'
    : `FAILED: ${failed.map(([n]) => n).join(' | ')}`
);
process.exit(failed.length === 0 ? 0 : 1);
