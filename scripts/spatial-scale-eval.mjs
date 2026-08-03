#!/usr/bin/env node
/**
 * Demo-scale board measurement (ENG-004 V3.1).
 *
 * Drives /eval/t10-board-scale at 150 / 1k / 10k synthetic Agents (fleet and
 * giant-Project altitudes) and records, per scenario:
 *   - layout selector cost (ms) and the emitted entity budget (stats)
 *   - draw calls per frame
 *   - render cadence + CPU render cost during a 600ms held-key glide and a
 *     wheel-zoom burst (p50/p95 frame intervals, p95 gl.render CPU ms).
 *     Percentiles cover the DRIVEN motion window only — the idle settle tail
 *     is excluded (it otherwise collapses cadence to the vsync interval).
 *     Cadence numbers are bounded by the display/scheduler: headed runs cap
 *     at the display refresh; headless Chromium throttles begin-frames, so
 *     headless cadence measures the harness, not the app — read renderCpu,
 *     draw calls, layout cost, and park there instead.
 *   - JS heap after settle
 *   - park-at-rest (fleet altitude has no rotors at aggregate density, so a
 *     settled 1s sample must render ~0 new frames)
 *   - a screenshot per scenario (9-point non-blank variance gate)
 *
 * Run:  EXA_BASE=http://localhost:7090 pnpm eval:spatial:scale
 * Headed (real GPU numbers): SCALE_HEADED=1 [SCALE_WINDOW_POS=x,y] — position
 * the window on a non-primary display; otherwise stay headless.
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, 'r3f-eval', 'scale-report');
const EXA_BASE = process.env.EXA_BASE || 'http://localhost:7090';
const HEADED = process.env.SCALE_HEADED === '1';
const WINDOW_POS = process.env.SCALE_WINDOW_POS || null;
const HARD_FAIL = [
  'THREE.WebGLProgram',
  'shader',
  'GL_INVALID',
  'context lost',
  'WebGL context',
];

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Fall through to known caches.
  }
  const home = process.env.HOME || '';
  const roots = [
    join(home, 'Library/Caches/ms-playwright'),
    join(home, '.cache/ms-playwright'),
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const directory of readdirSync(root)) {
      if (!directory.startsWith('chromium')) continue;
      for (const candidate of [
        join(root, directory, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(root, directory, 'chrome-linux/chrome'),
      ]) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
}

const SCENARIOS = [
  // The REAL demo fleet (ENG-027 W3/W4, Voltaic) — canonical V3.1 numbers.
  { id: 'voltaic-fleet', fleet: 'voltaic', altitude: 'fleet', park: true },
  {
    id: 'voltaic-fleet-angle',
    fleet: 'voltaic',
    altitude: 'fleet',
    park: true,
    projection: 'fixed-angle',
  },
  // Largest Voltaic Project (dispatch-engine, 28 Agents) — individual pieces
  // + DOM agent controls path.
  { id: 'voltaic-project', fleet: 'voltaic', altitude: 'project', park: false },
  // Synthetic headroom tiers beyond the authored fleet.
  { id: 'fleet-150', agents: 150, altitude: 'fleet', park: true },
  { id: 'fleet-1000', agents: 1000, altitude: 'fleet', park: true },
  { id: 'fleet-10000', agents: 10000, altitude: 'fleet', park: true },
  { id: 'fleet-10000-angle', agents: 10000, altitude: 'fleet', park: true, projection: 'fixed-angle' },
  // Lead Project holds ~1/3 of the fleet: the giant-Project drill.
  { id: 'project-1000', agents: 1000, altitude: 'project', park: false },
  { id: 'project-10000', agents: 10000, altitude: 'project', park: false },
];

async function installRenderProbe(page) {
  await page.evaluate(() => {
    const gl = window.__EVAL_GL__;
    if (!gl || gl.__origRender) return;
    gl.__origRender = gl.render.bind(gl);
    gl.__renders = [];
    gl.render = (...args) => {
      const start = performance.now();
      const result = gl.__origRender(...args);
      gl.__renders.push({
        at: start,
        cpuMs: performance.now() - start,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
      });
      return result;
    };
  });
}

async function sampleMotion(page, { kind, durationMs }) {
  return page.evaluate(
    async ({ kind, durationMs }) => {
      const gl = window.__EVAL_GL__;
      gl.__renders = [];
      const rafTimes = [];
      const start = performance.now();
      if (kind === 'glide') {
        document.body.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowRight',
            code: 'ArrowRight',
            bubbles: true,
          })
        );
        setTimeout(() => {
          document.body.dispatchEvent(
            new KeyboardEvent('keyup', {
              key: 'ArrowRight',
              code: 'ArrowRight',
              bubbles: true,
            })
          );
        }, durationMs);
      } else if (kind === 'zoom') {
        const canvas = document.querySelector('canvas');
        const rect = canvas.getBoundingClientRect();
        let ticks = 0;
        const wheelTimer = setInterval(() => {
          ticks += 1;
          canvas.dispatchEvent(
            new WheelEvent('wheel', {
              deltaY: ticks % 12 < 6 ? -40 : 40,
              ctrlKey: true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
              bubbles: true,
              cancelable: true,
            })
          );
          if (performance.now() - start > durationMs) clearInterval(wheelTimer);
        }, 40);
      }
      await new Promise(resolve => {
        const sample = timestamp => {
          rafTimes.push(timestamp);
          if (performance.now() - start < durationMs + 900) {
            requestAnimationFrame(sample);
            return;
          }
          resolve();
        };
        requestAnimationFrame(sample);
      });
      // Measurement honesty: percentiles come from the DRIVEN motion window
      // only. The 900ms settle tail exists so damped follow-through can park,
      // but a parked demand loop renders nothing — folding the tail's idle
      // rAF ticks into the percentiles makes every cadence number collapse to
      // the display's vsync interval (a tautology, not a measurement).
      const motionEnd = start + durationMs;
      const renders = gl.__renders.slice();
      const motionRafTimes = rafTimes.filter(time => time <= motionEnd);
      const intervals = motionRafTimes
        .slice(1)
        .map((time, index) => time - motionRafTimes[index])
        .sort((a, b) => a - b);
      const motionRenders = renders.filter(r => r.at <= motionEnd);
      // One presented frame can carry several gl.render invocations back to
      // back (postprocessing passes; R3F's demand loop draining accumulated
      // invalidations in a single tick). Collapse bursts (<2ms apart) into
      // presented frames so frame intervals and per-frame CPU are real.
      const frames = [];
      for (const r of motionRenders) {
        const last = frames[frames.length - 1];
        if (last && r.at - last.end < 2) {
          last.end = r.at;
          last.cpuMs += r.cpuMs;
        } else {
          frames.push({ at: r.at, end: r.at, cpuMs: r.cpuMs });
        }
      }
      const renderIntervals = frames
        .slice(1)
        .map((frame, index) => frame.at - frames[index].at)
        .sort((a, b) => a - b);
      const cpu = frames.map(frame => frame.cpuMs).sort((a, b) => a - b);
      const pick = (sorted, p) =>
        sorted.length === 0
          ? null
          : sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)];
      return {
        rafFrames: motionRafTimes.length,
        rafP50Ms: pick(intervals, 0.5),
        rafP95Ms: pick(intervals, 0.95),
        renderPasses: motionRenders.length,
        renderedFrames: frames.length,
        renderP50Ms: pick(renderIntervals, 0.5),
        renderP95Ms: pick(renderIntervals, 0.95),
        renderCpuP50Ms: pick(cpu, 0.5),
        renderCpuP95Ms: pick(cpu, 0.95),
        // Damped follow-through after the input stops; parked scenes should
        // drive this toward zero quickly.
        tailRenderPasses: renders.length - motionRenders.length,
        // Postprocessing splits one visual frame into several gl.render pass
        // invocations; the scene pass carries the real object draw count, so
        // report the max observed.
        drawCalls:
          renders.length > 0 ? Math.max(...renders.map(r => r.calls)) : null,
        triangles:
          renders.length > 0
            ? Math.max(...renders.map(r => r.triangles))
            : null,
      };
    },
    { kind, durationMs }
  );
}

async function run() {
  mkdirSync(REPORT_DIR, { recursive: true });
  const executablePath = resolveChromium();
  check(executablePath !== null, 'No Playwright Chromium found');
  const args = ['--enable-precise-memory-info'];
  if (HEADED && WINDOW_POS) args.push(`--window-position=${WINDOW_POS}`);
  const browser = await chromium.launch({
    headless: !HEADED,
    executablePath,
    args,
  });
  const results = [];
  let failures = 0;

  for (const scenario of SCENARIOS) {
    const context = await browser.newContext({
      // Fits the smaller non-primary display so headed (real GPU) runs and
      // headless runs measure the same canvas size.
      viewport: { width: 1400, height: 860 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const params = new URLSearchParams();
    if (scenario.fleet) params.set('fleet', scenario.fleet);
    else params.set('agents', String(scenario.agents));
    if (scenario.altitude === 'project') params.set('altitude', 'project');
    if (scenario.projection) params.set('projection', scenario.projection);
    const url = `${EXA_BASE}/eval/t10-board-scale?${params.toString()}`;
    const result = { id: scenario.id, url, ok: false };
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
      await page.waitForFunction(
        () => {
          const canvas = document.querySelector('canvas');
          return canvas && canvas.width > 0 && canvas.height > 0;
        },
        { timeout: 30_000 }
      );
      await page.waitForFunction(() => Boolean(window.__EVAL_GL__), {
        timeout: 15_000,
      });
      // Let entrance choreography and camera arrival settle fully.
      await page.waitForTimeout(1_800);
      await installRenderProbe(page);

      result.board = await page.evaluate(() => window.__EVAL_BOARD__ ?? null);
      result.domNodes = await page.evaluate(
        () => document.querySelectorAll('*').length
      );
      result.heapMB = await page.evaluate(() =>
        performance.memory
          ? Math.round(performance.memory.usedJSHeapSize / 1048576)
          : null
      );

      // Screenshot the settled arrival framing BEFORE motion sampling moves
      // the camera.
      await page.screenshot({
        path: join(REPORT_DIR, `${scenario.id}.png`),
        fullPage: false,
      });

      result.glide = await sampleMotion(page, {
        kind: 'glide',
        durationMs: 600,
      });
      await page.waitForTimeout(700);
      result.zoom = await sampleMotion(page, { kind: 'zoom', durationMs: 700 });

      if (scenario.park) {
        // Let the damped camera finish converging after the motion samples:
        // wait for a 400ms window with no renders (bounded), THEN take the
        // settled one-second park sample.
        result.quietReached = await page
          .waitForFunction(
            () => {
              const gl = window.__EVAL_GL__;
              const renders = gl.__renders;
              const last =
                renders.length === 0 ? 0 : renders[renders.length - 1].at;
              return performance.now() - last > 400;
            },
            { timeout: 10_000, polling: 100 }
          )
          .then(
            () => true,
            // A scene still rendering after 10s is itself a park failure; the
            // sample below will report the frame count with that context.
            () => false
          );
        result.park = await page.evaluate(async () => {
          const gl = window.__EVAL_GL__;
          const before = gl.__renders.length;
          await new Promise(resolve => setTimeout(resolve, 1_000));
          return gl.__renders.length - before;
        });
        check(
          result.park === 0,
          `${scenario.id}: expected parked scene, saw ${result.park} frames in a settled second` +
            (result.quietReached
              ? ''
              : ' (scene never went quiet for 400ms within 10s before sampling)')
        );
      }

      // Non-blank gate: 9-point variance on the drawing buffer.
      const blank = await page.evaluate(() => {
        const canvas = document.querySelector('canvas');
        const gl2 =
          canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl2) return { unreadable: true };
        const { drawingBufferWidth: w, drawingBufferHeight: h } = gl2;
        const px = new Uint8Array(4);
        const seen = new Set();
        for (const [fx, fy] of [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.9, 0.1],
          [0.1, 0.5],
          [0.5, 0.5],
          [0.9, 0.5],
          [0.1, 0.9],
          [0.5, 0.9],
          [0.9, 0.9],
        ]) {
          gl2.readPixels(
            Math.floor(w * fx),
            Math.floor(h * fy),
            1,
            1,
            gl2.RGBA,
            gl2.UNSIGNED_BYTE,
            px
          );
          seen.add(px.join(','));
        }
        return { unreadable: false, distinct: seen.size };
      });
      check(
        blank.unreadable !== true && blank.distinct > 1,
        `${scenario.id}: canvas appears blank (${JSON.stringify(blank)})`
      );

      await page.screenshot({
        path: join(REPORT_DIR, `${scenario.id}-after-motion.png`),
        fullPage: false,
      });

      const hard = errors.filter(text =>
        HARD_FAIL.some(marker => text.includes(marker))
      );
      check(hard.length === 0, `${scenario.id}: WebGL errors: ${hard[0]}`);
      result.consoleErrors = errors;
      result.ok = true;
    } catch (error) {
      result.error = String(error);
      failures += 1;
    }
    results.push(result);
    console.log(
      `${result.ok ? 'PASS' : 'FAIL'} ${scenario.id}` +
        (result.board
          ? ` layout=${result.board.layoutMs.toFixed(1)}ms pieces=${result.board.stats.emittedPieceCount} labels=${result.board.stats.visibleLabelCount}`
          : '') +
        (result.glide
          ? ` glide raf p50/p95=${result.glide.rafP50Ms?.toFixed(1)}/${result.glide.rafP95Ms?.toFixed(1)}ms render p50/p95=${result.glide.renderP50Ms?.toFixed(1)}/${result.glide.renderP95Ms?.toFixed(1)}ms cpu p95=${result.glide.renderCpuP95Ms?.toFixed(2)}ms calls=${result.glide.drawCalls}`
          : '') +
        (result.heapMB != null ? ` heap=${result.heapMB}MB` : '') +
        (result.park != null ? ` parkFrames=${result.park}` : '') +
        (result.error ? `\n  ${result.error}` : '')
    );
    await context.close();
  }

  await browser.close();
  writeFileSync(
    join(REPORT_DIR, 'results.json'),
    JSON.stringify(
      { at: new Date().toISOString(), base: EXA_BASE, headed: HEADED, results },
      null,
      2
    )
  );
  console.log(`\nReport: ${join(REPORT_DIR, 'results.json')}`);
  if (failures > 0) {
    console.error(`${failures} scenario(s) failed`);
    process.exit(1);
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
