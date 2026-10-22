#!/usr/bin/env node
/** Accepted v2 work-state contract: visible status-colored bodies, with an
 * accessible reading for every individual. No redundant rotating overlay. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import {
  resolveQaBrowserLaunchOptions,
  primeEvalBrowserPage,
} from './lib/qa-browser.mjs';
const base = process.env.EXA_BASE || 'http://localhost:7158';
const output =
  process.env.STATUS_VISIBILITY_REPORT_DIR || '/tmp/exawatt-status-visibility';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch(
  await resolveQaBrowserLaunchOptions(chromium, { headless: true })
);
const context = await browser.newContext({
  viewport: { width: 1280, height: 960 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
});
const report = [];
try {
  const scenarios = [];
  for (const theme of ['classic', 'air', 'night'])
    for (const material of ['gummy', 'matte', 'glazed', 'acrylic', 'anodized'])
      scenarios.push({ theme, material, fixture: 'scale-100' });
  for (const fixture of ['scale-1000', 'fanout', 'stopped'])
    scenarios.push({ theme: 'air', material: 'gummy', fixture });
  for (const scenario of scenarios) {
    const page = await context.newPage();
    await primeEvalBrowserPage(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(
      `${base}/hud-gallery/board-study?${new URLSearchParams({ ...scenario, view: 'v2' })}`
    );
    await page.waitForFunction(
      () =>
        document.querySelector('canvas')?.boardEvidence?.gl.info.render
          .triangles > 0 &&
        document.querySelector('canvas')?.hasAttribute('data-camera-ready'),
      null,
      { timeout: 120000 }
    );
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const { gl, scene, camera } = canvas.boardEvidence;
      gl.render(scene, camera);
      const pixels = new Uint8Array(4),
        colors = new Set();
      const context = gl.getContext();
      for (let x = 1; x < 20; x++)
        for (let y = 1; y < 20; y++) {
          context.readPixels(
            Math.floor((canvas.width * x) / 20),
            Math.floor((canvas.height * y) / 20),
            1,
            1,
            context.RGBA,
            context.UNSIGNED_BYTE,
            pixels
          );
          colors.add(pixels.join(','));
        }
      const bodies = new Map();
      scene.traverse(node => {
        if (node.name !== 'tile-agent-bodies') return;
        for (let i = 0; i < node.count; i++) {
          const id = node.userData.boardTileBodyIds?.[i];
          if (id)
            bodies.set(id, [
              ...node.instanceColor.array.slice(i * 3, i * 3 + 3),
            ]);
        }
      });
      const units = [...document.querySelectorAll('[data-lattice-unit]')].map(
        button => ({
          id: button.dataset.latticeUnit,
          work: button.dataset.boardWork,
          reading: button.getAttribute('aria-label'),
          color: bodies.get(button.dataset.latticeUnit),
        })
      );
      return {
        colors: colors.size,
        units,
        bodies: bodies.size,
        populations: [
          ...document.querySelectorAll('[data-board-work-counts]'),
        ].map(node => JSON.parse(node.dataset.boardWorkCounts)),
      };
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.ok(
      result.colors > 4 && result.bodies > 0,
      'Fleet must visibly paint its bodies'
    );
    assert.ok(
      result.units.length > 0 ||
        result.populations.some(counts =>
          Object.values(counts).some(count => count > 0)
        ),
      'Fixture must expose individual or aggregate work readings'
    );
    for (const unit of result.units) {
      assert.ok(
        unit.reading?.trim() && unit.work,
        `${unit.id}: missing accessible work reading`
      );
      // An overflow count is a disclosure, not an invented Agent body/status.
      if (unit.id.includes('overflow')) continue;
      assert.ok(
        unit.color?.every(Number.isFinite),
        `${unit.id}: missing rendered body`
      );
    }
    const colored = result.units.filter(
      unit => unit.color && !['stopped', 'unreported'].includes(unit.work)
    );
    const workKinds = new Set(colored.map(unit => unit.work));
    const bodyColors = new Set(
      colored.map(unit => unit.color.map(n => n.toFixed(3)).join(','))
    );
    if (workKinds.size > 1)
      assert.ok(
        bodyColors.size > 1,
        'Distinct work states collapsed to one body color'
      );
    await page.screenshot({
      path: join(
        output,
        `${scenario.theme}-${scenario.material}-${scenario.fixture}.png`
      ),
    });
    report.push({
      ...scenario,
      bodies: result.bodies,
      readings: result.units.length,
      colors: result.colors,
    });
    await page.close();
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `PASS color-led work visibility: ${report.length} material/theme/scale cases`
  );
} finally {
  await browser.close();
}
