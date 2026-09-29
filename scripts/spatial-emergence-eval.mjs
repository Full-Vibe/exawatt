#!/usr/bin/env node
/** BUG-228: the real demand board must park after its last retirement and
 * resume on later input. Measure render calls, not elapsed animation speed. */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  primeEvalBrowserPage,
  resolveQaBrowserLaunchOptions,
} from './lib/qa-browser.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const reportDir = join(import.meta.dirname, 'r3f-eval', 'emergence-report');
mkdirSync(reportDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(await resolveQaBrowserLaunchOptions(chromium)),
});
const results = [];
const check = (value, message) => {
  if (!value) throw new Error(message);
};

async function park(page, phase) {
  await page.evaluate(() => {
    window.__EMERGENCE_PROBE__.quiet = 0;
    window.__EMERGENCE_PROBE__.previous = -1;
  });
  // This also covers a delayed final frame: no animation may need a frame
  // before its endpoint in order to release its scheduler afterwards.
  await page
    .waitForFunction(
      () => {
        const probe = window.__EMERGENCE_PROBE__;
        if (probe.previous === probe.renders) probe.quiet += 1;
        else probe.quiet = 0;
        probe.previous = probe.renders;
        return probe.quiet >= 20;
      },
      undefined,
      { timeout: 10_000 }
    )
    .catch(() => {
      throw new Error(`${phase}: board never parked`);
    });
  const sample = await page.evaluate(
    () =>
      new Promise(resolve => {
        const probe = window.__EMERGENCE_PROBE__;
        const before = probe.renders;
        let frames = 0;
        const observe = () => {
          if (++frames < 30) requestAnimationFrame(observe);
          else
            resolve({
              renderCalls: probe.renders - before,
              opportunities: frames,
            });
        };
        requestAnimationFrame(observe);
      })
  );
  check(
    sample.renderCalls === 0,
    `${phase}: parked board rendered ${sample.renderCalls} times`
  );
  return sample;
}

async function population(page, entries) {
  await page.evaluate(entries => {
    window.__EMERGENCE_PROBE__.quiet = 0;
    window.__EVAL_SET_BOARD_POPULATION__(entries);
  }, entries);
  await page.waitForFunction(
    count =>
      Number(
        document
          .querySelector('[data-spatial-board]')
          ?.getAttribute('data-board-pieces')
      ) === count,
    entries.length
  );
}

async function objects(page) {
  return page.evaluate(() => {
    const bodies = [],
      marks = [];
    window.__EVAL_SCENE__.traverse(node => {
      const reading = { name: node.name, scale: node.scale.x };
      if (node.name.startsWith('body:')) bodies.push(reading);
      if (node.name.startsWith('mark:')) marks.push(reading);
    });
    return { bodies, marks };
  });
}

function checkRestored(arrived, baseline) {
  check(
    arrived.bodies.length === baseline.bodies.length,
    'Later arrivals did not render'
  );
  for (const body of arrived.bodies) {
    const original = baseline.bodies.find(item => item.name === body.name);
    check(
      original && Math.abs(body.scale - original.scale) < 1e-6,
      'Arrival did not reach its final body scale'
    );
    const marks = arrived.marks.filter(
      mark => mark.name === body.name.replace('body:', 'mark:')
    );
    check(
      marks.length > 0 &&
        marks.every(mark => Math.abs(mark.scale - body.scale) < 1e-6),
      'Status marks did not settle at body scale'
    );
  }
}

