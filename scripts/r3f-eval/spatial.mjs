#!/usr/bin/env node
/**
 * Full-route capability check for the Spatial Command semantic regimes.
 *
 * Run: EXA_BASE=http://localhost:7000 pnpm eval:spatial
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

function resolveChromium() {
  try {
    const expected = chromium.executablePath();
    if (expected && existsSync(expected)) return undefined;
  } catch {
    // Try known Playwright caches below.
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
        join(
          root,
          directory,
          'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
        ),
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
              key: 'ArrowRight',
              code: 'ArrowRight',
              bubbles: true,
            })
          );
          setTimeout(
            () =>
              document.body.dispatchEvent(
                new KeyboardEvent('keyup', {
                  key: 'ArrowRight',
                  code: 'ArrowRight',
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
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowRight');
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
    'button[aria-label$=", working"], button[aria-label$=", blocked"], button[aria-label$=", reviewing"], button[aria-label$=", idle"]'
  );
  await units.first().waitFor({ state: 'visible' });
  return { projectCount, units };
}

async function checkFleetScales(page) {
  const counts = {};
  const motion = {};
  const agentCounts = { small: 8, medium: 40, large: 150 };
  for (const scale of ['medium', 'large', 'small']) {
    await page
      .getByRole('button', { name: `Seed ${scale} demo fleet` })
      .click();
    await page.waitForFunction(
      expected =>
        document
          .querySelector('[data-spatial-command]')
          ?.getAttribute('data-agent-count') === String(expected),
      agentCounts[scale],
      { timeout: 10_000 }
    );
    const pause = page.getByRole('button', { name: 'Pause simulation' });
    if (await pause.isVisible()) await pause.click();
    const projects = page.locator('button[aria-label^="Open Project "]');
    await projects.first().waitFor({ state: 'visible', timeout: 10_000 });
    counts[scale] = await projects.count();
    check(counts[scale] > 0, `${scale} Fleet scale rendered no Projects`);
    if (scale === 'medium' || scale === 'small') {
      motion[scale] = await measureGlide(page);
      await page.keyboard.press('Digit0');
      await page.waitForTimeout(1_000);
    }
    await page.screenshot({
      path: join(REPORT_DIR, `desktop-fleet-${scale}.png`),
    });
  }
  return { counts, motion };
}

async function openAgent(page, units) {
  const unitCount = await units.count();
  check(unitCount > 0, 'Project regime has no accessible Agent units');
  await units.first().click();
  await page.waitForURL(/altitude=agent/, { timeout: 10_000 });
  await page.getByText('Selected Agent', { exact: true }).waitFor();
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
      const scaleResult = await checkFleetScales(page);
      result.scaleProjects = scaleResult.counts;
      result.motion = scaleResult.motion;
    }

    const { projectCount, units } = await openProject(page);
    result.projectCount = projectCount;
    result.unitCount = await openAgent(page, units);
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
        .getByText('Selected Agent', { exact: true })
        .scrollIntoViewIfNeeded();
      check(
        await page.getByText('Selected Agent', { exact: true }).isVisible(),
        'Mobile Agent inspector is not visible'
      );
    } else {
      check(
        result.idleFrames === 0,
        `Demand scene drew ${result.idleFrames} idle frames`
      );
    }

    await page.screenshot({
      path: join(REPORT_DIR, `${scenario.name}-agent.png`),
      fullPage: scenario.mobile,
    });

    await page.keyboard.press('Escape');
    await page.waitForURL(/altitude=project/, { timeout: 10_000 });
    await page
      .getByText('Selected Agent', { exact: true })
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

const scenarios = [
  {
    name: 'desktop',
    viewport: { width: 1440, height: 1000 },
    mobile: false,
    reduced: false,
    scales: true,
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
const executablePath = resolveChromium();
if (executablePath === null) {
  console.error(
    '[spatial-eval] Chromium not found. Run: npx playwright install chromium'
  );
  process.exit(2);
}

const browser = await chromium.launch({
  headless: !HEADED,
  executablePath: executablePath || undefined,
});
const results = [];
try {
  for (const scenario of scenarios) {
    results.push(await runScenario(browser, scenario));
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
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'}  ${result.name.padEnd(16)} ` +
      `projects=${result.projectCount}  units=${result.unitCount}  idle=${result.idleFrames}  dpr=${result.pixelRatio}`
  );
  if (result.errors.length) console.log(`      ${result.errors[0]}`);
}
console.log('─'.repeat(78));

process.exit(results.every(result => result.passed) ? 0 : 1);
