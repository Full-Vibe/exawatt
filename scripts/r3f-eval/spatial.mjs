#!/usr/bin/env node
/**
 * Full-route capability check for the Spatial Command semantic regimes.
 *
 * Run: EXA_BASE=http://localhost:7000 pnpm eval:spatial
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from '../lib/qa-browser.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, 'spatial-report');
const EXA_BASE = process.env.EXA_BASE || 'http://localhost:7000';
const HEADED = process.env.SPATIAL_HEADED === '1';
const HARD_FAIL = [
  'THREE.WebGLProgram',
  'shader',
  'GL_INVALID',
  'context lost',
  'WebGL context',
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function installRenderProbe(page) {
  await page.evaluate(() => {
    const gl = window.__EVAL_GL__;
    if (!gl || gl.__spatialOriginalRender) return;
    gl.__spatialOriginalRender = gl.render.bind(gl);
    gl.__spatialRenderCount = 0;
    gl.__spatialRenderTimes = [];
    gl.render = (...args) => {
      gl.__spatialRenderCount += 1;
      gl.__spatialRenderTimes.push(performance.now());
      return gl.__spatialOriginalRender(...args);
    };
  });
}

async function measureGlide(page) {
  await installRenderProbe(page);
  await page.evaluate(() => {
    window.__EVAL_GL__.__spatialRenderTimes = [];
  });
  let cadence = null;
  if (HEADED) {
    cadence = await page.evaluate(
      () =>
        new Promise(resolve => {
          const times = [];
          const start = performance.now();
          document.body.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'd',
              code: 'KeyD',
              bubbles: true,
            })
          );
          setTimeout(
            () =>
              document.body.dispatchEvent(
                new KeyboardEvent('keyup', {
                  key: 'd',
                  code: 'KeyD',
                  bubbles: true,
                })
              ),
            500
          );
          const sample = timestamp => {
            times.push(timestamp);
            if (timestamp - start < 1_500) {
              requestAnimationFrame(sample);
              return;
            }
            const intervals = times
              .slice(1)
              .map((time, index) => time - times[index])
              .sort((a, b) => a - b);
            resolve({
              rafFrames: times.length,
              p50Ms:
                intervals[Math.max(0, Math.ceil(intervals.length * 0.5) - 1)],
              p95Ms:
                intervals[Math.max(0, Math.ceil(intervals.length * 0.95) - 1)],
            });
          };
          requestAnimationFrame(sample);
        })
    );
  } else {
    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
    await page.waitForTimeout(1_000);
  }
  const sample = await page.evaluate(() => {
    const times = window.__EVAL_GL__.__spatialRenderTimes;
    return { renderCalls: times.length };
  });
  check(sample.renderCalls > 10, 'Camera glide did not render enough frames');
  return { ...sample, ...cadence };
}

async function pauseDemo(page, mobile) {
  let summary;
  if (mobile) {
    summary = page.getByRole('button', { name: /Demo/i }).first();
    if (await summary.isVisible()) await summary.click();
  }
  const pause = page.getByRole('button', { name: 'Pause simulation' });
  if (await pause.isVisible()) await pause.click();
  if (summary && (await summary.isVisible())) await summary.click();
}

async function waitForSpatialCanvas(page) {
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return Boolean(
        canvas && canvas.width > 0 && canvas.height > 0 && window.__EVAL_GL__
      );
    },
    null,
    { timeout: 20_000 }
  );
}

async function openProject(page) {
  const projects = page.locator('button[aria-label^="Open Project "]');
  await projects.first().waitFor({ state: 'visible' });
  const projectCount = await projects.count();
  check(projectCount > 0, 'Fleet regime has no keyboard-accessible Projects');
  await page.keyboard.press('Digit1');
  await page.waitForURL(/altitude=project/, { timeout: 10_000 });
  const units = page.locator(
    // Agent units carry the status-light protocol labels (landed 2026-07-23);
    // the previous raw-status suffixes never match anymore, and delegation
    // copy may follow the status (ENG-023 D3b) — match the control itself.
    'button[data-board-agent][data-board-status-light]'
  );
  await units.first().waitFor({ state: 'visible' });
  await page.waitForTimeout(900);
  const zoomBeforeSelection = await page.evaluate(
    () => window.__EVAL_CAM__.zoom
  );
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() =>
    new URL(location.href).searchParams.has('agent')
  );
  check(
    new URL(page.url()).searchParams.get('altitude') === 'project',
    'Arrow selection changed semantic altitude instead of selecting an Agent'
  );
  await page.waitForTimeout(900);
  const zoomAfterSelection = await page.evaluate(
    () => window.__EVAL_CAM__.zoom
  );
  check(
    Math.abs(zoomAfterSelection - zoomBeforeSelection) <
      Math.max(0.05, zoomBeforeSelection * 0.02),
    `Arrow selection changed camera zoom instead of gently following the Agent (${zoomBeforeSelection} → ${zoomAfterSelection})`
  );
  const selected = page.locator(
    'button[data-board-agent][aria-current="true"]'
  );
  await selected.waitFor({ state: 'visible' });
  const selectedRect = await selected.boundingBox();
  const canvasRect = await page.locator('canvas').boundingBox();
  check(
    selectedRect && canvasRect,
    'Selected Agent has no visible DOM equivalent'
  );
  const selectedCenter = {
    x: selectedRect.x + selectedRect.width / 2,
    y: selectedRect.y + selectedRect.height / 2,
  };
  check(
    selectedCenter.x >= canvasRect.x + canvasRect.width * 0.12 &&
      selectedCenter.x <= canvasRect.x + canvasRect.width * 0.88 &&
      selectedCenter.y >= canvasRect.y + canvasRect.height * 0.12 &&
      selectedCenter.y <= canvasRect.y + canvasRect.height * 0.88,
    'Arrow selection left the selected Agent outside the camera safe zone'
  );
  return { projectCount, units, zoomBeforeSelection, zoomAfterSelection };
}

async function checkPersistentProjectWorld(page, projectCount) {
  const projects = page.locator('button[aria-label^="Open Project "]');
  check(
    (await projects.count()) === projectCount,
    'Project focus removed neighboring Projects from the board'
  );
  const minimap = page.getByRole('button', {
    name: 'Recenter board from minimap',
  });
  check(
    (await minimap.locator('svg circle').count()) === projectCount,
    'Project focus removed neighboring Projects from the minimap'
  );
  const viewport = minimap.locator('svg rect').last();
  const readViewport = async () => {
    const x = Number(await viewport.getAttribute('x'));
    const y = Number(await viewport.getAttribute('y'));
    const width = Number(await viewport.getAttribute('width'));
    const height = Number(await viewport.getAttribute('height'));
    return {
      x,
      y,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
    };
  };
  const before = await readViewport();
  await page.locator('canvas').hover({ position: { x: 50, y: 50 } });
  await page.mouse.wheel(260, 0);
  await page.waitForTimeout(700);
  const panned = await readViewport();
  check(
    Math.abs(panned.centerX - before.centerX) > 0.5,
    'Project focus swallowed a horizontal pan'
  );
  const resumeFollow = page.getByRole('button', {
    name: 'Follow selected Agent',
  });
  await resumeFollow.waitFor({ state: 'visible' });
  check(
    (await resumeFollow.getAttribute('aria-pressed')) === 'false',
    'Manual pan did not suspend Agent follow'
  );
  await resumeFollow.click();
  const pauseFollow = page.getByRole('button', {
    name: 'Pause Agent follow',
  });
  await pauseFollow.waitFor({ state: 'visible' });
  check(
    (await pauseFollow.getAttribute('aria-pressed')) === 'true',
    'Agent follow reticle did not resume soft follow'
  );
  await page.waitForTimeout(700);
  const followed = await readViewport();
  await page.getByRole('button', { name: 'Angle' }).click();
  await page.getByRole('button', { name: 'Top' }).click();
  await page.waitForTimeout(700);
  const afterRerender = await readViewport();
  check(
    Math.abs(afterRerender.centerX - followed.centerX) < 0.5 &&
      Math.abs(afterRerender.centerY - followed.centerY) < 0.5,
    'A board rerender snapped the camera back to the focused Project'
  );
  return { before, panned, followed, afterRerender };
}

async function checkCanonicalStatusFilters(page) {
  const working = page.getByRole('button', {
    name: /^Working: .*Filter by this status\.$/,
  });
  const result = page.getByRole('button', {
    name: /^Result ready: .*Filter by this status\.$/,
  });
  await working.waitFor({ state: 'visible' });
  const totalsBefore = await page
    .locator('[aria-label="Fleet Agent statuses"]')
    .innerText();
  await working.click();
  await result.click();
  await page.waitForFunction(() => {
    const statuses = new URL(location.href).searchParams.get('status') ?? '';
    return (
      statuses.includes('working') &&
      statuses.includes('reviewing') &&
      statuses.includes('complete')
    );
  });
  check(
    (await working.getAttribute('aria-pressed')) === 'true' &&
      (await result.getAttribute('aria-pressed')) === 'true',
    'Canonical Fleet status pills did not preserve multi-selection'
  );
  check(
    await page.getByText(/\d+ shown/).isVisible(),
    'Filtered result count is not visible'
  );
  check(
    (await page.locator('[aria-label="Fleet Agent statuses"]').innerText()) ===
      totalsBefore,
    'Fleet-wide status totals changed with the active filter'
  );
  await page.getByTitle('Clear search and filters').click();
  await page.waitForFunction(
    () => !new URL(location.href).searchParams.has('status')
  );
  return { totalsBefore };
}

/**
 * Since ENG-027 W2 the web fleet surface serves the honest Voltaic Demo
 * Workspace (the seeded MockFleetTransport and its DemoControls are gone
 * from product surfaces), so the desktop scenario measures glide over the
 * real ~209-entity demo fleet; synthetic 1k/10k coverage lives in
 * `eval:spatial:scale`.
 */