async function switchMotionDuringRetirement(page, baseline, idle, result) {
  await page.evaluate(bodies => {
    const probe = window.__EMERGENCE_PROBE__;
    const nativeNow = performance.now.bind(performance);
    const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
    let heldAt = null;
    // Hold only after a real frame samples a partial retirement. This proves
    // that the preference change snaps it, instead of letting a slow protocol
    // round trip accidentally test an already completed transition.
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => heldAt ?? nativeNow(),
    });
    probe.restoreClock = () => {
      if (descriptor) Object.defineProperty(performance, 'now', descriptor);
      else delete performance.now;
      delete probe.onRender;
    };
    probe.onRender = () => {
      if (heldAt !== null) return;
      window.__EVAL_SCENE__.traverse(node => {
        const original = bodies.find(body => body.name === node.name);
        if (original && node.scale.x > 0 && node.scale.x < original.scale) {
          heldAt = nativeNow();
          probe.partialRetirement = node.scale.x / original.scale;
        }
      });
    };
  }, baseline.bodies);
  try {
    await population(page, []);
    await page.waitForFunction(
      () => window.__EMERGENCE_PROBE__.partialRetirement > 0
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => {
      let remaining = 0;
      window.__EVAL_SCENE__.traverse(node => {
        if (node.name.startsWith('body:') || node.name.startsWith('mark:'))
          remaining++;
      });
      return remaining === 0;
    });
  } finally {
    await page.evaluate(() => window.__EMERGENCE_PROBE__.restoreClock());
  }
  result.phases.push({
    phase: 'reduced-during-retirement',
    ...(await park(page, 'reduced-during-retirement')),
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await park(page, 'ordinary-motion-restored');
  await page.evaluate(bodies => {
    const probe = window.__EMERGENCE_PROBE__;
    probe.onRender = () => {
      window.__EVAL_SCENE__.traverse(node => {
        const original = bodies.find(body => body.name === node.name);
        if (original && node.scale.x > 0 && node.scale.x < original.scale)
          probe.ordinaryArrivalObserved = true;
      });
    };
  }, baseline.bodies);
  await population(page, idle);
  await page.waitForFunction(
    () => window.__EMERGENCE_PROBE__.ordinaryArrivalObserved
  );
  result.phases.push({
    phase: 'ordinary-arrival-after-motion-switch',
    ...(await park(page, 'ordinary-arrival-after-motion-switch')),
  });
  await page.evaluate(() => delete window.__EMERGENCE_PROBE__.onRender);
  checkRestored(await objects(page), baseline);
}

try {
  for (const reduced of [false, true]) {
    const result = { reduced, passed: false, phases: [] };
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      reducedMotion: reduced ? 'reduce' : 'no-preference',
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await primeEvalBrowserPage(page);
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'hardwareConcurrency', {
          get: () => 8,
        })
      );
      await page.goto(`${base}/eval/t5-operations-board?fixture=emergence`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(
        () => window.__EVAL_GL__ && window.__EVAL_SET_BOARD_POPULATION__
      );
      await page.evaluate(() => {
        const gl = window.__EVAL_GL__;
        const render = gl.render.bind(gl);
        window.__EMERGENCE_PROBE__ = { renders: 0, previous: -1, quiet: 0 };
        gl.render = (...args) => {
          window.__EMERGENCE_PROBE__.renders++;
          window.__EMERGENCE_PROBE__.onRender?.();
          return render(...args);
        };
      });
      result.phases.push({
        phase: 'initial',
        ...(await park(page, 'initial')),
      });
      const baseline = await objects(page);
      check(baseline.bodies.length > 0, 'Fixture has no actual Agent bodies');
      const idle = ['one', 'two', 'three'].map(id => ({ id, status: 'idle' }));
      // All pieces depart together: the old active(now) guard misses precisely
      // the final cleanup. Repeat same IDs to exercise callback-ref teardown.
      for (let cycle = 0; cycle < 3; cycle++) {
        await population(page, []);
        result.phases.push({
          phase: `retired-${cycle}`,
          ...(await park(page, `retired-${cycle}`)),
        });
        const gone = await objects(page);
        check(
          gone.bodies.length === 0 && gone.marks.length === 0,
          'Retired Agent bodies or marks remain mounted'
        );
        await population(page, idle);
        result.phases.push({
          phase: `arrived-${cycle}`,
          ...(await park(page, `arrived-${cycle}`)),
        });
        checkRestored(await objects(page), baseline);
      }
      if (!reduced)
        await switchMotionDuringRetirement(page, baseline, idle, result);
      // Active marks legitimately render in the normal-motion regime; their
      // replacement by quiet marks must detach the old rotor callback refs.
      await population(
        page,
        idle.map(entry => ({ ...entry, status: 'working' }))
      );
      if (!reduced) {
        const before = await page.evaluate(
          () => window.__EMERGENCE_PROBE__.renders
        );
        await page.waitForFunction(
          before => window.__EMERGENCE_PROBE__.renders > before + 5,
          before
        );
      }
      await population(page, idle);
      result.phases.push({
        phase: 'status-changed',
        ...(await park(page, 'status-changed')),
      });
      await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
      result.phases.push({
        phase: 'interaction',
        ...(await park(page, 'interaction')),
      });
      await page.screenshot({
        path: join(reportDir, reduced ? 'reduced.png' : 'normal.png'),
      });
      check(errors.length === 0, errors.join('\n'));
      result.passed = true;
    } catch (error) {
      result.error = String(error.message || error);
    } finally {
      await page.close();
    }
    results.push(result);
    console.log(
      `${result.passed ? 'PASS' : 'FAIL'} emergence ${reduced ? 'reduced' : 'normal'}: ${result.error || 'retire, park, reappear, status change, interact'}`
    );
  }
} finally {
  await browser.close();
}
writeFileSync(
  join(reportDir, 'report.json'),
  JSON.stringify({ base, results }, null, 2)
);
process.exit(results.every(result => result.passed) ? 0 : 1);
