#!/usr/bin/env node
/**
 * R3F eval harness — Layer B (Playwright headless) capability ratchet.
 *
 * Turns "it compiled" into "it rendered, no WebGL error, non-blank, correct
 * draw-call count" for a set of isolated R3F task routes (/eval/<task>).
 *
 * Run:  EXA_BASE=http://localhost:7090 node scripts/r3f-eval/run.mjs
 *       (or `pnpm eval:r3f` against the dev server)
 *
 * Deferred (see README): RTTR fast gate (Layer A), optional VLM judge,
 * tasks T3–T6, a real-GPU/xvfb CI runner.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, 'report');
const EXA_BASE = process.env.EXA_BASE || 'http://localhost:7090';

const TASKS = [
  { id: 't1-frame', name: 'Chamfered emissive frame', drawCallMax: null },
  { id: 't2-instanced', name: 'Instanced field (N=200)', drawCallMax: 3 },
  {
    id: 't3-spatial-sparse',
    name: 'Sparse Live Fleet composition',
    drawCallMax: null,
    settleMs: 1_800,
  },
  {
    id: 't4-agent-station',
    name: 'Focused Agent workstation',
    drawCallMax: null,
    settleMs: 1_200,
  },
  {
    id: 't5-operations-board',
    name: 'Spatial Operations Board',
    drawCallMax: 12,
    settleMs: 800,
  },
  {
    id: 't6-status-lights',
    name: 'Agent status-light protocol',
    drawCallMax: null,
    settleMs: 500,
  },
  {
    id: 't7-keyswitch',
    name: 'Interactive individual keyswitch studies',
    // One complete mechanism + one-shot Drei environment/contact-shadow bake.
    // The viewer swaps the specimen in place and parks after interaction.
    drawCallMax: 60,
    settleMs: 1_200,
  },
  {
    id: 't8-home-keyswitch',
    name: 'Homepage Smoke Low architecture keyswitch',
    // Same complete mechanism as T7, with a continuously moving camera.
    drawCallMax: 60,
    settleMs: 1_200,
  },
];

// Substrings that mean a real WebGL/shader failure -> hard gate.
const HARD_FAIL = [
  'THREE.WebGLProgram',
  'shader',
  'GL_INVALID',
  'context lost',
  'WebGL context',
];

/** Resolve a Chromium executable: default cache, else known fallbacks. */
function resolveChromium() {
  // 1) playwright-core's expected path in the default ms-playwright cache
  try {
    const p = chromium.executablePath();
    if (p && existsSync(p)) return undefined; // undefined => let playwright use it
  } catch {
    /* fall through */
  }
  // 2) scan common caches for any installed chromium
  const home = process.env.HOME || '';
  const roots = [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
    '/tmp/exa-pw/node_modules/playwright-core/.local-browsers',
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!dir.startsWith('chromium')) continue;
      const candidates = [
        join(root, dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, dir, 'chrome-linux/chrome'),
      ];
      for (const c of candidates) if (existsSync(c)) return c;
    }
  }
  return null;
}

async function launch() {
  const exe = resolveChromium();
  if (exe === null) {
    console.error(
      '\n[r3f-eval] Chromium not found. Install it once:\n  npx playwright install chromium\n'
    );
    process.exit(2);
  }
  return chromium.launch({ headless: true, executablePath: exe || undefined });
}