async function checkVoltaicFleet(page) {
  const projects = page.locator('button[aria-label^="Open Project "]');
  await projects.first().waitFor({ state: 'visible', timeout: 10_000 });
  const projectCount = await projects.count();
  check(projectCount > 0, 'Voltaic fleet rendered no Projects');
  const agentNavigator = page.getByLabel('Select Agent on board');
  check(
    (await agentNavigator.locator('option').count()) > 1,
    'Fleet Agents have no keyboard-accessible DOM selection path'
  );
  await agentNavigator.focus();
  check(
    await agentNavigator.evaluate(
      element => element === document.activeElement
    ),
    'Fleet Agent navigator cannot receive keyboard focus'
  );
  await page.evaluate(() => document.activeElement?.blur());
  const motion = await measureGlide(page);
  await page.keyboard.press('Digit0');
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: join(REPORT_DIR, 'desktop-fleet-voltaic.png'),
  });
  return { projectCount, motion };
}

async function checkBoardTools(page) {
  const minimap = page.getByRole('button', {
    name: 'Recenter board from minimap',
  });
  await minimap.waitFor({ state: 'visible' });
  const viewport = minimap.locator('svg rect').last();
  const widthBefore = Number(await viewport.getAttribute('width'));
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.waitForFunction(previous => {
    const map = document.querySelector(
      'button[aria-label="Recenter board from minimap"]'
    );
    const rects = map?.querySelectorAll('svg rect');
    const viewportRect = rects?.[rects.length - 1];
    return Number(viewportRect?.getAttribute('width')) < previous;
  }, widthBefore);
  const widthAfter = Number(await viewport.getAttribute('width'));

  const quaternionBefore = await page.evaluate(() =>
    Array.from(window.__EVAL_CAM__.quaternion)
  );
  await page.getByRole('button', { name: 'Angle' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-projection') === 'fixed-angle'
  );
  await page.waitForTimeout(700);
  const quaternionAfter = await page.evaluate(() =>
    Array.from(window.__EVAL_CAM__.quaternion)
  );
  const quaternionDelta = quaternionAfter.reduce(
    (sum, value, index) => sum + Math.abs(value - quaternionBefore[index]),
    0
  );
  check(quaternionDelta > 0.05, 'Fixed-angle camera pose did not change');
  // Read both projections in one page task. The camera is still damped; four
  // separate attribute awaits can span frames and compare different poses.
  const { projectedViewport, minimapViewport } = await page.evaluate(() => {
    const map = document.querySelector(
      'button[aria-label="Recenter board from minimap"]'
    );
    const rects = map?.querySelectorAll('svg rect');
    const rect = rects?.[rects.length - 1];
    return {
      projectedViewport: window.__EVAL_BOARD_VIEWPORT__
        ? { ...window.__EVAL_BOARD_VIEWPORT__ }
        : null,
      minimapViewport: {
        x: Number(rect?.getAttribute('x')),
        y: Number(rect?.getAttribute('y')),
        width: Number(rect?.getAttribute('width')),
        height: Number(rect?.getAttribute('height')),
      },
    };
  });
  check(projectedViewport, 'Fixed-angle board-plane viewport was not exposed');
  check(
    Math.abs(
      minimapViewport.x -
        (projectedViewport.centerX - projectedViewport.width / 2)
    ) < 0.05 &&
      Math.abs(
        minimapViewport.y -
          (projectedViewport.centerY - projectedViewport.height / 2)
      ) < 0.05 &&
      Math.abs(minimapViewport.width - projectedViewport.width) < 0.05 &&
      Math.abs(minimapViewport.height - projectedViewport.height) < 0.05,
    'Minimap viewport does not match the fixed-angle board-plane footprint'
  );
  check(
    new URL(page.url()).searchParams.get('projection') === 'fixed-angle',
    'Projection preference was not reflected in the URL'
  );
  await page
    .locator('button[aria-label^="Open Project "]')
    .first()
    .waitFor({ state: 'visible' });
  await page.evaluate(
    () =>
      new Promise(resolve =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: join(REPORT_DIR, 'desktop-fleet-fixed-angle.png'),
  });

  await page.getByRole('button', { name: 'Top' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-projection') === 'top-down'
  );
  await page
    .getByRole('button', { name: 'Recenter board', exact: true })
    .click();
  return { widthBefore, widthAfter, quaternionDelta };
}

async function checkAgentProjectionPersistence(page) {
  const before = new URL(page.url()).searchParams.get('agent');
  await page.getByRole('button', { name: 'Angle' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-projection') === 'fixed-angle'
  );
  const url = new URL(page.url());
  check(
    url.searchParams.get('agent') === before,
    'Projection lost Agent state'
  );
  check(
    url.searchParams.get('altitude') === 'agent',
    'Projection lost Agent altitude'
  );
  check(
    await page
      .locator('[data-spatial-selection-panel="agent"]')
      .isVisible(),
    'Projection hid the Agent selection panel'
  );
  await page.getByRole('button', { name: 'Top' }).click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('[data-spatial-board]')
        ?.getAttribute('data-board-projection') === 'top-down'
  );
}

async function openAgent(page, units) {
  const unitCount = await units.count();
  check(unitCount > 0, 'Project regime has no accessible Agent units');
  await units.first().focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/altitude=agent/, { timeout: 10_000 });
  await page.locator('[data-spatial-selection-panel="agent"]').waitFor();
  return unitCount;
}

async function measureIdleFrames(page) {
  await installRenderProbe(page);
  await page.waitForTimeout(4_000);
  await page.evaluate(() => {
    window.__EVAL_GL__.__spatialRenderCount = 0;
  });
  await page.waitForTimeout(1_000);
  return page.evaluate(() => window.__EVAL_GL__.__spatialRenderCount);
}

async function runScenario(browser, scenario) {
  const page = await browser.newPage({
    viewport: scenario.viewport,
    isMobile: scenario.mobile,
    hasTouch: scenario.mobile,
    reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
    deviceScaleFactor: scenario.lowPower ? 2 : 1,
  });
  await primeEvalBrowserPage(page);
  if (scenario.lowPower) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        configurable: true,
        value: 4,
      });
    });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const result = {
    name: scenario.name,
    projectCount: 0,
    unitCount: 0,
    idleFrames: null,
    pixelRatio: null,
    scaleProjects: null,
    scrollable: null,
    hardFail: false,
    errors: [],
    passed: false,
  };

  try {
    await page.goto(`${EXA_BASE}/fleet/spatial`, {
      waitUntil: 'load',
      timeout: 30_000,
    });
    await waitForSpatialCanvas(page);
    const board = await page.evaluate(() => {
      const surface = document.querySelector('[data-spatial-board]');
      return {
        projection: surface?.getAttribute('data-board-projection'),
        projects: Number(surface?.getAttribute('data-board-projects') || 0),
        pieces: Number(surface?.getAttribute('data-board-pieces') || 0),
      };
    });
    check(board.projection === 'top-down', 'Top-down board projection missing');
    check(board.projects > 0, 'Operations Board rendered no visible Projects');
    check(board.pieces > 0, 'Operations Board rendered no visible pieces');
    result.board = board;
    await pauseDemo(page, scenario.mobile);
    result.pixelRatio = await page.evaluate(() =>
      window.__EVAL_GL__.getPixelRatio()
    );
    if (scenario.lowPower) {
      check(
        result.pixelRatio <= 1.25,
        `Low-power DPR was ${result.pixelRatio}, expected at most 1.25`
      );
    }
    if (scenario.scales) {
      const voltaic = await checkVoltaicFleet(page);
      result.scaleProjects = { voltaic: voltaic.projectCount };
      result.motion = voltaic.motion;
    }
    if (scenario.tools) result.boardTools = await checkBoardTools(page);
    if (scenario.tools) {
      result.statusFilters = await checkCanonicalStatusFilters(page);
    }

    const { projectCount, units } = await openProject(page);
    result.projectCount = projectCount;
    if (scenario.tools) {
      result.projectWorld = await checkPersistentProjectWorld(
        page,
        projectCount
      );
    }
    await page.waitForTimeout(1_000);
    if (!scenario.mobile) await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: join(REPORT_DIR, `${scenario.name}-project.png`),
      fullPage: scenario.mobile,
    });
    result.unitCount = await openAgent(page, units);
    if (scenario.tools) await checkAgentProjectionPersistence(page);
    result.idleFrames = await measureIdleFrames(page);

    if (scenario.mobile) {
      result.scrollable = await page.evaluate(
        () => document.documentElement.scrollHeight > window.innerHeight
      );
      check(
        result.scrollable,
        'Mobile inspector is not reachable by scrolling'
      );
      await page
        .locator('[data-spatial-selection-panel="agent"]')
        .scrollIntoViewIfNeeded();
      check(
        await page
          .locator('[data-spatial-selection-panel="agent"]')
          .isVisible(),
        'Mobile Agent inspector is not visible'
      );
    } else if (scenario.reduced || scenario.lowPower) {
      // V2.4 gate amendment: ambient status motion (breathing halos,
      // selection rotation) deliberately keeps the VISIBLE scene alive, so
      // the park-at-rest assertion moves to the contexts that must park —
      // reduced motion and low power (hidden tabs park too, untestable here).
      check(
        result.idleFrames === 0,
        `Reduced/low-power scene must park; drew ${result.idleFrames} idle frames`
      );
    }

    await page.screenshot({
      path: join(REPORT_DIR, `${scenario.name}-agent.png`),
      fullPage: scenario.mobile,
    });

    await page.keyboard.press('Escape');
    await page.waitForURL(/altitude=project/, { timeout: 10_000 });
    await page
      .locator('[data-spatial-selection-panel="agent"]')
      .waitFor({ state: 'hidden', timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForURL(
      url => {
        const altitude = url.searchParams.get('altitude');
        return altitude === null || altitude === 'fleet';
      },
      { timeout: 10_000 }
    );
    result.passed = true;
  } catch (error) {
    result.errors.push(String(error.message || error));
  }

  result.errors.push(...errors.slice(0, 8));
  result.hardFail = result.errors.some(error =>
    HARD_FAIL.some(fragment => error.includes(fragment))
  );
  if (result.errors.length > 0) result.passed = false;
  await page.close();
  return result;
}

