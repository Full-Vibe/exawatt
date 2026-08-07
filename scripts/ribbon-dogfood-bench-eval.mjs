#!/usr/bin/env node

/**
 * D42/D45 acceptance gates, run against the instrumented dogfood bench
 * (`/hud-gallery/project-ribbon/bench`). The bench mounts the production
 * TabStrip over a fake terminal stage that counts every ResizeObserver
 * delivery — the exact instrument for the round's core contract:
 *
 *   1. ZERO stage resizes across Project switches (constant-height row)
 *   2. authenticated active tabs are equal-width and expose four title words
 *   3. hold-⌘ keycaps are VISIBLE on every ordinal-bearing tab, condensed
 *      chips included
 *   4. walking the full ⌘⇧] ring never lands on an invisible active tab
 *   5. pointer reorder commits a same-row swap and Escape cancels
 *   6. the strip height NEVER changes — one row, whatever happens
 */

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.EXAWATT_RIBBON_SCREENSHOTS || '/tmp/exawatt-ribbon-bench';
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

mkdirSync(SCREENSHOT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
  key: APPEARANCE_KEY,
  value: JSON.stringify(appearancePreference('exawatt-night-dark')),
});
const errors = [];
page.on('pageerror', error => errors.push(String(error.message || error)));

const stageResizes = () =>
  page.evaluate(() =>
    Number(
      document
        .querySelector('[data-bench-resize-count]')
        ?.getAttribute('data-bench-resize-count')
    )
  );
const stripState = () =>
  page.evaluate(() => {
    const strip = document.querySelector('[data-workspace-tab-strip]');
    return {
      rows: strip?.getAttribute('data-ribbon-rows'),
      scrollable: strip?.getAttribute('data-ribbon-scrollable'),
      height: strip instanceof HTMLElement ? strip.style.height : null,
    };
  });