async function runTask(browser, task) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const errors = [];
  const warnings = [];
  page.on('pageerror', e => errors.push(String(e.message || e)));
  // only count R3F/WebGL-relevant warnings — ignore generic Next/React dev noise
  const RELEVANT_WARN =
    /three|webgl|r3f|fiber|drei|shader|texture|material|geometry|colorspace|deprecat/i;
  // framework-internal / environmental warnings (not deterministic task signal)
  const BENIGN_WARN = [
    'THREE.Clock: This module has been deprecated', // R3F internal (three 0.184)
    'GL Driver Message', // headless-GPU driver chatter, varies by machine
  ];
  page.on('console', m => {
    const t = m.text();
    if (m.type() === 'error') errors.push(t);
    else if (
      m.type() === 'warning' &&
      RELEVANT_WARN.test(t) &&
      !BENIGN_WARN.some(b => t.includes(b))
    )
      warnings.push(t);
  });

  const url = `${EXA_BASE}/eval/${task.id}`;
  const result = {
    id: task.id,
    name: task.name,
    url,
    hardFail: false,
    nonBlank: false,
    drawCalls: null,
    drawCallOk: false,
    semanticOk: true,
    warnings: 0,
    errors: [],
    score: 0,
    notes: [],
  };

  try {
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => {
        const c = document.querySelector('canvas');
        return !!c && c.width > 0 && c.height > 0;
      },
      { timeout: 15000 }
    );
    // wait until the client Canvas hydrated, exposed its renderer, AND drew at
    // least one frame (info.render.calls > 0) — sampling before this is blank.
    await page.waitForFunction(
      () => {
        const gl = window.__EVAL_GL__;
        return !!(gl && gl.info && gl.info.render && gl.info.render.calls > 0);
      },
      { timeout: 15000 }
    );
    // two more rAFs so the painted frame is composited before capture
    await page.evaluate(
      () =>
        new Promise(r =>
          requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
        )
    );
    if (task.settleMs) await page.waitForTimeout(task.settleMs);

    // non-blank: downscale the whole canvas to 64x64 and measure luminance
    // variance + range — robust to sparse content (e.g. an instanced field
    // where a coarse point-grid would land in the gaps).
    const blank = await page.evaluate(() => {
      const c = document.querySelector('canvas');
      if (!c) return { ok: false };
      const S = 64;
      const off = document.createElement('canvas');
      off.width = S;
      off.height = S;
      const ctx = off.getContext('2d');
      ctx.drawImage(c, 0, 0, S, S);
      const data = ctx.getImageData(0, 0, S, S).data;
      const n = S * S;
      const lum = new Array(n);
      let sum = 0;
      let min = 999;
      let max = -1;
      for (let i = 0; i < n; i++) {
        const l =
          0.2126 * data[i * 4] +
          0.7152 * data[i * 4 + 1] +
          0.0722 * data[i * 4 + 2];
        lum[i] = l;
        sum += l;
        if (l < min) min = l;
        if (l > max) max = l;
      }
      const mean = sum / n;
      let v = 0;
      for (const l of lum) v += (l - mean) ** 2;
      return { ok: true, variance: v / n, range: max - min };
    });
    result.nonBlank = !!(blank.ok && (blank.range > 16 || blank.variance > 6));
    result.notes.push(
      `pixels: variance=${(blank.variance ?? 0).toFixed(1)} range=${(blank.range ?? 0).toFixed(0)}`
    );

    // draw calls
    result.drawCalls = await page.evaluate(() => {
      const gl = window.__EVAL_GL__;
      return gl && gl.info && gl.info.render ? gl.info.render.calls : null;
    });
    result.drawCallOk =
      task.drawCallMax === null
        ? true
        : result.drawCalls != null && result.drawCalls <= task.drawCallMax;

    if (task.id === 't3-spatial-sparse') {
      const composition = await page.evaluate(() => {
        const controls = Array.from(
          document.querySelectorAll('button[aria-label^="Open Project "]')
        );
        const rects = controls.map(control => control.getBoundingClientRect());
        if (rects.length !== 2) return { ok: false, count: rects.length };
        const centers = rects.map(rect => rect.top + rect.height / 2);
        const left = Math.min(...rects.map(rect => rect.left));
        const right = Math.max(...rects.map(rect => rect.right));
        return {
          ok:
            Math.abs(centers[0] - centers[1]) < 12 &&
            left > 16 &&
            right < window.innerWidth - 16 &&
            right - left > window.innerWidth * 0.45,
          count: rects.length,
          verticalDelta: Math.abs(centers[0] - centers[1]),
          left,
          right,
          viewport: window.innerWidth,
        };
      });
      result.semanticOk = composition.ok;
      result.notes.push(`sparse-composition: ${JSON.stringify(composition)}`);
      if (!composition.ok)
        result.errors.push('sparse Fleet composition failed');
    }

    if (task.id === 't5-operations-board') {
      const board = await page.evaluate(() => {
        const surface = document.querySelector('[data-spatial-board]');
        const projects = Array.from(
          document.querySelectorAll('[data-board-zone]')
        );
        const rects = projects.map(project => project.getBoundingClientRect());
        return {
          projection: surface?.getAttribute('data-board-projection'),
          projectCount: projects.length,
          horizontal:
            rects.length === 2 && Math.abs(rects[0].top - rects[1].top) < 16,
        };
      });
      result.semanticOk =
        board.projection === 'top-down' &&
        board.projectCount === 2 &&
        board.horizontal;
      result.notes.push(`operations-board: ${JSON.stringify(board)}`);
      if (!result.semanticOk)
        result.errors.push('Spatial Operations Board semantics failed');
    }

    if (task.id === 't7-keyswitch') {
      const canvas = page.locator('canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Keyswitch Canvas has no bounding box');

      const initialCamera = await page.evaluate(() =>
        window.__EVAL_KEYSWITCH_CAMERA__?.position.toArray()
      );
      await page.mouse.move(
        box.x + box.width * 0.12,
        box.y + box.height * 0.46
      );
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width * 0.24,
        box.y + box.height * 0.56,
        { steps: 10 }
      );
      await page.mouse.up();
      await page.waitForTimeout(250);
      const movedCamera = await page.evaluate(() =>
        window.__EVAL_KEYSWITCH_CAMERA__?.position.toArray()
      );

      await page.locator('[data-keyswitch-camera-reset]').click();
      await page.waitForTimeout(120);
      const resetCamera = await page.evaluate(() =>
        window.__EVAL_KEYSWITCH_CAMERA__?.position.toArray()
      );

      const travel = page.locator('[data-keyswitch-travel-control]');
      await travel.dispatchEvent('pointerdown');
      await page.waitForFunction(
        () =>
          window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-reference-frost'
          )?.position.y < -0.16,
        { timeout: 2_000 }
      );
      const pressedTravel = await page.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-reference-frost'
          )?.position.y
      );
      await travel.dispatchEvent('pointerup');
      await page.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName(
              'keyswitch-cap-reference-frost'
            )?.position.y ?? 1
          ) < 0.01,
        { timeout: 2_000 }
      );

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(60);
      await travel.dispatchEvent('pointerdown');
      await page.waitForFunction(
        () =>
          Math.abs(
            (window.__EVAL_SCENE__?.getObjectByName(
              'keyswitch-cap-reference-frost'
            )?.position.y ?? 1) + 0.24
          ) < 0.0001,
        { timeout: 2_000 }
      );
      const reducedTravel = await page.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-reference-frost'
          )?.position.y
      );
      await travel.dispatchEvent('pointerup');
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      const sculptedShellChecks = [];
      for (const variant of [
        'optic-clear',
        'smoke-low',
        'opal-pillow',
        'original-optic',
        'original-satin',
        'original-smoke',
      ]) {
        await page.locator(`[data-keyswitch-variant="${variant}"]`).click();
        await page.waitForFunction(
          expected =>
            document
              .querySelector('[data-keyswitch-study]')
              ?.getAttribute('data-active-keyswitch-variant') === expected,
          variant
        );
        await page.waitForTimeout(350);
        await canvas.screenshot({
          path: join(REPORT_DIR, `${task.id}-${variant}.png`),
        });

        if (variant === 'original-satin' || variant === 'original-smoke') {
          sculptedShellChecks.push(
            await page.evaluate(expectedVariant => {
              const outer = window.__EVAL_SCENE__?.getObjectByName(
                'keyswitch-cap-outer-shell'
              );
              const inner = window.__EVAL_SCENE__?.getObjectByName(
                'keyswitch-cap-inner-shell'
              );
              return {
                variant: expectedVariant,
                sharedGeometry:
                  !!outer && !!inner && outer.geometry === inner.geometry,
                innerScale: inner?.scale.toArray() ?? [],
              };
            }, variant)
          );

          await page.evaluate(() => {
            const camera = window.__EVAL_KEYSWITCH_CAMERA__;
            const gl = window.__EVAL_GL__;
            const scene = window.__EVAL_SCENE__;
            if (!camera || !gl || !scene) return;
            camera.position.set(2.25, 2.05, 2.6);
            camera.lookAt(0, 1.72, 0);
            camera.updateProjectionMatrix();
            gl.render(scene, camera);
          });
          await canvas.screenshot({
            path: join(REPORT_DIR, `${task.id}-${variant}-corner.png`),
          });
        }
      }
      await page.locator('[data-keyswitch-variant="reference-frost"]').click();
      await page.waitForTimeout(350);
      await canvas.screenshot({
        path: join(REPORT_DIR, `${task.id}-reference-frost.png`),
      });

      const idleHintControl = page.locator(
        '[data-keyswitch-idle-hint-control]'
      );
      const idleHintInitiallyEnabled =
        (await idleHintControl.getAttribute('aria-pressed')) === 'true';
      await idleHintControl.click();
      const idleHintDisabled =
        (await page
          .locator('[data-keyswitch-study]')
          .getAttribute('data-idle-hint-enabled')) === 'false';
      await idleHintControl.click();
      await page.waitForFunction(
        () =>
          (window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-reference-frost'
          )?.position.y ?? 0) < -0.012,
        undefined,
        { timeout: 4_000 }
      );
      const galleryHintTravel = await page.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-reference-frost'
          )?.position.y
      );
      await page.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName(
              'keyswitch-cap-reference-frost'
            )?.position.y ?? 1
          ) < 0.008,
        undefined,
        { timeout: 2_000 }
      );

      const distance = (a, b) =>
        Array.isArray(a) && Array.isArray(b)
          ? Math.hypot(...a.map((value, index) => value - b[index]))
          : Number.POSITIVE_INFINITY;
      const movedDistance = distance(initialCamera, movedCamera);
      const resetDistance = distance(initialCamera, resetCamera);

      const study = await page.evaluate(() => {
        const surface = document.querySelector('[data-keyswitch-study]');
        const variants = Array.from(
          document.querySelectorAll('[data-keyswitch-variant]')
        );
        return {
          materialCount: surface?.getAttribute('data-material-count'),
          active: surface?.getAttribute('data-active-keyswitch-variant'),
          variants: variants.map(variant =>
            variant.getAttribute('data-keyswitch-variant')
          ),
          pressedVariant: surface?.getAttribute('data-pressed-variant'),
          idleHintEnabled: surface?.getAttribute('data-idle-hint-enabled'),
          idleHintIntervalMs: surface?.getAttribute(
            'data-idle-hint-interval-ms'
          ),
          assemblyCount: window.__EVAL_SCENE__
            ? window.__EVAL_SCENE__.getObjectsByProperty(
                'name',
                'keyswitch-assembly'
              ).length
            : 0,
          platformScale:
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-platform')?.scale
              .x,
        };
      });
      result.semanticOk =
        study.materialCount === '7' &&
        [
          'reference-frost',
          'optic-clear',
          'smoke-low',
          'opal-pillow',
          'original-optic',
          'original-satin',
          'original-smoke',
        ].every(id => study.variants.includes(id)) &&
        study.active === 'reference-frost' &&
        study.assemblyCount === 1 &&
        study.pressedVariant === 'none' &&
        study.idleHintEnabled === 'true' &&
        study.idleHintIntervalMs === '10000' &&
        study.platformScale === 1 &&
        idleHintInitiallyEnabled &&
        idleHintDisabled &&
        galleryHintTravel < -0.012 &&
        galleryHintTravel > -0.08 &&
        sculptedShellChecks.length === 2 &&
        sculptedShellChecks.every(
          shell =>
            shell.sharedGeometry &&
            shell.innerScale[0] <= 0.9 &&
            shell.innerScale[1] <= 0.82 &&
            shell.innerScale[2] <= 0.9
        ) &&
        pressedTravel < -0.22 &&
        Math.abs(reducedTravel + 0.24) < 0.0001 &&
        movedDistance > 0.05 &&
        resetDistance < 0.05;
      result.notes.push(
        `keyswitch-study: ${JSON.stringify({
          ...study,
          pressedTravel,
          reducedTravel,
          movedDistance,
          resetDistance,
          galleryHintTravel,
          idleHintInitiallyEnabled,
          idleHintDisabled,
          sculptedShellChecks,
        })}`
      );
      if (!result.semanticOk)
        result.errors.push('Keyswitch material-study semantics failed');
    }

    if (task.id === 't8-home-keyswitch') {
      const link = page.locator('[data-architecture-key-link]');
      const cameraPosition = () =>
        page.evaluate(() =>
          window.__EVAL_KEYSWITCH_CAMERA__?.position.toArray()
        );
      const distance = (a, b) =>
        Array.isArray(a) && Array.isArray(b)
          ? Math.hypot(...a.map((value, index) => value - b[index]))
          : Number.POSITIVE_INFINITY;

      const orbitStart = await cameraPosition();
      await page.waitForFunction(
        start => {
          const current = window.__EVAL_KEYSWITCH_CAMERA__?.position.toArray();
          return (
            Array.isArray(current) &&
            Math.hypot(...current.map((value, index) => value - start[index])) >
              0.02
          );
        },
        orbitStart,
        { timeout: 4_000 }
      );
      const orbitEnd = await cameraPosition();
      const orbitDistance = distance(orbitStart, orbitEnd);

      const interactionPage = await browser.newPage({
        viewport: { width: 900, height: 700 },
      });
      await interactionPage.goto(url, {
        waitUntil: 'load',
        timeout: 30_000,
      });
      await interactionPage.waitForFunction(
        () =>
          !!window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low'),
        undefined,
        { timeout: 15_000 }
      );
      await interactionPage.waitForFunction(
        () => {
          const y = window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-smoke-low'
          )?.position.y;
          return typeof y === 'number' && y < -0.012 && y > -0.08;
        },
        undefined,
        { timeout: 3_000 }
      );
      const firstHintTravel = await interactionPage.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
            ?.position.y
      );
      await interactionPage.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
              ?.position.y ?? 1
          ) < 0.008,
        undefined,
        { timeout: 2_000 }
      );
      await interactionPage.waitForFunction(
        () => {
          const y = window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-smoke-low'
          )?.position.y;
          return typeof y === 'number' && y < -0.012 && y > -0.08;
        },
        undefined,
        { timeout: 2_000 }
      );
      const secondHintTravel = await interactionPage.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
            ?.position.y
      );
      await interactionPage.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
              ?.position.y ?? 1
          ) < 0.008,
        undefined,
        { timeout: 2_000 }
      );
      const repeatWaitStartedAt = Date.now();
      await interactionPage.waitForFunction(
        () => {
          const y = window.__EVAL_SCENE__?.getObjectByName(
            'keyswitch-cap-smoke-low'
          )?.position.y;
          return typeof y === 'number' && y < -0.012 && y > -0.08;
        },
        undefined,
        { timeout: 12_500 }
      );
      const repeatedHintDelayMs = Date.now() - repeatWaitStartedAt;
      await interactionPage.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
              ?.position.y ?? 1
          ) < 0.008,
        undefined,
        { timeout: 2_000 }
      );

      await link.dispatchEvent('pointerdown', { button: 0, pointerId: 1 });
      await page.waitForFunction(
        () =>
          window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
            ?.position.y < -0.22,
        { timeout: 2_000 }
      );
      const pressedTravel = await page.evaluate(
        () =>
          window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
            ?.position.y
      );
      await link.dispatchEvent('pointerup', { button: 0, pointerId: 1 });
      await page.waitForFunction(
        () =>
          Math.abs(
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-cap-smoke-low')
              ?.position.y ?? 1
          ) < 0.01,
        { timeout: 2_000 }
      );

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(
        () => {
          const camera = window.__EVAL_KEYSWITCH_CAMERA__;
          if (!camera) return false;
          const azimuth = Math.atan2(camera.position.x, camera.position.z);
          return Math.abs(azimuth + Math.PI * 0.06 * 0.72) < 0.002;
        },
        undefined,
        { timeout: 2_000 }
      );
      const reducedStart = await cameraPosition();
      await page.waitForTimeout(700);
      const reducedEnd = await cameraPosition();
      const reducedDistance = distance(reducedStart, reducedEnd);
      await page.emulateMedia({ reducedMotion: 'no-preference' });

      const semantics = await page.evaluate(() => {
        const root = document.querySelector(
          '[data-home-architecture-keyswitch]'
        );
        const anchor = document.querySelector('[data-architecture-key-link]');
        return {
          rootCount: document.querySelectorAll(
            '[data-home-architecture-keyswitch]'
          ).length,
          href: anchor?.getAttribute('href'),
          label: anchor?.getAttribute('aria-label'),
          pressed: root?.getAttribute('data-pressed'),
          idleHintEnabled: root?.getAttribute('data-idle-hint-enabled'),
          idleHintIntervalMs: root?.getAttribute('data-idle-hint-interval-ms'),
          rootWidth: root?.getBoundingClientRect().width,
          assemblyCount: window.__EVAL_SCENE__
            ? window.__EVAL_SCENE__.getObjectsByProperty(
                'name',
                'keyswitch-assembly'
              ).length
            : 0,
          architectureLegendCount: window.__EVAL_SCENE__
            ? window.__EVAL_SCENE__.getObjectsByProperty(
                'name',
                'keyswitch-legend-architecture'
              ).length
            : 0,
          platformScale:
            window.__EVAL_SCENE__?.getObjectByName('keyswitch-platform')?.scale
              .x,
          cameraElevation: window.__EVAL_KEYSWITCH_CAMERA__
            ? Math.atan2(
                window.__EVAL_KEYSWITCH_CAMERA__.position.y - 0.83,
                Math.hypot(
                  window.__EVAL_KEYSWITCH_CAMERA__.position.x,
                  window.__EVAL_KEYSWITCH_CAMERA__.position.z
                )
              )
            : 0,
          cameraAzimuth: window.__EVAL_KEYSWITCH_CAMERA__
            ? Math.atan2(
                window.__EVAL_KEYSWITCH_CAMERA__.position.x,
                window.__EVAL_KEYSWITCH_CAMERA__.position.z
              )
            : Number.POSITIVE_INFINITY,
        };
      });

      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForFunction(
        () => {
          const root = document.querySelector(
            '[data-home-architecture-keyswitch]'
          );
          return !!root && root.getBoundingClientRect().width <= 190.5;
        },
        undefined,
        { timeout: 2_000 }
      );
      const mobileSemantics = await page.evaluate(() => {
        const root = document.querySelector(
          '[data-home-architecture-keyswitch]'
        );
        const anchor = document.querySelector('[data-architecture-key-link]');
        const rootRect = root?.getBoundingClientRect();
        const anchorRect = anchor?.getBoundingClientRect();
        return {
          rootWidth: rootRect?.width,
          rootHeight: rootRect?.height,
          withinViewport:
            !!rootRect && rootRect.left >= 0 && rootRect.right <= innerWidth,
          targetWidth: anchorRect?.width,
          targetHeight: anchorRect?.height,
        };
      });
      await page.setViewportSize({ width: 900, height: 700 });

      const navigationLink = interactionPage.locator(
        '[data-architecture-key-link]'
      );
      const navigationBox = await navigationLink.boundingBox();
      if (!navigationBox) throw new Error('Architecture link has no bounds');
      await interactionPage.mouse.move(
        navigationBox.x + navigationBox.width / 2,
        navigationBox.y + navigationBox.height / 2
      );
      await interactionPage.mouse.down();
      await interactionPage.waitForTimeout(100);
      const heldUrl = interactionPage.url();
      await interactionPage.evaluate(() => {
        const root = document.querySelector(
          '[data-home-architecture-keyswitch]'
        );
        window.__EVAL_NAV_BOUNDARY__ = null;
        window.__EVAL_RELEASE_START__ = performance.now();
        const observer = new MutationObserver(() => {
          if (root?.getAttribute('data-navigation-state') !== 'navigating') {
            return;
          }
          window.__EVAL_NAV_BOUNDARY__ = {
            delayMs: performance.now() - window.__EVAL_RELEASE_START__,
            position: Number(root.getAttribute('data-release-position')),
          };
          observer.disconnect();
        });
        if (root) observer.observe(root, { attributes: true });
      });
      await interactionPage.mouse.up();
      const releaseRequestedUrl = interactionPage.url();
      const releaseRequestedState = await interactionPage.evaluate(() => ({
        position: window.__EVAL_SCENE__?.getObjectByName(
          'keyswitch-cap-smoke-low'
        )?.position.y,
        navigation: document
          .querySelector('[data-home-architecture-keyswitch]')
          ?.getAttribute('data-navigation-state'),
      }));
      await interactionPage.waitForFunction(
        () => window.__EVAL_NAV_BOUNDARY__ !== null,
        undefined,
        { timeout: 3_000 }
      );
      const navigationBoundary = await interactionPage.evaluate(
        () => window.__EVAL_NAV_BOUNDARY__
      );
      await interactionPage.waitForURL('**/architecture', { timeout: 5_000 });
      const navigatedUrl = interactionPage.url();
      await interactionPage.close();

      const homePage = await browser.newPage({
        viewport: { width: 844, height: 390 },
      });
      homePage.on('pageerror', error =>
        errors.push(String(error.message || error))
      );
      homePage.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await homePage.goto(EXA_BASE, {
        waitUntil: 'load',
        timeout: 30_000,
      });
      await homePage.waitForSelector(
        '[data-home-hero] [data-home-architecture-keyswitch] canvas',
        { timeout: 15_000 }
      );
      const readHomeLayout = () =>
        homePage.evaluate(() => {
          const header = document.querySelector('#site-header');
          const content = document.querySelector('[data-home-hero-content]');
          const key = document.querySelector(
            '[data-home-hero] [data-home-architecture-keyswitch]'
          );
          const headerRect = header?.getBoundingClientRect();
          const contentRect = content?.getBoundingClientRect();
          const keyRect = key?.getBoundingClientRect();
          return {
            viewportWidth: innerWidth,
            viewportHeight: innerHeight,
            headerBottom: headerRect?.bottom,
            contentTop: contentRect?.top,
            contentBottom: contentRect?.bottom,
            keyWidth: keyRect?.width,
            keyHeight: keyRect?.height,
            keyWithinViewport:
              !!keyRect &&
              keyRect.left >= 0 &&
              keyRect.right <= innerWidth &&
              keyRect.bottom <= innerHeight,
          };
        });
      const landscapeHomeLayout = await readHomeLayout();
      await homePage.setViewportSize({ width: 390, height: 844 });
      await homePage.waitForFunction(
        () =>
          document
            .querySelector('[data-home-hero-content]')
            ?.getBoundingClientRect().bottom <= innerHeight,
        undefined,
        { timeout: 2_000 }
      );
      const portraitHomeLayout = await readHomeLayout();
      await homePage.close();

      result.semanticOk =
        semantics.rootCount === 1 &&
        semantics.href === '/architecture' &&
        semantics.label === 'Open Exawatt architecture' &&
        semantics.pressed === 'false' &&
        semantics.idleHintEnabled === 'true' &&
        semantics.idleHintIntervalMs === '10000' &&
        semantics.rootWidth <= 290.5 &&
        semantics.assemblyCount === 1 &&
        semantics.architectureLegendCount === 1 &&
        Math.abs(semantics.platformScale - 0.84) < 0.0001 &&
        semantics.cameraElevation > 0.72 &&
        semantics.cameraElevation < 0.76 &&
        Math.abs(semantics.cameraAzimuth) < 0.21 &&
        mobileSemantics.rootWidth <= 190.5 &&
        mobileSemantics.rootHeight <= 150.5 &&
        mobileSemantics.withinViewport &&
        mobileSemantics.targetWidth >= 44 &&
        mobileSemantics.targetHeight >= 44 &&
        landscapeHomeLayout.contentTop >=
          landscapeHomeLayout.headerBottom + 8 &&
        landscapeHomeLayout.contentBottom <=
          landscapeHomeLayout.viewportHeight &&
        landscapeHomeLayout.keyWidth <= 212 &&
        landscapeHomeLayout.keyHeight <= 161 &&
        landscapeHomeLayout.keyWithinViewport &&
        portraitHomeLayout.contentTop >= portraitHomeLayout.headerBottom + 8 &&
        portraitHomeLayout.contentBottom <= portraitHomeLayout.viewportHeight &&
        portraitHomeLayout.keyWidth <= 190.5 &&
        portraitHomeLayout.keyHeight <= 150.5 &&
        portraitHomeLayout.keyWithinViewport &&
        firstHintTravel < -0.012 &&
        firstHintTravel > -0.08 &&
        secondHintTravel < -0.012 &&
        secondHintTravel > -0.08 &&
        repeatedHintDelayMs >= 8_000 &&
        repeatedHintDelayMs <= 12_500 &&
        pressedTravel < -0.22 &&
        orbitDistance > 0.02 &&
        reducedDistance < 0.002 &&
        heldUrl.endsWith('/eval/t8-home-keyswitch') &&
        releaseRequestedUrl.endsWith('/eval/t8-home-keyswitch') &&
        ['releasing', 'navigating'].includes(
          releaseRequestedState.navigation
        ) &&
        Math.abs(navigationBoundary.position) < 0.008 &&
        navigationBoundary.delayMs > 0 &&
        navigatedUrl.endsWith('/architecture') &&
        navigationBoundary.delayMs < 3_000;
      result.notes.push(
        `home-keyswitch: ${JSON.stringify({
          ...semantics,
          pressedTravel,
          firstHintTravel,
          secondHintTravel,
          repeatedHintDelayMs,
          orbitDistance,
          reducedDistance,
          mobileSemantics,
          landscapeHomeLayout,
          portraitHomeLayout,
          heldUrl,
          releaseRequestedUrl,
          releaseRequestedState,
          navigationBoundary,
          navigatedUrl,
        })}`
      );
      if (!result.semanticOk)
        result.errors.push('Homepage architecture keyswitch semantics failed');
    }

    await page
      .locator('canvas')
      .screenshot({ path: join(REPORT_DIR, `${task.id}.png`) });
  } catch (e) {
    result.errors.push(`run error: ${String(e.message || e)}`);
  }

  result.hardFail = errors.some(e => HARD_FAIL.some(h => e.includes(h)));
  result.warnings = warnings.length;
  result.warningSamples = [...new Set(warnings)].slice(0, 3);
  result.errors.push(...errors.slice(0, 8));

  // score: hard gates first, then points
  let pts = 0;
  if (result.nonBlank) pts += 50; // rendered + non-blank
  if (result.drawCallOk) pts += 30; // instancing / draw-call budget
  if (result.warnings === 0) pts += 20; // no R3F/WebGL warnings
  if (result.hardFail) pts = Math.min(pts, 15); // gate 1: no GL/shader error
  if (!result.nonBlank) pts = Math.min(pts, 15); // gate 2: actually painted
  if (!result.semanticOk) pts = Math.min(pts, 15); // gate 3: semantic fixture
  if (result.errors.length > 0) pts = Math.min(pts, 15); // gate 4: run completed
  result.score = pts;

  await page.close();
  return result;
}