/**
 * Team→Fleet altitude handoff (ENG-004 V3.0): drives the t11 fixture, which
 * exercises the REAL capture → publish → ghost → claim → entry-pose →
 * pull-back machinery over the Voltaic fleet. The fallback matrix is the
 * feature: reduced motion, low power, and a missed frame budget must all
 * cut, and input mid-transition must be obeyed.
 */
async function runHandoffScenario(browser, scenario) {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
  });
  await primeEvalBrowserPage(page);
  if (scenario.lowPower) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        configurable: true,
        value: 4,
      });
    });
  } else if (scenario.highPower) {
    // The pose and missed-budget fixtures exercise branches that require the
    // motion gate to be open. Pin this browser capability so a shared QA host
    // reporting four cores cannot silently turn them into low-power cases.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        configurable: true,
        value: 8,
      });
    });
  }
  const errors = [];
  page.on('pageerror', error => errors.push(String(error.message || error)));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  const result = { name: scenario.name, passed: false, errors: [] };
  try {
    await page.goto(
      `${EXA_BASE}/eval/t11-altitude-handoff${scenario.query ?? ''}`,
      { waitUntil: 'load', timeout: 30_000 }
    );
    await page.waitForSelector('[data-enter-fleet]', { timeout: 20_000 });
    // Let the card grid paint so capture sees settled rects.
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    await page.click('[data-enter-fleet]');

    if (scenario.expect === 'pose') {
      try {
        await page.waitForFunction(
          () => window.__EVAL_HANDOFF__?.poseAt != null,
          null,
          { timeout: 10_000 }
        );
      } catch {
        const state = await page.evaluate(() => ({
          handoff: window.__EVAL_HANDOFF__,
          phase: document
            .querySelector('[data-handoff-fixture-phase]')
            ?.getAttribute('data-handoff-fixture-phase'),
          board: Boolean(document.querySelector('[data-spatial-board]')),
        }));
        throw new Error(
          `Handoff entry pose timed out: ${JSON.stringify(state)}`
        );
      }
      // Ghost layer present, never intercepting input.
      const ghosts = await page.evaluate(() => {
        const layer = document.querySelector('[data-altitude-handoff]');
        return {
          present: Boolean(layer),
          pointerEvents: layer ? getComputedStyle(layer).pointerEvents : null,
          ghostCount: document.querySelectorAll('[data-altitude-handoff-ghost]')
            .length,
        };
      });
      check(ghosts.present, 'Handoff ghosts did not render');
      check(
        ghosts.pointerEvents === 'none',
        'Ghost layer must never block input'
      );
      await page.screenshot({ path: join(REPORT_DIR, 'handoff-entry.png') });
      // Input mid-crossfade is obeyed immediately: the board's own keyboard
      // model (digit = drill) responds while ghosts are still flying.
      await page.keyboard.press('Digit1');
      await page.waitForFunction(
        () => window.__EVAL_HANDOFF__?.drilled != null,
        null,
        { timeout: 1_500 }
      );
      await page.waitForTimeout(160);
      await page.screenshot({ path: join(REPORT_DIR, 'handoff-mid.png') });
      await page.waitForFunction(
        () => window.__EVAL_HANDOFF__?.outcome === 'pose',
        null,
        { timeout: 5_000 }
      );
      await page.waitForTimeout(1_500); // pull-back settles
      const state = await page.evaluate(() => ({
        ...window.__EVAL_HANDOFF__,
        settledZoom: window.__EVAL_CAM__?.zoom ?? null,
      }));
      check(state.attempted, 'Handoff was not attempted');
      check(
        state.cardCount === 10,
        `Expected 10 Voltaic cards, captured ${state.cardCount}`
      );
      check(
        state.poseTargets === 10,
        `Entry pose carried ${state.poseTargets}/10 card identities`
      );
      check(state.entryZoom != null, 'Entry zoom was not observed');
      check(state.settledZoom != null, 'Settled zoom was not observed');
      check(
        Math.abs(state.settledZoom - state.entryZoom) >
          Math.abs(state.entryZoom) * 0.02,
        `Camera never pulled back (entry ${state.entryZoom}, settled ${state.settledZoom})`
      );
      check(
        await page.evaluate(
          () => document.querySelector('[data-altitude-handoff]') === null
        ),
        'Ghost layer did not clean up after the crossfade'
      );
      await page.screenshot({ path: join(REPORT_DIR, 'handoff-settled.png') });
      result.detail = {
        entryZoom: state.entryZoom,
        settledZoom: state.settledZoom,
        poseTargets: state.poseTargets,
        drilled: state.drilled,
      };
    } else {
      // Fallback matrix: the cut must fire and the board must still arrive.
      try {
        await page.waitForFunction(
          expectAttempted =>
            window.__EVAL_HANDOFF__ &&
            (expectAttempted
              ? window.__EVAL_HANDOFF__.outcome !== null
              : window.__EVAL_HANDOFF__.attempted === false &&
                document
                  .querySelector('[data-handoff-fixture-phase]')
                  ?.getAttribute('data-handoff-fixture-phase') === 'board'),
          scenario.expectAttempted ?? false,
          { timeout: 10_000 }
        );
      } catch {
        const state = await page.evaluate(() => ({
          handoff: window.__EVAL_HANDOFF__,
          phase: document
            .querySelector('[data-handoff-fixture-phase]')
            ?.getAttribute('data-handoff-fixture-phase'),
          board: Boolean(document.querySelector('[data-spatial-board]')),
        }));
        throw new Error(`Handoff fallback timed out: ${JSON.stringify(state)}`);
      }
      const state = await page.evaluate(() => window.__EVAL_HANDOFF__);
      if (scenario.expectAttempted) {
        check(
          state.outcome === 'fallback',
          `Expected fallback outcome, got ${state.outcome}`
        );
        check(
          state.poseAt === null,
          'A missed budget must never still apply the pose'
        );
      } else {
        check(
          state.attempted === false,
          `${scenario.name} must not attempt the handoff`
        );
      }
      await waitForSpatialCanvas(page);
      check(
        await page.evaluate(
          () => document.querySelector('[data-altitude-handoff]') === null
        ),
        'Fallback left the ghost layer behind'
      );
      const boardVisible = await page.evaluate(() =>
        Boolean(document.querySelector('[data-spatial-board]'))
      );
      check(boardVisible, 'Fallback did not arrive at the board');
      await page.screenshot({
        path: join(REPORT_DIR, `${scenario.name}.png`),
      });
      result.detail = { attempted: state.attempted, outcome: state.outcome };
    }
    result.passed = true;
  } catch (error) {
    result.errors.push(String(error.message || error));
  }
  result.errors.push(...errors.slice(0, 8));
  result.hardFail = result.errors.some(error =>
    HARD_FAIL.some(fragment => error.includes(fragment))
  );
  if (result.errors.length > 0) result.passed = false;
  await page.close();
  return result;
}