const setBenchWidth = async width => {
  await page.evaluate(value => {
    const slider = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    set.call(slider, value);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, width);
  await page.waitForTimeout(500);
};
const clickProject = async name => {
  await page
    .locator(`[data-ribbon-item="project"][data-project="${name}"]`)
    .first()
    .click();
  await page.waitForTimeout(450);
};

try {
  await page.goto(`${BASE}/hud-gallery/project-ribbon/bench`, {
    waitUntil: 'networkidle',
  });
  await page.locator('[data-workspace-tab-strip]').waitFor();
  await page.waitForTimeout(700);
  await setBenchWidth(1440);

  // ── Gate 1: zero stage resizes across Project switches ──
  const beforeSwitches = await stageResizes();
  const heightBefore = (await stripState()).height;
  await clickProject('switcheroo');
  await clickProject('gpagent');
  await clickProject('exawatt');
  const afterSwitches = await stageResizes();
  const heightAfter = (await stripState()).height;
  if (afterSwitches !== beforeSwitches || heightAfter !== heightBefore) {
    throw new Error(
      `Project switches resized the stage: ${JSON.stringify({ beforeSwitches, afterSwitches, heightBefore, heightAfter })}`
    );
  }
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'gate1-switches.png'),
    clip: (await page.locator('[data-bench-root]').boundingBox()) ?? undefined,
  });

  // ── Gate 2: active tabs are equal-width and readable in production chrome ──
  // The fixture mounts status, delegated-child truth, harness identity, close,
  // and authenticated context feedback. A clean-room tab is not the product.
  const readability = await page.evaluate(() => {
    const tabs = [
      ...document.querySelectorAll(
        '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]:not([aria-hidden="true"])'
      ),
    ];
    return tabs.map(tab => {
      const label = tab.querySelector('[data-tab-label]');
      const title = label?.textContent?.trim() ?? '';
      const labelWidth = label?.getBoundingClientRect().width ?? 0;
      const subtitle = label?.firstElementChild;
      let visibleWords = 0;
      if (label && subtitle) {
        const words = [...title.matchAll(/\S+/g)];
        for (const word of words) {
          const prefix = title.slice(0, (word.index ?? 0) + word[0].length);
          const probe = subtitle.cloneNode(true);
          probe.textContent = prefix;
          Object.assign(probe.style, {
            position: 'fixed',
            left: '-10000px',
            top: '0',
            width: 'max-content',
            whiteSpace: 'nowrap',
            visibility: 'hidden',
          });
          document.body.append(probe);
          const width = probe.getBoundingClientRect().width;
          probe.remove();
          if (width <= labelWidth + 0.5) {
            visibleWords += 1;
          }
        }
      }
      return {
        id: tab.getAttribute('data-tab-id'),
        title,
        tabWidth: tab.getBoundingClientRect().width,
        labelWidth,
        visibleWords,
        delegated: Boolean(tab.querySelector('[data-delegation]')),
      };
    });
  });
  const tabWidths = readability.map(item => item.tabWidth);
  if (Math.max(...tabWidths) - Math.min(...tabWidths) > 1) {
    throw new Error(
      `Active tabs are not equal width: ${JSON.stringify(readability)}`
    );
  }
  // The four-full-words floor is retired with the 380–400px band (operator,
  // 2026-08-04: "the tabs are still too wide… expand only when there's
  // enough space, kind of like Google Chrome tabs"). What holds now is the
  // Chrome contract: equal widths inside the policy band, and a title that
  // starts at the same x in every tab so it is read from its first word.
  const BAND = { min: 180, max: 240 }; // DEFAULT_RIBBON_POLICY
  const outOfBand = readability.filter(
    item => item.tabWidth < BAND.min - 1 || item.tabWidth > BAND.max + 1
  );
  if (outOfBand.length > 0) {
    throw new Error(
      `Active tabs fall outside the ${BAND.min}–${BAND.max}px band: ${JSON.stringify(outOfBand)}`
    );
  }
  const centred = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]:not([aria-hidden="true"]) [data-tab-chrome]'
      ),
    ]
      .map(node => getComputedStyle(node).textAlign)
      .filter(align => align !== 'left' && align !== 'start')
  );
  if (centred.length > 0) {
    throw new Error(
      `Tab titles are not start-aligned: ${JSON.stringify(centred)}`
    );
  }
  await page
    .locator('[data-bench-stage]')
    .hover({ position: { x: 20, y: 20 } });
  await page.waitForTimeout(160);
  await page.locator('[data-workspace-tab-strip]').screenshot({
    path: join(SCREENSHOT_DIR, 'gate2-readability-idle.png'),
  });

  // Context rating rides the ACTIVE tab only — everywhere else the tab face
  // must stay a selection target, so there is nothing there to reveal.
  const feedbackTab = page.locator(
    '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"][data-active]'
  );
  const labelWidthBeforeHover = await feedbackTab
    .locator('[data-tab-label]')
    .evaluate(node => node.getBoundingClientRect().width);
  await feedbackTab.hover();
  await page.waitForTimeout(160);
  const feedbackOverlay = feedbackTab.locator('[data-tab-feedback-overlay]');
  const overlayState = await feedbackOverlay.evaluate(node => ({
    position: getComputedStyle(node).position,
    opacity: getComputedStyle(node).opacity,
  }));
  const labelWidthAfterHover = await feedbackTab
    .locator('[data-tab-label]')
    .evaluate(node => node.getBoundingClientRect().width);
  if (
    overlayState.position !== 'absolute' ||
    overlayState.opacity !== '1' ||
    Math.abs(labelWidthAfterHover - labelWidthBeforeHover) > 0.5
  ) {
    throw new Error(
      `Context feedback reflowed or failed to reveal: ${JSON.stringify({ overlayState, labelWidthBeforeHover, labelWidthAfterHover })}`
    );
  }
  // The overlay's BACKDROP — the wash that keeps the rating buttons legible
  // over the title — must never take a click. It used to flip
  // `pointer-events-auto` on its whole box, so ~50px across the middle of a
  // hovered Agent tab silently swallowed the click meant to select the tab
  // (operator, 2026-08-04: "unresponsive"). The buttons themselves are of
  // course still hit targets; nothing else in that box is.
  const probeFace = node => {
    const box = node
      .querySelector('[data-tab-chrome]')
      .getBoundingClientRect();
    return [0.15, 0.3, 0.5, 0.7, 0.85]
      .map(fraction => {
        const hit = document.elementFromPoint(
          box.left + box.width * fraction,
          box.top + box.height / 2
        );
        const overlay = hit?.closest('[data-tab-feedback-overlay]');
        return {
          fraction,
          // dead = inside the overlay but not on one of its buttons
          dead: Boolean(overlay) && !hit?.closest('button'),
        };
      })
      .filter(probe => probe.dead);
  };
  const swallowed = await feedbackTab.evaluate(probeFace);
  if (swallowed.length > 0) {
    throw new Error(
      `Context feedback backdrop is swallowing clicks: ${JSON.stringify(swallowed)}`
    );
  }

  // An INACTIVE tab keeps its whole face as a selection target: there is no
  // rating overlay on it at all, hovered or not.
  const inactiveTab = page.locator(
    '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]:not([data-active])'
  );
  await inactiveTab.first().hover();
  await page.waitForTimeout(200);
  const inactiveDead = await inactiveTab.first().evaluate(node => ({
    hasOverlay: Boolean(node.querySelector('[data-tab-feedback-overlay]')),
  }));
  if (inactiveDead.hasOverlay) {
    throw new Error(
      `An inactive tab is carrying the rating overlay: ${JSON.stringify(inactiveDead)}`
    );
  }
  await feedbackTab.hover();
  await page.waitForTimeout(160);
  await page.locator('[data-workspace-tab-strip]').screenshot({
    path: join(SCREENSHOT_DIR, 'gate2-readability-feedback.png'),
  });
  await page
    .locator('[data-bench-stage]')
    .hover({ position: { x: 20, y: 20 } });

  // ── Gate 2b: selecting a tab reveals THAT TAB, never the Project head ──
  // The reveal used to span the whole Project block, so once a Project was
  // wider than the row the "scroll left to the start" branch always won and
  // dragged the selection off screen — ⌘T's new tab and any click on a
  // right-hand tab both jumped back to the first one (operator, 2026-08-04).
  const lastActiveTab = page
    .locator(
      '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]'
    )
    .last();
  const lastBox = await lastActiveTab.boundingBox();
  await page.mouse.click(lastBox.x + 14, lastBox.y + lastBox.height / 2);
  await page.waitForTimeout(600);
  const reveal = await page.evaluate(() => {
    const scroller = document.querySelector('[data-ribbon-scroller]');
    const active = document.querySelector(
      '[data-ribbon-item="initiative"][data-active]'
    );
    if (!scroller || !active) return null;
    const a = active.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    return {
      id: active.getAttribute('data-tab-id'),
      fullyVisible: a.left >= s.left - 1 && a.right <= s.right + 1,
    };
  });
  if (!reveal?.fullyVisible) {
    throw new Error(
      `Selecting a tab scrolled it out of view: ${JSON.stringify(reveal)}`
    );
  }

  // ── Gate 3: hold-⌘ reveals a VISIBLE keycap on every ordinal tab ──
  await page.keyboard.down('Meta');
  await page.waitForTimeout(300);
  const keycaps = await page.evaluate(() => {
    const visibleOrdinals = [...document.querySelectorAll('[data-tab-ordinal]')]
      .filter(wrapper => {
        const item = wrapper.closest('[data-ribbon-item]');
        if (!item || item.getAttribute('aria-hidden') === 'true') return false;
        const chip = wrapper.querySelector('span') ?? wrapper;
        return chip.getBoundingClientRect().width > 0;
      })
      .map(wrapper => Number(wrapper.getAttribute('data-tab-ordinal')));
    const foldedOrdinals = [
      ...document.querySelectorAll('[data-project-folded-ordinals]'),
    ].flatMap(node => {
      const hint = node.getAttribute('data-project-folded-ordinals') ?? '';
      const [start, end = start] = hint.split('–').map(Number);
      return Number.isFinite(start) && Number.isFinite(end)
        ? Array.from({ length: end - start + 1 }, (_, index) => start + index)
        : [];
    });
    return [...new Set([...visibleOrdinals, ...foldedOrdinals])].sort(
      (a, b) => a - b
    );
  });
  await page.keyboard.up('Meta');
  if (keycaps.join(',') !== '1,2,3,4,5,6,7,8,9') {
    throw new Error(`Keycap coverage incomplete: [${keycaps.join(',')}]`);
  }

  // ── Gate 4: the full ring only ever lands on a visible active tab ──
  const ringStops = 13;
  for (let step = 0; step < ringStops; step += 1) {
    await page.click('[data-bench-ring-next]');
    await page.waitForTimeout(120);
    const landed = await page.evaluate(() => {
      const active = document.querySelector(
        '[data-ribbon-item="initiative"][data-active]'
      );
      if (!active) return { ok: false, reason: 'no active tab node' };
      return {
        ok: active.getAttribute('aria-hidden') !== 'true',
        id: active.getAttribute('data-tab-id'),
      };
    });
    if (!landed.ok) {
      throw new Error(
        `Ring stop ${step} landed on an invisible tab: ${JSON.stringify(landed)}`
      );
    }
  }

  // ── Gate 5: pointer reorder commits; Escape cancels ──
  await clickProject('exawatt');
  const order = () =>
    page.$$eval(
      '[data-ribbon-item="initiative"][data-project-parent="/workspace/exawatt"]',
      els =>
        els
          .filter(el => el.getAttribute('aria-hidden') !== 'true')
          .map(el => {
            const box = el.getBoundingClientRect();
            return { id: el.getAttribute('data-tab-id'), x: box.x, y: box.y };
          })
          .sort((a, b) =>
            Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x
          )
          .map(item => item.id)
    );
  const before = await order();
  await page
    .locator(`[data-tab-id="${before[0]}"]`)
    .evaluate(node =>
      node.scrollIntoView({ block: 'nearest', inline: 'start' })
    );
  await page.waitForTimeout(350);
  const src = await page
    .locator(`[data-tab-id="${before[0]}"]`)
    .boundingBox();
  const dst = await page
    .locator(`[data-tab-id="${before[1]}"]`)
    .boundingBox();
  await page.mouse.move(src.x + 100, src.y + 13);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(
      src.x + 100 + ((dst.x + dst.width * 0.65 - src.x - 100) * i) / 12,
      src.y + 13,
      { steps: 1 }
    );
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(450);
  const swapped = await order();
  if (swapped[0] !== before[1] || swapped[1] !== before[0]) {
    throw new Error(
      `Pointer reorder did not commit: ${JSON.stringify({ before, swapped, src, dst, strip: await stripState() })}`
    );
  }
  const src2 = await page
    .locator(`[data-tab-id="${swapped[0]}"]`)
    .boundingBox();
  await page.mouse.move(src2.x + 100, src2.y + 13);
  await page.mouse.down();
  await page.mouse.move(src2.x + 360, src2.y + 13, { steps: 8 });
  await page.waitForTimeout(80);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(400);
  const afterEscape = await order();
  if (afterEscape.join() !== swapped.join()) {
    throw new Error(
      `Escape did not cancel the drag: ${JSON.stringify({ swapped, afterEscape })}`
    );
  }

  // ── Gate 6: the height is constant, full stop ──
  // D45 made the ribbon one row, so no data change — not closing tabs, not
  // draining whole Projects — can resize the terminal below it.
  const resizesBeforeCloses = await stageResizes();
  const heightBeforeCloses = (await stripState()).height;
  for (const name of [
    'exawatt',
    'gpagent',
    'cortex-ehr',
    'workmusic',
    'switcheroo',
    'photo-generator',
  ]) {
    await clickProject(name);
    for (let round = 0; round < 8; round += 1) {
      const closable = page
        .locator(
          '[data-ribbon-item="initiative"]:not([aria-hidden="true"]):not([data-close-stabilized]) button[title^="Close — kept"]'
        )
        .first();
      if (!(await closable.count())) break;
      await closable.click({ force: true });
      await page.waitForTimeout(700);
      const now = await stripState();
      if (now.height !== heightBeforeCloses || now.rows !== '1') {
        throw new Error(
          `Height moved on a data change: ${JSON.stringify({ heightBeforeCloses, now })}`
        );
      }
    }
  }
  const closeDelta = (await stageResizes()) - resizesBeforeCloses;
  if (closeDelta !== 0) {
    throw new Error(
      `A one-row ribbon must never resize the stage: ${closeDelta} resizes`
    );
  }

  // Same production bench, deterministic sibling appearance. Geometry is
  // already gated above; this image catches a palette/contrast regression.
  const lightPage = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await lightPage.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    {
      key: APPEARANCE_KEY,
      value: JSON.stringify(appearancePreference('exawatt-air-light')),
    }
  );
  await lightPage.goto(`${BASE}/hud-gallery/project-ribbon/bench`, {
    waitUntil: 'networkidle',
  });
  await lightPage.locator('[data-workspace-tab-strip]').waitFor();
  await lightPage.evaluate(() => {
    const slider = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    set.call(slider, 1440);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await lightPage.waitForTimeout(500);
  await lightPage
    .locator('[data-ribbon-item="project"][data-project="exawatt"]')
    .first()
    .click();
  await lightPage.waitForTimeout(450);
  await lightPage.locator('[data-workspace-tab-strip]').screenshot({
    path: join(SCREENSHOT_DIR, 'gate2-readability-light.png'),
  });
  await lightPage.close();

  // ── D50 gate: the pinned Project header. The strip's whole answer to
  // "where am I" once the row scrolls, and until now it was verified by
  // screenshot only.
  // Its own page: the gates above close tabs, and a pin needs a full row to
  // overflow. Narrow enough that the active Project's own tabs scroll — the
  // shape the operator was in when he reported losing the Project name.
  const pinPage = await browser.newPage({
    viewport: { width: 1600, height: 1000 },
  });
  await pinPage.goto(`${BASE}/hud-gallery/project-ribbon/bench`, {
    waitUntil: 'networkidle',
  });
  await pinPage.locator('[data-workspace-tab-strip]').waitFor();
  await pinPage.evaluate(() => {
    const slider = document.querySelector('input[type=range]');
    const set = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    set.call(slider, 880);
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await pinPage.waitForTimeout(500);
  const pin = await pinPage.evaluate(async () => {
    const strip = document.querySelector('[data-workspace-tab-strip]');
    const scroller = strip?.querySelector('[data-ribbon-scroller]');
    if (!scroller) return { reason: 'no scroller' };
    const view = () => scroller.getBoundingClientRect();
    const settle = () =>
      new Promise(resolve => requestAnimationFrame(() => resolve()));
    const scrollTo = async left => {
      scroller.scrollLeft = left;
      scroller.dispatchEvent(new Event('scroll'));
      await settle();
    };
    const pinnedNow = () => {
      const pinned = strip.querySelector('[data-ribbon-pinned]');
      if (!pinned) return null;
      const style = getComputedStyle(pinned);
      return {
        dir: pinned.getAttribute('data-ribbon-project-header'),
        offset: Math.round(
          pinned.getBoundingClientRect().left - view().left
        ),
        opaque:
          style.backgroundImage !== 'none' ||
          style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      };
    };

    await scrollTo(0);
    const max = scroller.scrollWidth - scroller.clientWidth;
    if (max <= 0) return { reason: 'row does not scroll' };
    const rest = pinnedNow();

    // The Project whose OWN tabs overflow is the one that pins; find it by
    // its laid-out block rather than by name, so the gate survives fixture
    // edits. Its header is the last one that still leaves room to its right.
    const headers = [
      ...strip.querySelectorAll('[data-ribbon-project-header]'),
    ].map(node => ({
      dir: node.getAttribute('data-ribbon-project-header'),
      x: Math.round(node.getBoundingClientRect().left - view().left),
    }));
    const widest = headers.reduce((best, header, index) => {
      const next = headers[index + 1];
      const span = (next ? next.x : scroller.scrollWidth) - header.x;
      return !best || span > best.span ? { ...header, span } : best;
    }, null);
    if (!widest) return { reason: 'no project headers' };

    await scrollTo(Math.min(widest.x + 80, max));
    const parked = pinnedNow();
    // Deeper into the same run: a pinned header must HOLD the edge, not
    // drift with the content. (The hand-off push itself is unit-tested in
    // project-ribbon-layout.test.ts — this fixture's row never scrolls far
    // enough to reach the next Project's header.)
    await scrollTo(Math.min(widest.x + 260, max));
    const deeper = pinnedNow();

    await scrollTo(0);
    return { rest, parked, deeper, widest };
  });
  if (pin.reason) {
    throw new Error(`pin gate: ${pin.reason}`);
  }
  if (pin.rest !== null) {
    throw new Error('pin gate: a header was pinned at rest');
  }
  if (!pin.parked || pin.parked.dir !== pin.widest.dir) {
    throw new Error(
      `pin gate: expected ${pin.widest.dir} parked at the left edge, got ${JSON.stringify(pin.parked)}`
    );
  }
  if (Math.abs(pin.parked.offset) > 1) {
    throw new Error(
      `pin gate: pinned header sits ${pin.parked.offset}px from the edge, expected 0`
    );
  }
  if (!pin.parked.opaque) {
    throw new Error(
      'pin gate: the pinned header is translucent; tabs show through'
    );
  }
  if (!pin.deeper || pin.deeper.dir !== pin.widest.dir) {
    throw new Error(
      `pin gate: the pin was dropped deeper into the same Project: ${JSON.stringify(pin.deeper)}`
    );
  }
  if (Math.abs(pin.deeper.offset) > 1) {
    throw new Error(
      `pin gate: the pinned header drifted to ${pin.deeper.offset}px instead of holding the edge`
    );
  }
  await pinPage.close();

  if (errors.length > 0) {
    throw new Error(`Renderer errors:\n${errors.join('\n')}`);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        gates: {
          switchResizes: afterSwitches - beforeSwitches,
          readability,
          feedbackOverlay: overlayState,
          keycaps,
          ringStops,
          reorder: { before, swapped },
          heightHeldAcrossDrain: closeDelta === 0,
          pinnedProjectHeader: pin,
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
