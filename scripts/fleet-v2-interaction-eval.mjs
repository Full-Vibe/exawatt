#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import {
  resolveQaBrowserLaunchOptions,
  primeEvalBrowserPage,
} from './lib/qa-browser.mjs';
const base = process.env.EXA_BASE || 'http://localhost:7141';
const out = '/tmp/exawatt-fleet-v2-interaction';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(
  await resolveQaBrowserLaunchOptions(chromium, { headless: true })
);
const page = await browser.newPage({
  viewport: { width: 1500, height: 1050 },
  reducedMotion: 'reduce',
});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await primeEvalBrowserPage(page);
await page.addInitScript(() => {
  window.__audioProbe = [];
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...args) {
    window.__audioProbe.push({
      state: this.context.state,
      frequency: this.frequency.value,
    });
    return start.apply(this, args);
  };
});
const rows = [];
try {
  await page.goto(
    `${base}/hud-gallery/board-study?view=v2&material=gummy&theme=night&fixture=fanout&altitude=project`
  );
  await page.waitForFunction(() =>
    document.querySelector('canvas')?.hasAttribute('data-camera-ready')
  );
  await page.screenshot({ path: `${out}/before.png` });
  const readBody = id =>
    page.evaluate(id => {
      const { scene } = document.querySelector('canvas').boardEvidence;
      let result;
      scene.traverse(node => {
        if (node.name !== 'tile-agent-bodies') return;
        const slot = node.userData.boardTileBodyIds?.indexOf(id);
        if (slot >= 0)
          result = [
            ...node.instanceMatrix.array.slice(slot * 16, slot * 16 + 16),
          ];
      });
      return result;
    }, id);
  for (const unit of await page.locator('[data-lattice-unit]').all()) {
    const id = await unit.getAttribute('data-lattice-unit');
    if (id.includes('overflow')) continue;
    await page.mouse.move(0, 0);
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const before = await readBody(id);
    await unit.hover();
    await page.waitForFunction(
      ({ id, before }) => {
        let moved = false;
        document.querySelector('canvas').boardEvidence.scene.traverse(node => {
          const slot =
            node.name === 'tile-agent-bodies'
              ? node.userData.boardTileBodyIds?.indexOf(id)
              : -1;
          if (slot >= 0)
            moved =
              Math.abs(node.instanceMatrix.array[slot * 16 + 13] - before[13]) >
              0.01;
        });
        return moved;
      },
      { id, before }
    );
    const hovering = await readBody(id);
    await page.mouse.down();
    await page.waitForFunction(
      ({ id, hovering }) => {
        let pressed = false;
        document.querySelector('canvas').boardEvidence.scene.traverse(node => {
          const slot =
            node.name === 'tile-agent-bodies'
              ? node.userData.boardTileBodyIds?.indexOf(id)
              : -1;
          if (slot >= 0)
            pressed =
              node.instanceMatrix.array[slot * 16 + 13] < hovering[13] - 0.01;
        });
        return pressed;
      },
      { id, hovering }
    );
    await page.mouse.up();
    rows.push(id);
  }
  const child = page.locator('[data-board-delegation-unit]').first();
  await child.hover();
  await page.screenshot({ path: `${out}/child-hover.png` });
  const sounds = await page.evaluate(() => window.__audioProbe);
  assert.ok(
    sounds.length >= rows.length * 2,
    'Every press and release must schedule material audio'
  );
  assert.ok(
    sounds.some(sound => sound.state === 'running'),
    'User gesture must unlock the audio context'
  );
  const parent = page.locator('[data-board-agent]').first();
  await parent.focus();
  await page.keyboard.press('Enter');
  for (const camera of ['perspective', 'low', 'overhead']) {
    await page
      .getByRole('combobox', { name: 'Camera', exact: true })
      .selectOption(camera);
    await page.waitForFunction(
      camera => document.querySelector('canvas').dataset.cameraReady === camera,
      camera
    );
    await page.screenshot({ path: `${out}/${camera}.png` });
  }
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 430, height: 900 });
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await page.screenshot({ path: `${out}/narrow.png`, fullPage: true });
  await page.setViewportSize({ width: 1500, height: 1050 });
  await page.goto(
    `${base}/hud-gallery/board-study?view=v2&material=gummy&theme=night&fixture=scale-1000&altitude=fleet`
  );
  await page.waitForFunction(() =>
    document.querySelector('canvas')?.hasAttribute('data-camera-ready')
  );
  const population = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'),
      { scene, camera } = canvas.boardEvidence;
    const rect = canvas.getBoundingClientRect();
    let result;
    scene.traverse(node => {
      if (result || node.name !== 'tile-agent-bodies') return;
      node.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      const matrix = node.matrix.clone();
      for (let slot = 0; slot < node.count; slot++) {
        const id = node.userData.boardTileBodyIds?.[slot];
        if (!id?.startsWith('population:')) continue;
        node.getMatrixAt(slot, matrix);
        const point = node.position
          .clone()
          .set(0, 0, 0)
          .applyMatrix4(matrix)
          .applyMatrix4(node.matrixWorld)
          .project(camera);
        const x = rect.x + ((point.x + 1) * rect.width) / 2,
          y = rect.y + ((1 - point.y) * rect.height) / 2;
        if (document.elementFromPoint(x, y) === canvas) {
          result = { id, x, y, height: matrix.elements[13] };
          break;
        }
      }
    });
    return result;
  });
  assert.ok(population, 'Aggregate fixture must expose a visible body');
  await page.mouse.move(population.x, population.y);
  await page.waitForFunction(({ id, height }) => {
    let lifted = false;
    document.querySelector('canvas').boardEvidence.scene.traverse(node => {
      const slot =
        node.name === 'tile-agent-bodies'
          ? node.userData.boardTileBodyIds?.indexOf(id)
          : -1;
      if (slot >= 0)
        lifted = node.instanceMatrix.array[slot * 16 + 13] > height + 0.01;
    });
    return lifted;
  }, population);
  await page.screenshot({
    path: `${out}/population-hover.png`,
    fullPage: true,
  });
  await page.mouse.click(population.x, population.y);
  await page.waitForURL(/altitude=project/);
  assert.equal(errors.length, 0, errors.join('\n'));
  writeFileSync(
    `${out}/report.json`,
    JSON.stringify({ units: rows, sounds, errors }, null, 2)
  );
  console.log(
    `PASS: ${rows.length} parent/child bodies hover and compress; ${sounds.length} audio voices; keyboard and three cameras.`
  );
} finally {
  await browser.close();
}