(async () => {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const browser = await launch();
  const results = [];
  for (const task of TASKS) results.push(await runTask(browser, task));
  await browser.close();

  const aggregate = Math.round(
    results.reduce((a, r) => a + r.score, 0) / results.length
  );
  const report = { base: EXA_BASE, aggregate, tasks: results, ts: Date.now() };
  writeFileSync(
    join(REPORT_DIR, 'r3f-eval.json'),
    JSON.stringify(report, null, 2)
  );

  console.log(`\nR3F eval — ${EXA_BASE}`);
  console.log('─'.repeat(72));
  for (const r of results) {
    const flags = [
      r.hardFail ? 'GL-ERR' : 'ok',
      r.nonBlank ? 'painted' : 'BLANK',
      `calls=${r.drawCalls ?? '?'}${r.drawCallOk ? '' : '!'}`,
      `warn=${r.warnings}`,
    ].join('  ');
    console.log(
      `${String(r.score).padStart(3)}/100  ${r.id.padEnd(14)} ${flags}`
    );
    if (r.errors.length) console.log(`        errors: ${r.errors[0]}`);
    if (r.warningSamples?.length)
      console.log(`        warn: ${r.warningSamples[0].slice(0, 90)}`);
  }
  console.log('─'.repeat(72));
  console.log(`AGGREGATE: ${aggregate}/100   report/r3f-eval.json\n`);
  process.exit(results.every(r => r.score >= 70) ? 0 : 1);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