const handoffScenarios = [
  { name: 'handoff-pose', expect: 'pose', highPower: true },
  { name: 'handoff-reduced-motion', reduced: true },
  { name: 'handoff-low-power', lowPower: true },
  {
    name: 'handoff-missed-budget',
    query: '?claimDelay=1600',
    expectAttempted: true,
    highPower: true,
  },
];

const scenarios = [
  {
    name: 'desktop',
    viewport: { width: 1440, height: 1000 },
    mobile: false,
    reduced: false,
    scales: true,
    tools: true,
  },
  {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    mobile: true,
    reduced: false,
  },
  {
    name: 'reduced-motion',
    viewport: { width: 1280, height: 800 },
    mobile: false,
    reduced: true,
  },
  {
    name: 'low-power',
    viewport: { width: 1280, height: 800 },
    mobile: false,
    reduced: false,
    lowPower: true,
  },
];

mkdirSync(REPORT_DIR, { recursive: true });
const browser = await chromium.launch({
  headless: !HEADED,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const results = [];
try {
  for (const scenario of scenarios) {
    results.push(await runScenario(browser, scenario));
  }
  for (const scenario of handoffScenarios) {
    results.push(await runHandoffScenario(browser, scenario));
  }
} finally {
  await browser.close();
}

const report = {
  base: EXA_BASE,
  headed: HEADED,
  results,
  timestamp: Date.now(),
};
writeFileSync(
  join(REPORT_DIR, 'spatial-eval.json'),
  JSON.stringify(report, null, 2)
);

console.log(`\nSpatial eval — ${EXA_BASE}`);
console.log('─'.repeat(78));
for (const result of results) {
  const summary = result.detail
    ? JSON.stringify(result.detail)
    : `projects=${result.projectCount}  units=${result.unitCount}  idle=${result.idleFrames}  dpr=${result.pixelRatio}`;
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'}  ${result.name.padEnd(22)} ${summary}`
  );
  if (result.errors.length) console.log(`      ${result.errors[0]}`);
}
console.log('─'.repeat(78));

process.exit(results.every(result => result.passed) ? 0 : 1);
