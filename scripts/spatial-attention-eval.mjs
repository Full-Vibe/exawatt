#!/usr/bin/env node
/** BUG-163: real Fleet command, exact Session handoff and cross-altitude read receipts. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import {
  resolveQaBrowserLaunchOptions,
  primeEvalBrowserPage,
} from './lib/qa-browser.mjs';
const require = createRequire(import.meta.url);
const {
  demoFleetAgents,
  demoWorkspaceAgent,
  orderedAttentionTargets,
} = require('@exawatt/core');
const base = process.env.EXA_BASE ?? 'http://localhost:7183';
const out = '/tmp/exawatt-fleet-attention';
mkdirSync(out, { recursive: true });
const fixtures = demoFleetAgents('scale').map(demoWorkspaceAgent);
const signals = Object.fromEntries(
  fixtures
    .filter(agent => agent.attention)
    .map(agent => [agent.id, agent.attention])
);
const order = orderedAttentionTargets(signals, null);
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  });
  await primeEvalBrowserPage(page);
  await page.addInitScript(() =>
    localStorage.setItem('exawatt:active-workspace:v1', 'demo')
  );
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/fleet/spatial`, { waitUntil: 'load' });
  await page.locator('[data-spatial-board]').waitFor();
  const selected = () => page.locator('[data-open-agent]');
  for (const id of order.slice(0, 3)) {
    await page.keyboard.press('Meta+j');
    await page.waitForFunction(
      expected =>
        document.activeElement?.getAttribute('data-open-agent') === expected,
      id
    );
    assert.equal(await selected().getAttribute('data-open-agent'), id);
  }
  const destination = order[2];
  await page.screenshot({ path: `${out}/demo-follow.png` });
  await page.keyboard.press('Enter');
  await page.waitForURL('**/workspace*');
  await page.locator(`[data-demo-session-pane="${destination}"]`).waitFor();
  console.log(
    'PASS Demo Fleet stable priority pass, follow focus, Enter exact Session'
  );
  const result = fixtures.find(agent => agent.attention?.kind === 'turn-end');
  assert.ok(result);
  // One exact fixture purpose filters both field and command corpus. Re-enter
  // by app navigation, so the existing transport remains the source owner.
  await page.keyboard.press('Control+Meta+3');
  await page.waitForURL('**/fleet/spatial*');
  await page.keyboard.press('0');
  await page.getByPlaceholder('Search agents…').fill(result.name);
  await page.waitForURL(url => url.searchParams.get('q') === result.name);
  await page.getByPlaceholder('Search agents…').press('Tab');
  await page.keyboard.press('Meta+j');

  await page.waitForFunction(
    expected =>
      document.activeElement?.getAttribute('data-open-agent') === expected,
    result.id
  );
  await page.keyboard.press('Enter');
  await page.waitForURL('**/workspace*');
  await page.locator(`[data-demo-session-pane="${result.id}"]`).waitFor();
  await page.keyboard.press('Control+Meta+3');
  await page.waitForURL('**/fleet/spatial*');
  await page.keyboard.press('0');
  await page.getByPlaceholder('Search agents…').fill(result.name);
  await page.waitForURL(url => url.searchParams.get('q') === result.name);
  await page.getByPlaceholder('Search agents…').press('Tab');
  const before = page.url();
  await page.keyboard.press('Meta+j');
  assert.equal(page.url(), before);
  console.log('PASS read Demo result stays read after Fleet re-entry');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
