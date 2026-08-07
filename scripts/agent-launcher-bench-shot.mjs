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
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

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
    pending: box(
      '[data-bench-case="settling"] [data-setup-chip][data-pending]'
    ),
    real: box(
      '[data-bench-case="trained"] [data-setup-chip]:not([data-pending])'
    ),
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

// Gate: fixed-height card rows may not wrap into each other, and ranking
// provenance is not card content. The operator caught both failures in the
// rendered bench: "Extra high thinking" painted over "Suggested" while Opus
// surrendered its name to the context label beside it.
const cardAudit = await page.evaluate(() => {
  const cards = Array.from(
    document.querySelectorAll(
      '[data-setup-chip]:not([data-pending]):not([data-unavailable])'
    )
  );
  const overflow = [];
  const overlap = [];
  const provenance = [];
  let opus = null;

  for (const card of cards) {
    const id = card.getAttribute('data-setup-id') ?? 'unknown';
    const text = card.textContent ?? '';
    if (/\b(?:Suggested|Pinned|Used once|Used \d+[×x])\b/.test(text)) {
      provenance.push({ id, text: text.trim() });
    }

    const secondary = card.querySelector('[data-setup-secondary]');
    const thinking = card.querySelector('[data-setup-thinking]');
    for (const [name, node] of [
      ['secondary', secondary],
      ['thinking', thinking],
    ]) {
      if (node && node.scrollHeight > node.clientHeight + 1) {
        overflow.push({
          id,
          line: name,
          scroll: node.scrollHeight,
          client: node.clientHeight,
        });
      }
    }
    if (secondary && thinking) {
      const upper = secondary.getBoundingClientRect();
      const lower = thinking.getBoundingClientRect();
      if (upper.bottom > lower.top + 1) {
        overlap.push({
          id,
          amount: Math.round((upper.bottom - lower.top) * 100) / 100,
        });
      }
    }

    const model = card.querySelector('[data-setup-model]');
    if (model?.textContent?.trim().startsWith('Opus')) {
      opus = {
        text: model.textContent.trim(),
        scroll: model.scrollWidth,
        client: model.clientWidth,
      };
    }
  }

  return { overflow, overlap, provenance, opus };
});

if (cardAudit.provenance.length > 0) {
  errors.push(
    `[gate] launcher cards still show ranking provenance: ${JSON.stringify(cardAudit.provenance)}`
  );
}
if (cardAudit.overflow.length > 0) {
  errors.push(
    `[gate] fixed-height launcher card rows wrap: ${JSON.stringify(cardAudit.overflow)}`
  );
}
if (cardAudit.overlap.length > 0) {
  errors.push(
    `[gate] launcher card rows overlap: ${JSON.stringify(cardAudit.overlap)}`
  );
}
if (!cardAudit.opus) {
  errors.push('[gate] could not find an Opus card model label');
} else if (
  cardAudit.opus.text !== 'Opus 5' ||
  cardAudit.opus.scroll > cardAudit.opus.client + 1
) {
  errors.push(
    `[gate] Opus model label is clipped: ${JSON.stringify(cardAudit.opus)}`
  );
}
if (
  cardAudit.provenance.length === 0 &&
  cardAudit.overflow.length === 0 &&
  cardAudit.overlap.length === 0 &&
  cardAudit.opus &&
  cardAudit.opus.scroll <= cardAudit.opus.client + 1
) {
  console.log(
    '[launcher-bench] gate ok: cards are concise and text rows do not collide'
  );
}

// Gate: Down is the spatial handoff from the selected tile into the drawer.
// Exercise it in a real browser because delayed drawer mounting and focus are
// exactly the kind of interaction a DOM-only unit test can accidentally mask.
const trained = page.locator('[data-bench-case="trained"]');
const selectedTile = trained
  .locator('[data-setup-chip][data-selected]')
  .first();
