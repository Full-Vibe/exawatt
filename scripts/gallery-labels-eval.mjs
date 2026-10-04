#!/usr/bin/env node
/** Gallery text is readable DOM attached to the WebGL world under the real CSP. */
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { resolveQaBrowserLaunchOptions } from './lib/qa-browser.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const output = await mkdtemp(join(tmpdir(), 'exawatt-gallery-labels-'));
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') failures.push(message.text());
  });
  const response = await page.goto(`${base}/hud-gallery`, {
    waitUntil: 'load',
  });
  assert(response.ok(), 'Gallery must load');
  // The regression must run under the actual policy, not a bypassed CSP.
  const policy = response.headers()['content-security-policy'];
  assert(
    policy?.includes("worker-src 'self' blob:"),
    'Expected application CSP'
  );
  assert(
    !/script-src[^;]*blob:/.test(policy),
    'Script policy must not admit blob imports'
  );
  await page.locator('[data-gallery-world-label]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const id of [
      'frames',
      'labels',
      'statbars',
      'gauges',
      'pills',
      'composed',
    ]) {
      const section = page.locator(`#${id}`);
      await section.scrollIntoViewIfNeeded();
      await page.evaluate(
        () =>
          new Promise(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      );
      const labels = await section
        .locator('[data-gallery-world-label]')
        .evaluateAll(elements =>
          elements.map(element => {
            const rect = element.getBoundingClientRect();
            const stage = element
              .closest('[data-gallery-world-stage]')
              .getBoundingClientRect();
            return {
              text: element.textContent.trim(),
              readable: rect.width > 0 && rect.height > 0,
              contained:
                rect.left >= stage.left - 1 &&
                rect.right <= stage.right + 1 &&
                rect.top >= stage.top - 1 &&
                rect.bottom <= stage.bottom + 1,
              passThrough: getComputedStyle(element).pointerEvents === 'none',
            };
          })
        );
      assert(labels.length > 0, `${id} must have rendered annotations`);
      assert(
        labels.every(
          label =>
            label.text && label.readable && label.contained && label.passThrough
        ),
        `${id}: broken annotation geometry ${JSON.stringify(labels)}`
      );
      await section.screenshot({ path: join(output, `${width}-${id}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  const section = page.locator('#frames');
  await section.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const label = section.locator('[data-gallery-world-label]').first();
  const resting = await label.boundingBox();
  await page.mouse.move(
    resting.x + resting.width / 2,
    resting.y + resting.height / 2
  );
  await page.waitForFunction(
    width =>
      document
        .querySelector('#frames [data-gallery-world-label]')
        .getBoundingClientRect().width >
      width * 1.02,
    resting.width
  );
  await section.screenshot({ path: join(output, 'hover.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    width =>
      Math.abs(
        document
          .querySelector('#frames [data-gallery-world-label]')
          .getBoundingClientRect().width - width
      ) < 0.5,
    resting.width
  );
  await section.screenshot({ path: join(output, 'reduced-motion.png') });
  assert.deepEqual(
    failures,
    [],
    'Gallery must render without worker, CSP, or WebGL errors'
  );
  console.log(
    `PASS: gallery DOM annotations, narrow layout, pointer pass-through, hover and reduced motion. Screenshots: ${output}`
  );
} finally {
  await browser.close();
}
