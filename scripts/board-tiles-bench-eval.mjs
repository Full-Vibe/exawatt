#!/usr/bin/env node
/** ENG-004 V4.1 P3: reproducible look-review matrix, not P4 product parity. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveQaBrowserLaunchOptions,
  primeEvalBrowserPage,
} from './lib/qa-browser.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7113';
const reportDir =
  process.env.TILES_REPORT_DIR || '/tmp/exawatt-fleet-v2-review';
mkdirSync(reportDir, { recursive: true });
const browser = await chromium.launch(
  await resolveQaBrowserLaunchOptions(chromium, { headless: true })
);
const context = await browser.newContext({
  viewport: { width: 1920, height: 1120 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
});
const report = [];
try {
  const scenarios = [];
  for (const theme of ['classic', 'air', 'night']) {
    for (const fixture of ['scale-10', 'scale-100', 'scale-1000', 'demo']) {
      scenarios.push({ theme, fixture, altitude: 'fleet', greybox: false });
    }
    scenarios.push({
      theme,
      fixture: 'scale-10',
      altitude: 'project',
      greybox: false,
    });
  }
  scenarios.unshift({
    theme: 'classic',
    fixture: 'scale-1000',
    altitude: 'fleet',
    greybox: true,
  });
  for (const scenario of scenarios) {
    const page = await context.newPage();
    await primeEvalBrowserPage(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const id = `${scenario.theme}-${scenario.fixture}-${scenario.altitude}${scenario.greybox ? '-greybox' : ''}`;
    const url = `${base}/hud-gallery/board-study?${new URLSearchParams({ ...scenario, greybox: String(scenario.greybox), view: 'v2', material: 'compare' })}`;
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(
      () => {
        const canvases = [
          ...document.querySelectorAll('[data-board-view="v2"] canvas'),
        ];
        return (
          canvases.length === 5 &&
          canvases.every(
            canvas =>
              canvas.width > 0 &&
              canvas.boardEvidence?.gl.info.render.triangles > 0
          )
        );
      },
      null,
      { timeout: 120000 }
    );
    // The camera's reduced-motion branch snaps; two committed paints suffice.
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const canvases = await page.evaluate(() =>
      [...document.querySelectorAll('[data-board-view="v2"] canvas')].map(
        canvas => {
          const { gl, scene, camera } = canvas.boardEvidence;
          gl.render(scene, camera);
          const context =
            canvas.getContext('webgl2') || canvas.getContext('webgl');
          const pixel = new Uint8Array(4);
          const colors = new Set();
          for (let x = 0; x < 21; x++)
            for (let y = 0; y < 21; y++) {
              context.readPixels(
                Math.floor(canvas.width * (0.025 + (x * 0.95) / 20)),
                Math.floor(canvas.height * (0.025 + (y * 0.95) / 20)),
                1,
                1,
                context.RGBA,
                context.UNSIGNED_BYTE,
                pixel
              );
              colors.add(pixel.join(','));
            }
          return {
            material: canvas.closest('[data-board-material]').dataset
              .boardMaterial,
            colors: colors.size,
            drawCalls: gl.info.render.calls,
            triangles: gl.info.render.triangles,
            geometries: gl.info.memory.geometries,
            textures: gl.info.memory.textures,
          };
        }
      )
    );
    if (errors.length) throw new Error(`${id}: ${errors.join('\n')}`);
    if (canvases.some(canvas => canvas.colors <= 1))
      throw new Error(`${id}: blank canvas ${JSON.stringify(canvases)}`);
    const screenshot = join(reportDir, `${id}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    report.push({ id, url, screenshot, canvases });
    console.log(
      `PASS ${id}: ${canvases.map(canvas => `${canvas.material} ${canvas.drawCalls} draws / ${canvas.triangles} triangles`).join(', ')}`
    );
    await page.close();
  }
  // Dense fanout must remain independently clickable; oversized DOM wrappers
  // previously captured neighboring parent/child centers despite correct pixels.
  const fanout = await context.newPage();
  await fanout.setViewportSize({ width: 1440, height: 1000 });
  await primeEvalBrowserPage(fanout);
  const fanoutErrors = [];
  fanout.on('pageerror', error => fanoutErrors.push(error.message));
  fanout.on('console', message => {
    if (message.type() === 'error') fanoutErrors.push(message.text());
  });
  const fanoutUrl = `${base}/hud-gallery/board-study?view=v2&material=gummy&theme=air&fixture=fanout&altitude=project`;
  await fanout.goto(fanoutUrl, { waitUntil: 'load' });
  await fanout.waitForFunction(() => {
    const targets = [
      ...document.querySelectorAll(
        '[data-board-agent], [data-board-delegation-unit]'
      ),
    ];
    return (
      targets.length > 0 &&
      targets.every(
        node =>
          parseFloat(
            getComputedStyle(node).getPropertyValue('--board-hit-size')
          ) > 0
      )
    );
  });
  const hits = await fanout.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[data-board-agent], [data-board-delegation-unit]'
      ),
    ].map(node => {
      const box = node.getBoundingClientRect();
      return {
        id:
          node.getAttribute('data-board-agent') ??
          node.getAttribute('data-board-delegation-unit'),
        hit:
          document
            .elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            ?.closest('button') === node,
      };
    })
  );
  if (hits.some(hit => !hit.hit))
    throw new Error(
      `Fanout targets occluded: ${JSON.stringify(hits.filter(hit => !hit.hit))}`
    );
  const child = fanout.locator('[data-board-delegation-unit]').first();
  const parentId = await child.getAttribute('data-board-delegation-parent');
  const parent = fanout.locator(`[data-board-agent="${parentId}"]`);
  await parent.click();
  await fanout.waitForFunction(
    id =>
      document
        .querySelector(`[data-board-agent="${id}"]`)
        ?.getAttribute('aria-pressed') === 'true',
    parentId
  );
  await child.click();
  await fanout.waitForFunction(
    id =>
      document
        .querySelector(`[data-board-agent="${id}"]`)
        ?.getAttribute('aria-pressed') === 'false',
    parentId
  );
  if (fanoutErrors.length)
    throw new Error(`Fanout errors: ${fanoutErrors.join('; ')}`);
  const fanoutScreenshot = join(reportDir, 'air-fanout-project.png');
  await fanout.screenshot({ path: fanoutScreenshot, fullPage: true });
  report.push({
    id: 'air-fanout-project',
    url: fanoutUrl,
    screenshot: fanoutScreenshot,
    hits,
  });
  console.log(
    `PASS fanout: ${hits.length} independent parent/child targets; real clicks preserve parent selection`
  );
  await fanout.close();
  writeFileSync(
    join(reportDir, 'report.json'),
    JSON.stringify(report, null, 2)
  );
  const choices = report
    .map(
      row =>
        `<option value="${row.screenshot.split('/').at(-1)}">${row.id.replaceAll('-', ' ')}</option>`
    )
    .join('');
  const initial =
    report.find(row => row.id === 'night-scale-10-project') ?? report[0];
  writeFileSync(
    join(reportDir, 'index.html'),
    `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fleet v2 · material and interaction review</title>
<style>body{margin:24px;background:#101418;color:#e2e9ed;font:16px system-ui}h1{font-size:22px;margin:0 0 8px}p{color:#adb8c0}select{font:inherit;padding:8px;margin-bottom:16px;max-width:100%}img{display:block;width:100%;height:auto}a{color:#91d3d0}</style>
<h1>Fleet v2 · material and interaction review</h1><p>Left to right: Gummy, Matte, Glazed, Acrylic, Anodized. Product parity is verified separately.</p>
<label for="capture">Capture </label><select id="capture">${choices}</select>
<a id="full" href="${initial.screenshot.split('/').at(-1)}"><img id="image" alt="Fleet material comparison or delegation interaction fixture" src="${initial.screenshot.split('/').at(-1)}"></a>
<p><a href="report.json">Render measurements</a> · Click the image for the full-resolution screenshot.</p>
<script>const s=document.getElementById('capture');s.value=${JSON.stringify(initial.screenshot.split('/').at(-1))};s.onchange=()=>{document.getElementById('image').src=s.value;document.getElementById('full').href=s.value};</script></html>`
  );
  console.log(`Review evidence: ${reportDir}`);
} finally {
  await context.close();
  await browser.close();
}
