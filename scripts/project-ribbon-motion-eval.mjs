#!/usr/bin/env node

import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.EXAWATT_RIBBON_SCREENSHOTS || '/tmp/exawatt-project-ribbon';

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to the shared Playwright cache.
  }
  const home = process.env.HOME || '';
  for (const root of [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ]) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      for (const candidate of [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

const executablePath = resolveChromium();
if (executablePath === null) {
  throw new Error(
    'Chromium is unavailable. Run `pnpm exec playwright install chromium`.'
  );
}

mkdirSync(SCREENSHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath || undefined,
});
const page = await browser.newPage({ viewport: { width: 1500, height: 760 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));
page.on('console', message => {
  if (message.type() === 'error') errors.push(message.text());
});

const rect = locator =>
  locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

try {
  await page.goto(`${BASE}/hud-gallery/project-ribbon`, {
    waitUntil: 'networkidle',
  });
  const study = page.locator('main');
  const strip = study.locator('[data-workspace-tab-strip]');
  await strip.waitFor();
  await study.screenshot({ path: join(SCREENSHOT_DIR, 'density-wide.png') });

  const wideMetrics = await strip.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const visible = Array.from(
      element.querySelectorAll('[data-ribbon-item]')
    ).filter(node => {
      const style = getComputedStyle(node);
      return style.opacity !== '0' && style.pointerEvents !== 'none';
    });
    return {
      rows: Number(element.getAttribute('data-ribbon-rows')),
      hidden: Number(element.getAttribute('data-ribbon-hidden') || 0),
      height: bounds.height,
      itemBottoms: visible.map(node => node.getBoundingClientRect().bottom),
      stripBottom: bounds.bottom,
    };
  });
  if (
    wideMetrics.rows !== 2 ||
    wideMetrics.height > 64.5 ||
    wideMetrics.hidden < 1 ||
    wideMetrics.itemBottoms.some(bottom => bottom > wideMetrics.stripBottom + 1)
  ) {
    throw new Error(
      `Representative density broke the two-row contract: ${JSON.stringify(wideMetrics)}`
    );
  }

  // Selecting an inactive Project swaps one expanded sequence for another.
  // A surviving header must travel through intermediate target bounds instead
  // of teleporting after a flex reflow.
  const survivor = study.locator('[data-project="cortex-ehr"]');
  const beforeSelect = await rect(survivor);
  await survivor.evaluate(element => {
    const trace = {
      frames: [],
      transitions: [],
    };
    window.__exawattRibbonMotionTrace = trace;
    const startedAt = performance.now();
    const recordFrame = now => {
      const bounds = element.getBoundingClientRect();
      trace.frames.push({
        elapsedMs: now - startedAt,
        x: bounds.x,
        y: bounds.y,
      });
      if (now - startedAt < 350) requestAnimationFrame(recordFrame);
    };
    element.addEventListener(
      'transitionrun',
      event => {
        trace.transitions.push({
          phase: 'run',
          property: event.propertyName,
          elapsedTime: event.elapsedTime,
        });
      },
      { once: true }
    );
    element.addEventListener(
      'transitionend',
      event => {
        trace.transitions.push({
          phase: 'end',
          property: event.propertyName,
          elapsedTime: event.elapsedTime,
        });
      },
      { once: true }
    );
    requestAnimationFrame(recordFrame);
  });
  await study.getByRole('button', { name: 'gpagent', exact: true }).click();
  await page.waitForTimeout(280);
  const afterSelect = await rect(survivor);
  const selectTrace = await page.evaluate(
    () => window.__exawattRibbonMotionTrace
  );
  const duringSelect = selectTrace.frames.find(
    frame =>
      distance(frame, beforeSelect) >= 1 &&
      distance(frame, afterSelect) >= 1
  );
  if (distance(beforeSelect, afterSelect) < 20) {
    throw new Error('Project selection did not produce a measurable reflow');
  }
  if (!duringSelect) {
    throw new Error(
      `Reflow skipped every intermediate frame: ${JSON.stringify({ beforeSelect, afterSelect, selectTrace })}`
    );
  }
  await study.screenshot({
    path: join(SCREENSHOT_DIR, 'selected-gpagent.png'),
  });

  // Pointer close gets a short Chrome-style stability window: adjacent close
  // targets do not jump under the pointer, then the layout releases smoothly.
  const stableTarget = study.locator('[data-project="exawatt"]');
  const beforeClose = await rect(stableTarget);
  await study
    .getByRole('button', { name: 'Close Fix the UTC date boundary' })
    .click();
  await page.waitForTimeout(240);
  const heldClose = await rect(stableTarget);
  if (distance(beforeClose, heldClose) > 2) {
    throw new Error(
      `Pointer close target moved during stabilization: ${JSON.stringify({ beforeClose, heldClose })}`
    );
  }
  await page.waitForTimeout(620);
  const releasedClose = await rect(stableTarget);
  if (distance(beforeClose, releasedClose) < 10) {
    throw new Error(
      `Pointer close never released target bounds: ${JSON.stringify({ beforeClose, releasedClose })}`
    );
  }

  // Empty Projects are not deleted. Their only automatic ordering policy is a
  // stable partition into the dormant tail, and reversing that state reflows.
  const emptyProject = study.locator('[data-project="switcheroo"]');
  const tailed = await rect(emptyProject);
  await study.getByRole('button', { name: 'Toggle empty tail' }).click();
  await page.waitForTimeout(260);
  const manualSlot = await rect(emptyProject);
  if (distance(tailed, manualSlot) < 20) {
    throw new Error(
      `Empty Project did not leave its dormant tail: ${JSON.stringify({ tailed, manualSlot })}`
    );
  }

  await page.setViewportSize({ width: 860, height: 680 });
  await page.waitForTimeout(260);
  const narrowMetrics = await strip.evaluate(element => ({
    rows: Number(element.getAttribute('data-ribbon-rows')),
    height: element.getBoundingClientRect().height,
    hidden: Number(element.getAttribute('data-ribbon-hidden') || 0),
    overflow: Number(
      element
        .querySelector('[data-ribbon-overflow]')
        ?.getAttribute('data-ribbon-overflow') || 0
    ),
  }));
  if (
    narrowMetrics.rows > 2 ||
    narrowMetrics.height > 64.5 ||
    narrowMetrics.hidden < 1 ||
    narrowMetrics.overflow !== narrowMetrics.hidden
  ) {
    throw new Error(
      `Narrow overflow contract failed: ${JSON.stringify(narrowMetrics)}`
    );
  }
  await study.screenshot({ path: join(SCREENSHOT_DIR, 'density-narrow.png') });

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'networkidle' });
  const reducedStudy = page.locator('main');
  const transition = await reducedStudy
    .locator('[data-ribbon-item]')
    .first()
    .evaluate(element => getComputedStyle(element).transitionDuration);
  if (!transition.split(',').every(value => Number.parseFloat(value) === 0)) {
    throw new Error(
      `Reduced motion left ribbon transitions enabled: ${transition}`
    );
  }

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        wide: wideMetrics,
        narrow: narrowMetrics,
        motion: {
          beforeSelect,
          duringSelect,
          afterSelect,
          pointerHeldForMs: 240,
          reducedTransition: transition,
        },
        screenshots: SCREENSHOT_DIR,
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
