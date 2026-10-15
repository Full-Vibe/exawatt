#!/usr/bin/env node
/** D40 semantics must remain visible over decorative Fleet v2 materials.
 * This is a visibility contract, not a saved-picture appearance snapshot. */
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
      scenarios.push({
        theme,
        material,
        fixture: 'scale-100',
        altitude: 'fleet',
      });
  for (const material of ['gummy', 'matte', 'glazed', 'acrylic', 'anodized'])
    scenarios.push({
      theme: 'air',
      material,
      fixture: 'scale-1000',
      altitude: 'fleet',
    });
  for (const fixture of ['fanout', 'stopped'])
    scenarios.push({
      theme: 'air',
      material: 'gummy',
      fixture,
      altitude: 'project',
    });

  for (const scenario of scenarios) {
    const page = await context.newPage();
    await primeEvalBrowserPage(page);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(
      `${base}/hud-gallery/board-study?${new URLSearchParams({ ...scenario, view: 'v2' })}`,
      { waitUntil: 'load' }
    );
    await page.waitForFunction(
      () => {
        const evidence = document.querySelector('canvas')?.boardEvidence;
        if (!evidence?.gl.info.render.triangles) return false;
        let marks = false;
        evidence.scene.traverse(node => {
          if (
            node.isInstancedMesh &&
            node.count > 0 &&
            (node.userData.instances?.some(ref =>
              ref.current?.name.startsWith('mark:')
            ) ||
              node.geometry.hasAttribute('instanceState'))
          )
            marks = true;
        });
        return marks;
      },
      null,
      { timeout: 120000 }
    );
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    const result = await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      const { gl, scene, camera } = canvas.boardEvidence;
      const webgl = gl.getContext();
      const meshes = [];
      scene.traverse(node => {
        if (node.isMesh) meshes.push(node);
      });
      const marks = meshes.filter(
        node =>
          node.isInstancedMesh &&
          node.count > 0 &&
          (node.userData.instances?.some(ref =>
            ref.current?.name.startsWith('mark:')
          ) ||
            node.geometry.hasAttribute('instanceState'))
      );
      const markSet = new Set(marks);
      const visibility = new Map(meshes.map(mesh => [mesh, mesh.visible]));
      const position = camera.position.clone();
      const zoom = camera.zoom;
      const direction = camera.getWorldDirection(camera.position.clone());
      const rows = [];
      const capture = () => {
        gl.render(scene, camera);
        const edge = 192;
        const data = new Uint8Array(edge * edge * 4);
        webgl.readPixels(
          Math.floor(canvas.width / 2 - edge / 2),
          Math.floor(canvas.height / 2 - edge / 2),
          edge,
          edge,
          webgl.RGBA,
          webgl.UNSIGNED_BYTE,
          data
        );
        return data;
      };
      const ink = (data, index) =>
        data[index] > 200 && data[index + 1] < 60 && data[index + 2] > 200;
      const physical = meshes.filter(
        mesh => mesh.material?.isMeshPhysicalMaterial
      );
      const transmissions = physical.map(mesh => mesh.material.transmission);
      try {
        for (const transmissionOff of [false, true]) {
          for (const mesh of physical) {
            if (transmissionOff) {
              mesh.material.transmission = 0;
              mesh.material.needsUpdate = true;
            }
          }
          for (const target of marks) {
            const originalMaterial = target.material;
            if (originalMaterial.depthTest || originalMaterial.depthWrite)
              throw new Error(
                'v2 status cohort did not opt into the semantic overlay'
              );
            const material = originalMaterial.clone();
            const count = target.count;
            const matrix = target.instanceMatrix.array.slice();
            const colors = target.instanceColor?.array.slice();
            const populationColors =
              target.geometry.getAttribute('instanceMarkColor');
            const originalPopulationColors = populationColors?.array.slice();
            const states = target.geometry.getAttribute('instanceState');
            const originalStates = states?.array.slice();
            const indices = states
              ? [
                  ...new Map(
                    Array.from({ length: count }, (_, index) => [
                      states.getX(index),
                      index,
                    ])
                  ).values(),
                ]
              : [0];
            target.material = material;
            if (material.color) material.color.setRGB(1, 0, 1);
            material.opacity = 1;
            if (material.uniforms?.uBacking)
              material.uniforms.uBacking.value = 0;
            if (target.instanceColor) {
              target.instanceColor.array.fill(1);
              target.instanceColor.needsUpdate = true;
            }
            if (populationColors) {
              for (let index = 0; index < populationColors.count; index++)
                populationColors.setXYZ(index, 1, 0, 1);
              populationColors.needsUpdate = true;
            }
            try {
              for (const index of indices) {
                const transform = camera.matrixWorld.clone();
                target.getMatrixAt(index, transform);
                const state = originalStates?.[index];
                target.instanceMatrix.array.set(
                  matrix.subarray(index * 16, index * 16 + 16),
                  0
                );
                target.instanceMatrix.needsUpdate = true;
                if (states) {
                  states.setX(0, state);
                  states.needsUpdate = true;
                }
                target.count = 1;
                target.geometry.computeBoundingSphere();
                const center = target.geometry.boundingSphere.center
                  .clone()
                  .applyMatrix4(transform)
                  .applyMatrix4(target.matrixWorld);
                const scale =
                  camera.position
                    .clone()
                    .setFromMatrixScale(transform)
                    .length() / Math.sqrt(3);
                const radius = Math.max(
                  0.001,
                  target.geometry.boundingSphere.radius * scale
                );
                camera.position.copy(center).addScaledVector(direction, -100);
                camera.zoom = 100 / (2 * radius);
                camera.updateProjectionMatrix();
                camera.updateMatrixWorld();
                // All other marks remain present: a signal disk must not cover
                // its own check/dot/cross when depth testing is disabled.
                for (const mesh of meshes)
                  mesh.visible = visibility.get(mesh) && markSet.has(mesh);
                const reference = capture();
                for (const mesh of meshes) mesh.visible = visibility.get(mesh);
                const actual = capture();
                // Negative control uses the former world-depth behavior, proving
                // the fixture actually presents an occluder instead of vacuously passing.
                material.depthTest = true;
                const occluded = capture();
                material.depthTest = originalMaterial.depthTest;
                let referencePixels = 0,
                  missing = 0,
                  worldMissing = 0;
                for (let pixel = 0; pixel < reference.length; pixel += 4) {
                  if (!ink(reference, pixel)) continue;
                  referencePixels++;
                  if (!ink(actual, pixel)) missing++;
                  if (!ink(occluded, pixel)) worldMissing++;
                }
                if (referencePixels < 10)
                  throw new Error(
                    `No readable glyph interior: ${target.geometry.type} (${referencePixels})`
                  );
                if (missing > Math.max(2, referencePixels * 0.01))
                  throw new Error(
                    `Status geometry occluded: ${target.geometry.type} lost ${missing}/${referencePixels} interior pixels`
                  );
                rows.push({
                  geometry: target.geometry.type,
                  agent: target.userData.instances?.[index]?.current?.name,
                  state,
                  transmissionOff,
                  referencePixels,
                  missing,
                  worldMissing,
                });
                target.instanceMatrix.array.set(matrix);
                target.instanceMatrix.needsUpdate = true;
                if (states) {
                  states.array.set(originalStates);
                  states.needsUpdate = true;
                }
              }
            } finally {
              target.count = count;
              target.instanceMatrix.array.set(matrix);
              target.instanceMatrix.needsUpdate = true;
              if (colors) {
                target.instanceColor.array.set(colors);
                target.instanceColor.needsUpdate = true;
              }
              if (populationColors) {
                populationColors.array.set(originalPopulationColors);
                populationColors.needsUpdate = true;
              }
              if (states) {
                states.array.set(originalStates);
                states.needsUpdate = true;
              }
              target.material = originalMaterial;
              material.dispose();
            }
          }
        }
      } finally {
        for (const [index, mesh] of physical.entries()) {
          mesh.material.transmission = transmissions[index];
          mesh.material.needsUpdate = true;
        }
        for (const mesh of meshes) mesh.visible = visibility.get(mesh);
        camera.position.copy(position);
        camera.zoom = zoom;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        gl.render(scene, camera);
      }
      return rows;
    });
    assert.equal(errors.length, 0, errors.join('\n'));
    const id = `${scenario.theme}-${scenario.material}-${scenario.fixture}`;
    await page.screenshot({ path: join(output, `${id}.png`) });
    report.push({ ...scenario, rows: result });
    console.log(
      `PASS ${id}: ${result.length} glyph/opacity probes; ${result.reduce((n, row) => n + row.missing, 0)} pixels obscured`
    );
    await page.close();
  }
  assert(
    report.some(
      test =>
        test.material === 'matte' &&
        test.rows.some(row => row.worldMissing > row.referencePixels / 2)
    ),
    'Negative control did not reproduce the original opaque-body occlusion'
  );
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(
    `PASS semantic status visibility: ${report.length} cases; ${output}`
  );
} finally {
  await browser.close();
}