await selectedTile.focus();
const scrollBeforeDown = await page.evaluate(() => window.scrollY);
await selectedTile.press('ArrowDown');
const firstAxis = trained
  .locator('[data-setup-detail] [data-option-menu-trigger]:not(:disabled)')
  .first();
try {
  await firstAxis.waitFor({ state: 'visible', timeout: 2_000 });
  const keyboardState = await page.evaluate(() => {
    const scope = document.querySelector('[data-bench-case="trained"]');
    const panel = scope?.querySelector('[data-setup-detail]');
    const active = document.activeElement;
    return {
      drawerOpen: panel?.getAttribute('aria-hidden') === 'false',
      focusedAxis: Boolean(active?.matches('[data-option-menu-trigger]')),
      scrollY: window.scrollY,
    };
  });
  if (!keyboardState.drawerOpen || !keyboardState.focusedAxis) {
    errors.push(
      `[gate] ArrowDown did not enter the drawer: ${JSON.stringify(keyboardState)}`
    );
  }
  if (Math.abs(keyboardState.scrollY - scrollBeforeDown) > 1) {
    errors.push(
      `[gate] ArrowDown scrolled the page by ${keyboardState.scrollY - scrollBeforeDown}px`
    );
  }
  if (
    keyboardState.drawerOpen &&
    keyboardState.focusedAxis &&
    Math.abs(keyboardState.scrollY - scrollBeforeDown) <= 1
  ) {
    console.log(
      '[launcher-bench] gate ok: ArrowDown enters the drawer without scrolling'
    );
  }
} catch {
  errors.push('[gate] ArrowDown never revealed a focusable drawer axis');
}

// ── BUG-003 gate: every option menu must fit the window it opens in.
// A SHORT window is the reproduction — the trigger sits low, so a constant
// max-height cannot fit below it and Radix flips the menu upward until its
// first options sit ABOVE the top edge, where nothing can scroll them back.
// Measured at listTop -16px before the fix.
try {
  const shortPage = await browser.newPage({
    viewport: { width: 1280, height: 560 },
  });
  await primeEvalBrowserPage(shortPage);
  await shortPage.goto(`${BASE}/hud-gallery/agent-launcher`, {
    waitUntil: 'networkidle',
  });
  await shortPage.waitForTimeout(700);
  const triggers = await shortPage.$$('button[aria-expanded]');
  const menus = [];
  for (const trigger of triggers) {
    try {
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click({ timeout: 2000 });
      await shortPage.waitForTimeout(300);
      const measured = await shortPage.evaluate(() => {
        const list = document.querySelector('[role="listbox"]');
        if (!list) return null;
        const box = list.getBoundingClientRect();
        return {
          top: Math.round(box.top),
          bottom: Math.round(box.bottom),
          viewport: window.innerHeight,
          options: list.querySelectorAll('[role="option"]').length,
          scrollable: list.scrollHeight > list.clientHeight + 1,
        };
      });
      if (measured) menus.push(measured);
      await shortPage.keyboard.press('Escape');
      await shortPage.waitForTimeout(120);
    } catch {
      // a trigger that does not open a listbox is not this gate's business
    }
  }
  if (menus.length === 0) {
    errors.push('[gate] no option menu opened, so the fit gate proved nothing');
  }
  for (const menu of menus) {
    if (menu.top < 0 || menu.bottom > menu.viewport) {
      errors.push(
        `[gate] an option menu (${menu.options} options) rendered outside the window: ${JSON.stringify(menu)}`
      );
    }
  }
  const outside = menus.filter(
    menu => menu.top < 0 || menu.bottom > menu.viewport
  ).length;
  if (menus.length > 0 && outside === 0) {
    console.log(
      `[launcher-bench] gate ok: ${menus.length} option menus fit a 560px-tall window`
    );
  }
  await shortPage.close();
} catch (error) {
  errors.push(`[gate] option-menu fit check failed: ${String(error)}`);
}

await browser.close();

if (errors.length > 0) {
  console.error('[launcher-bench] page errors:');
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`[launcher-bench] screenshots in ${OUT}`);
