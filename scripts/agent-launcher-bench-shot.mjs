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

const BASE = process.env.EXA_BASE || 'http://localhost:7050';
const OUT = process.env.EXA_LAUNCHER_SHOTS || '/tmp/exawatt-launcher-bench';
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

const cases = await page.$$eval('[data-bench-case]', nodes =>
  nodes.map(node => node.getAttribute('data-bench-case'))
);

for (const id of cases) {
  const element = await page.$(`[data-bench-case="${id}"]`);
  if (!element) continue;
  await element.screenshot({ path: join(OUT, `${id}.png`) });
}

await page.screenshot({
  path: join(OUT, 'contact-sheet.png'),
  fullPage: true,
});
console.log(`[launcher-bench] ${cases.length} cases`);

// Gate: the skeleton must be the real chip, not a lookalike. The operator
// asked for this explicitly — a placeholder that is one pixel shorter still
// makes the row jump on settle, which is the finding the state exists to fix.
// Gate: the drawer handle must be ATTACHED to the row, not floating under it.
// Round 3 shipped a handle separated by an 8px flex gap and the operator saw
// it immediately; a measurement is cheaper than another review round.
const attachment = await page.evaluate(() => {
  const scope = document.querySelector('[data-bench-case="trained"]');
  const chip = scope?.querySelector('[data-setup-chip]');
  const handle = scope?.querySelector('[data-setup-drawer-handle]');
  if (!chip || !handle) return null;
  const chipBox = chip.getBoundingClientRect();
  const handleBox = handle.getBoundingClientRect();
  const rowWidth = chip.parentElement?.getBoundingClientRect().width ?? 0;
  return {
    gap: Math.round((handleBox.top - chipBox.bottom) * 100) / 100,
    handleWidth: Math.round(handleBox.width),
    rowWidth: Math.round(rowWidth),
    label: handle.textContent?.trim() ?? '',
  };
});

if (!attachment) {
  errors.push('[gate] could not measure the drawer handle');
} else {
  // -1 is the deliberate border overlap; anything positive is a visible gap.
  if (attachment.gap > 0) {
    errors.push(
      `[gate] drawer handle is detached from the row: ${attachment.gap}px gap`
    );
  }
  if (attachment.gap < -2) {
    errors.push(
      `[gate] drawer handle overlaps the row by ${-attachment.gap}px, not a shared border`
    );
  }
  // A bare chevron does not say what the drawer holds.
  if (!/Engine|Model|Thinking|Permission/.test(attachment.label)) {
    errors.push(
      `[gate] closed drawer handle names nothing it contains: "${attachment.label}"`
    );
  }
  if (errors.length === 0) {
    console.log(
      `[launcher-bench] gate ok: handle attached (${attachment.gap}px), labelled "${attachment.label}"`
    );
  }
}

// Gate: an OPEN drawer must not leave a full-width band with nothing in it.
// The first attached-handle cut did exactly that and only a screenshot caught
// it, which is the review loop this gate exists to replace.
const openState = await page.evaluate(() => {
  const scope = document.querySelector('[data-bench-case="detail"]');
  const handle = scope?.querySelector('[data-setup-drawer-handle]');
  const panel = scope?.querySelector('[data-setup-detail]');
  const done = scope?.querySelector('[data-setup-drawer-done]');
  if (!handle || !panel) return null;
  return {
    handleHeight: Math.round(handle.getBoundingClientRect().height),
    panelHeight: Math.round(panel.getBoundingClientRect().height),
    hasDone: Boolean(done),
  };
});

if (!openState) {
  errors.push('[gate] could not measure the open drawer');
} else {
  if (openState.handleHeight > 0) {
    errors.push(
      `[gate] open drawer still renders a ${openState.handleHeight}px handle band`
    );
  }
  if (openState.panelHeight < 40) {
    errors.push('[gate] open drawer panel did not expand');
  }
  if (!openState.hasDone) {
    errors.push('[gate] open drawer has no visible way to close it');
  }
  if (errors.length === 0) {
    console.log('[launcher-bench] gate ok: open drawer has no empty band');
  }
}

const geometry = await page.evaluate(() => {
  const box = selector => {
    const node = document.querySelector(selector);
    if (!node) return null;
    const { width, height } = node.getBoundingClientRect();
    return { width: Math.round(width), height: Math.round(height) };
  };
  const lineCount = selector =>
    document.querySelector(selector)?.children.length ?? -1;
  return {
    pending: box('[data-bench-case="settling"] [data-setup-chip][data-pending]'),
    real: box('[data-bench-case="trained"] [data-setup-chip]:not([data-pending])'),
    pendingLines: lineCount(
      '[data-bench-case="settling"] [data-setup-chip][data-pending]'
    ),
    realLines: lineCount(
      '[data-bench-case="trained"] [data-setup-chip]:not([data-pending])'
    ),
  };
});

if (!geometry.pending || !geometry.real) {
  errors.push('[gate] could not measure both a pending and a real chip');
} else {
  if (geometry.pending.height !== geometry.real.height) {
    errors.push(
      `[gate] skeleton/real chip height diverged: ${geometry.pending.height} vs ${geometry.real.height}`
    );
  }
  if (geometry.pendingLines !== geometry.realLines) {
    errors.push(
      `[gate] skeleton/real chip line count diverged: ${geometry.pendingLines} vs ${geometry.realLines}`
    );
  }
  if (errors.length === 0) {
    console.log(
      `[launcher-bench] gate ok: skeleton and real chip both ${geometry.real.height}px, ${geometry.realLines} lines`
    );
  }
}

await browser.close();

if (errors.length > 0) {
  console.error('[launcher-bench] page errors:');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`[launcher-bench] screenshots in ${OUT}`);
