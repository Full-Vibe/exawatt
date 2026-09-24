#!/usr/bin/env node
/** BUG-143: one viewport owner, independent of entry URL and responsive mode. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const browser = await chromium.launch({
  ...(await resolveQaBrowserLaunchOptions(chromium)),
  headless: true,
});
const page = await browser.newPage({ reducedMotion: 'reduce' });
await primeEvalBrowserPage(page);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (
    message.type() === 'error' &&
    /WebGL|shader|GL_INVALID|context lost/i.test(message.text())
  ) {
    errors.push(message.text());
  }
});

async function checkViewport(label) {
  await page.locator('[data-spatial-command]').evaluate(element => {
    element.scrollTop = 0;
  });
  await page.waitForFunction(() => {
    const board = document.querySelector('[aria-label="Fleet surface"]');
    const canvas = board?.querySelector('canvas');
    if (!board || !canvas || !canvas.width || !canvas.height) return false;
    const surface = board.getBoundingClientRect();
    const rendered = canvas.getBoundingClientRect();
    return (
      Math.abs(rendered.height - surface.height) < 1 &&
      Math.abs(rendered.width - surface.width) < 1
    );
  });
  const geometry = await page.evaluate(() => {
    const rect = selector =>
      document.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      header: rect('#site-header'),
      slot: rect('[data-spatial-viewport]'),
      toolbar: rect('[data-spatial-command] > header'),
      surface: rect('[aria-label="Fleet surface"]'),
      panel: document.querySelector('[data-spatial-selection-panel]')
        ? rect('[data-spatial-selection-panel]')
        : null,
      contentBottom:
        document.querySelector('[data-spatial-command]').getBoundingClientRect()
          .top + document.querySelector('[data-spatial-command]').scrollHeight,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
    };
  });
  const near = (actual, expected, invariant) =>
    assert.ok(
      Math.abs(actual - expected) < 1,
      `${label}: ${invariant}: ${actual} vs ${expected}`
    );
  near(geometry.slot.top, geometry.header.bottom, 'slot follows navigation');
  near(geometry.slot.bottom, geometry.viewport.height, 'slot fills viewport');
  near(
    geometry.surface.top,
    geometry.toolbar.bottom,
    'board follows wrapping toolbar'
  );
  near(
    geometry.pageHeight,
    geometry.viewport.height,
    'no second page scroll owner'
  );
  near(geometry.pageWidth, geometry.viewport.width, 'no horizontal overflow');
  if (geometry.panel) {
    near(
      geometry.panel.bottom,
      geometry.contentBottom,
      'inspector fills its slot'
    );
    if (Math.abs(geometry.panel.top - geometry.surface.top) < 1) {
      near(
        geometry.surface.bottom,
        geometry.contentBottom,
        'side-by-side board fills slot'
      );
      near(
        geometry.surface.right,
        geometry.panel.left,
        'side-by-side surfaces share an edge'
      );
    } else {
      near(
        geometry.surface.bottom,
        geometry.panel.top,
        'stacked surfaces share an edge'
      );
    }
    const action = page.locator('[data-spatial-selection-panel] button').last();
    if (await action.count()) {
      await action.scrollIntoViewIfNeeded();
      const visible = await action.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const owner = element
          .closest('[data-spatial-selection-panel]')
          .getBoundingClientRect();
        const header = document
          .querySelector('#site-header')
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        return (
          bounds.top >= Math.max(owner.top, header.bottom) &&
          bounds.bottom <= Math.min(owner.bottom, innerHeight) &&
          element.contains(hit)
        );
      });
      assert.ok(visible, `${label}: inspector action is unreachable`);
    }
  } else {
    near(
      geometry.surface.bottom,
      geometry.contentBottom,
      'unselected board fills slot'
    );
  }
  // Short windows may intentionally scroll the route itself to preserve usable
  // controls. Check reachability through that owner rather than assuming every
  // control can fit simultaneously into a physically smaller viewport.
  for (const control of [
    page.locator('[data-spatial-command] > header button').first(),
    page.getByRole('button', { name: 'Top', exact: true }),
  ]) {
    await control.scrollIntoViewIfNeeded();
    assert.ok(
      await control.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const header = document
          .querySelector('#site-header')
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height / 2
        );
        return (
          bounds.top >= header.bottom &&
          bounds.bottom <= innerHeight &&
          element.contains(hit)
        );
      }),
      `${label}: route control is unreachable: ${await control.evaluate(element => ({ text: element.textContent, bounds: element.getBoundingClientRect().toJSON(), hit: document.elementFromPoint(element.getBoundingClientRect().x + element.getBoundingClientRect().width / 2, element.getBoundingClientRect().y + element.getBoundingClientRect().height / 2)?.outerHTML.slice(0, 180) })).then(JSON.stringify)}`
    );
  }
  assert.ok(
    geometry.surface.height > 0 && geometry.surface.width > 0,
    `${label}: board collapsed`
  );
  console.log(`PASS ${label}`);
}

try {
  // Public Demo fixture IDs are discovered through the production controls;
  // the test is invariant to a legitimate demo population/name change.
  await page.setViewportSize({ width: 1312, height: 821 });
  await page.goto(`${base}/fleet/spatial`, { waitUntil: 'load' });
  await page.locator('[data-spatial-board]').waitFor();
  await checkViewport('direct Fleet');
  await page.locator('button[aria-label^="Open Project "]').first().click();
  await page.waitForURL(/altitude=project/);
  const projectUrl = page.url();
  await page.locator('button[data-board-agent]').first().click();
  await page.waitForURL(url => url.searchParams.has('agent'));
  const agentUrl = new URL(page.url());
  agentUrl.searchParams.set('altitude', 'agent');
  const routes = [
    ['Fleet', `${base}/fleet/spatial`],
    ['Project', projectUrl],
    ['Agent', agentUrl.href],
    [
      'unknown Agent',
      `${base}/fleet/spatial?altitude=agent&project=missing&agent=missing`,
    ],
  ];
  for (const [name, url] of routes) {
    // A narrow first load catches the original bug, independently of resize.
    await page.setViewportSize({ width: 1100, height: 821 });
    await page.goto(url, { waitUntil: 'load' });
    await page.locator('[data-spatial-board]').waitFor();
    await checkViewport(`direct ${name}, narrow`);
    for (const viewport of [
      { width: 1312, height: 821 },
      { width: 390, height: 844 },
      { width: 800, height: 480 },
      { width: 390, height: 320 },
      { width: 320, height: 320 },
      { width: 1100, height: 1000 },
    ]) {
      await page.setViewportSize(viewport);
      await checkViewport(
        `${name}, resize ${viewport.width}×${viewport.height}`
      );
    }
  }
  assert.deepEqual(errors, [], 'renderer or WebGL errors');
} finally {
  await browser.close();
}
