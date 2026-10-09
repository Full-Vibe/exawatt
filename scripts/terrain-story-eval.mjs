#!/usr/bin/env node
/** Real wheel/touch input: setting scrollTop bypasses the controller bug this guards. */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';
const base = process.env.EXA_BASE || 'http://localhost:7000';
const output = '.artifacts/terrain-story';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  ...(await resolveQaBrowserLaunchOptions(chromium)),
  headless: true,
});
const errors = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1512, height: 982 },
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (
      m.type() === 'error' &&
      /shader|GL_INVALID|THREE.WebGLProgram/.test(m.text())
    )
      errors.push(m.text());
  });
  await page.goto(`${base}/hud-gallery/terrain-story`, {
    waitUntil: 'load',
  });
  await page.locator('[data-ready="true"]').waitFor();
  const scroller = page.locator('[aria-label="Homepage scroll preview"]');
  const canvas = await page.locator('canvas').elementHandle();
  const canvasBounds = await page.locator('canvas').boundingBox();
  const height = await scroller.evaluate(el => el.clientHeight);
  const initialCount = await page.locator('[data-agent]').count();
  const firstAgent = page.locator('[data-agent="0"]');
  const firstBox = await firstAgent.boundingBox();
  await page.mouse.move(
    firstBox.x + firstBox.width / 2,
    firstBox.y + firstBox.height / 2
  );
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  assert.equal(
    await page.locator('[data-agent] small').count(),
    0,
    'hover must not reveal an agent card'
  );
  await firstAgent.focus();
  assert.equal(
    await page.locator('[data-agent] small').count(),
    0,
    'focus alone must not select'
  );
  await page.keyboard.press('Enter');
  assert.equal(await firstAgent.getAttribute('aria-pressed'), 'true');
  assert.equal(
    await firstAgent.locator('small').count(),
    1,
    'selection reveals the card'
  );
  // Start over empty world (the old controller cancelled this exact wheel).
  await page.mouse.move(1400, 650);
  for (const direction of [1, -1]) {
    const before = await scroller.evaluate(el => el.scrollTop);
    await page.mouse.wheel(0, direction * height);
    await page.waitForFunction(
      ({ before, direction }) => {
        const root = document.querySelector(
          '[aria-label="Homepage scroll preview"]'
        );
        return direction * (root.scrollTop - before) > 100;
      },
      { before, direction }
    );
  }
  await scroller.focus();
  await page.keyboard.press('PageDown');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Homepage scroll preview"]')
        .scrollTop > 100
  );
  await page.keyboard.press('Home');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Homepage scroll preview"]')
        .scrollTop < 1
  );
  // Every chapter is reached with browser input and shares the reading column.
  let column;
  for (let i = 0; i < 6; i++) {
    if (i) await page.mouse.wheel(0, height);
    await page.waitForFunction(i => {
      const el = document.querySelector(`[data-copy="${i}"]`);
      return el && Number(getComputedStyle(el).opacity) > 0.95;
    }, i);
    const box = await page.locator(`[data-copy="${i}"]`).boundingBox();
    column ??= box.x;
    assert(
      Math.abs(box.x - column) < 1,
      'story copy must keep its reading column'
    );
    assert.deepEqual(await page.locator('canvas').boundingBox(), canvasBounds);
    assert(await canvas.evaluate(el => el.isConnected));
    if (i === 4)
      assert(
        (await page.locator('[data-agent]').count()) > initialCount,
        'the fleet must expand during the story'
      );
    if (i === 0 || i === 2 || i === 4)
      await page.screenshot({ path: `${output}/story-${i}.png` });
  }
  // Reverse through the expansion beat: surviving agents keep their identities.
  await page.mouse.wheel(0, -height * 2);
  await page.waitForFunction(
    n => document.querySelectorAll('[data-agent]').length === n,
    initialCount
  );
  assert(await canvas.evaluate(el => el.isConnected));
  await page.getByRole('button', { name: 'Visual lab', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Fleet visual laboratory"]')
        .scrollTop === 0
  );
  // An inactive selection must not park the rest of the working fleet.
  await page.locator('[data-agent="4"]').focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Add one demo agent', exact: true })
    .click();
  assert.equal(
    await page.locator('[data-agent="4"]').getAttribute('aria-pressed'),
    'true',
    'expansion must not select a different agent'
  );
  const anchor = page.locator('[data-agent="0"]');
  const original = await anchor.getAttribute('style');
  await page.waitForFunction(
    original =>
      document.querySelector('[data-agent="0"]').getAttribute('style') !==
      original,
    original
  );
  await page.screenshot({ path: `${output}/living-fleet.png` });
  // Wheel over a real DOM agent target must also scroll the lab's accessible list.
  const hit = await anchor.boundingBox();
  await page.mouse.move(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Fleet visual laboratory"]')
        .scrollTop > 100
  );
  await page.close();
  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  mobile.on('pageerror', e => errors.push(e.message));
  await mobile.goto(`${base}/hud-gallery/terrain-story`, {
    waitUntil: 'load',
  });
  await mobile.locator('[data-ready="true"]').waitFor();
  const cdp = await mobile.context().newCDPSession(mobile);
  const touch = async (from, to) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 320, y: from }],
    });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: 320, y: from + ((to - from) * i) / 8 }],
      });
      await mobile.evaluate(
        () => new Promise(resolve => requestAnimationFrame(resolve))
      );
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  };
  const mobileRoot = mobile.locator('[aria-label="Homepage scroll preview"]');
  await touch(670, 290);
  await mobile.waitForFunction(
    () =>
      document.querySelector('[aria-label="Homepage scroll preview"]')
        .scrollTop > 100
  );
  const after = await mobileRoot.evaluate(el => el.scrollTop);
  await touch(290, 670);
  await mobile.waitForFunction(
    after =>
      document.querySelector('[aria-label="Homepage scroll preview"]')
        .scrollTop < after,
    after
  );
  await mobile.screenshot({ path: `${output}/mobile.png` });
  assert(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  );
  await mobile.emulateMedia({ reducedMotion: 'reduce' });
  await mobile.getByRole('button', { name: 'Visual lab', exact: true }).click();
  await mobile.getByRole('button', { name: '1', exact: true }).click();
  // The reduced-motion path still renders and remains usable.
  assert.equal(await mobile.locator('canvas').count(), 1);
  assert.deepEqual(errors, []);
  console.log(
    '[terrain-story] passed click-only cards, reversible growth, selection preservation, wheel/keyboard/touch scrolling, fixed column, shared canvas, activity, reduced motion and zero runtime/GPU errors'
  );
} finally {
  await browser.close();
}
