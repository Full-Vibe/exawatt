#!/usr/bin/env node
import { sampleBoardWorkMotion } from './lib/board-work-motion-eval.mjs';

// Real Electron bridge and Fleet rendering; synthetic events affect only
// this isolated app. Never locks, sleeps, or changes power on the operator's Mac.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

import {
  fleetView,
  fleetViewUrl,
  assertFleetView,
  prepareFleetViewPage,
  runFleetViewMatrix,
} from './lib/fleet-view-eval.mjs';
await runFleetViewMatrix(import.meta.url);

const require = createRequire(import.meta.url);
// Read the native capability independently of the bridge. Electron's macOS
// idle API is notification history, not an initial lock snapshot. A missing
// binary is a packaging/build failure in this gate, not a passing unknown.
const nativeLock =
  process.platform === 'darwin'
    ? require(
        join(process.cwd(), 'dist-electron/native/screen-lock-snapshot.node')
      )
    : null;

const base = process.env.EXA_BASE || 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-electron-host-power-'));
const artifacts = join('/tmp/exawatt-host-power-eval', fleetView);
mkdirSync(artifacts, { recursive: true });

async function renderPasses(page, count) {
  return page.evaluate(
    async ({ ticks, sampler }) => {
      for (let tick = 0; tick < ticks; tick++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      return window.__EVAL_GL__.info.render.frame;
    },
    { ticks: count, sampler: sampleBoardWorkMotion.toString() }
  );
}

/** A refresh this fast can show the economy bound; a starved host's rAF is
 * already slower than the economy timer. */
const HEALTHY_TICK_MS = 30;

/** Painted refreshes, rotor motion and the renderer's resolution over `count`
 * refreshes, so one sample answers both halves of BUG-263. Refreshes that
 * painted are counted, not `render()` calls: a bloom frame makes several. */
async function ambientSample(page, count) {
  return page.evaluate(
    async ({ ticks, sampler }) => {
      const gl = window.__EVAL_GL__;
      const before = new Function(`return (${sampler})()`)();
      const frameStart = gl.info.render.frame;
      const times = [];
      let painted = 0;
      for (let tick = 0; tick < ticks; tick++) {
        const renders = gl.info.render.frame;
        times.push(
          await new Promise(resolve => requestAnimationFrame(resolve))
        );
        if (gl.info.render.frame !== renders) painted += 1;
      }
      const intervals = times
        .slice(1)
        .map((time, index) => time - times[index])
        .sort((a, b) => a - b);
      let moving = 0;
      for (const [node, angle] of before)
        if (node.rotation.z !== angle) moving += 1;
      return {
        renders: gl.info.render.frame - frameStart,
        painted,
        ticks: times.length,
        tickMs: intervals[Math.floor(intervals.length / 2)] ?? null,
        rotors: before.size,
        moving,
        dpr: gl.getPixelRatio(),
      };
    },
    { ticks: count, sampler: sampleBoardWorkMotion.toString() }
  );
}

/** What the board's render policy reads, for a failure message: a parked
 * board is either hidden or told the host is locked or asleep. */
async function renderPolicyInputs(page) {
  return page.evaluate(async () => ({
    visibility: document.visibilityState,
    host: await window.electron.app.hostPower(),
  }));
}

async function event(app, name) {
  await app.evaluate(
    ({ powerMonitor }, eventName) => powerMonitor.emit(eventName),
    name
  );
}

/** The fixed fixture isolates policy. This second pass keeps real Demo ticks live. */
async function liveDemoPower(app, page) {
  await event(app, 'resume');
  await event(app, 'unlock-screen');
  await page.evaluate(async view => {
    localStorage.setItem('exawatt:active-workspace:v1', 'demo');
    await window.electron.settings.updatePresentation({
      field: 'fleetView',
      value: view,
    });
  }, fleetView);
  await page.goto(fleetViewUrl(`${base}/fleet/spatial`), { waitUntil: 'load' });
  await assertFleetView(page);
  await page.waitForFunction(
    () => window.__EVAL_GL__ && document.querySelector('canvas')?.width > 0
  );
  await page.locator('button[aria-label^="Open Project "]').first().click();
  await page.waitForURL(/altitude=project/);
  await event(app, 'on-ac');
  await renderPasses(page, 180);
  const ac = await ambientSample(page, 60);
  assert(
    ac.rotors > 0 && ac.painted > 0,
    `live Demo must render working Agents: ${JSON.stringify({ ac, ...(await renderPolicyInputs(page)) })}`
  );
  await event(app, 'on-battery');
  await renderPasses(page, 90);
  const battery = await ambientSample(page, 60);
  assert(battery.painted > 0, 'live Demo battery policy froze working Agents');
  if (battery.tickMs !== null && battery.tickMs < HEALTHY_TICK_MS) {
    assert(
      battery.painted < battery.ticks,
      'live Demo updates bypassed economy cadence'
    );
  }
  assert.equal(battery.dpr, ac.dpr, 'live Demo battery changed resolution');
  const transmission = await page.evaluate(() => {
    const materials = new Set();
    window.__EVAL_SCENE__.traverse(node => {
      for (const material of [node.material].flat()) {
        if (material?.isMeshPhysicalMaterial) materials.add(material);
      }
    });
    return {
      physicalMaterials: materials.size,
      transmitting: [...materials].filter(material => material.transmission > 0)
        .length,
    };
  });
  if (fleetView === 'v2') {
    assert(
      transmission.physicalMaterials > 0,
      'Project fixture has no physical tile materials'
    );
    assert.equal(
      transmission.transmitting,
      0,
      'battery retained an expensive tile transmission pass'
    );
  }
  await event(app, 'lock-screen');
  const lockedStart = await renderPasses(page, 90);
  // Several actual source ticks cross this window. They may reconcile state,
  // but an unseen canvas must not render them or request ambient frames.
  const lockedEnd = await renderPasses(page, 360);
  assert.equal(
    lockedEnd,
    lockedStart,
    'live Demo updates painted a locked canvas'
  );
  await event(app, 'unlock-screen');
  const unlockedStart = await renderPasses(page, 10);
  assert(
    (await renderPasses(page, 60)) > unlockedStart,
    'live Demo did not wake on unlock'
  );
  await page.screenshot({ path: join(artifacts, 'live-demo-battery.png') });
  await event(app, 'suspend');
  const suspendedStart = await renderPasses(page, 90);
  const suspendedEnd = await renderPasses(page, 360);
  assert.equal(
    suspendedEnd,
    suspendedStart,
    'live Demo updates painted a suspended canvas'
  );
  await event(app, 'resume');
  await event(app, 'unlock-screen');
  return {
    ac,
    battery,
    transmission,
    lockedRenderPasses: lockedEnd - lockedStart,
    suspendedRenderPasses: suspendedEnd - suspendedStart,
  };
}

try {
  await withElectronApp(
    {
      args: ['.'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        EXAWATT_TEST: '1',
        EXAWATT_USER_DATA: userData,
        EXAWATT_DEV_URL: `${base}/eval/t5-operations-board`,
      },
    },
    async (app, page) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (
          message.type() === 'error' &&
          /WebGL|shader|GL_INVALID|context lost/i.test(message.text())
        ) {
          errors.push(message.text());
        }
      });
      await prepareFleetViewPage(page);
      await page.goto(fleetViewUrl(`${base}/eval/t5-operations-board`), {
        waitUntil: 'load',
      });
      await page.waitForFunction(
        () => window.__EVAL_GL__ && document.querySelector('canvas')?.width > 0
      );
      await assertFleetView(page);
      const actual = await app.evaluate(({ powerMonitor }) => ({
        powerSource: powerMonitor.isOnBatteryPower() ? 'battery' : 'ac',
        idle: powerMonitor.getSystemIdleState(1),
      }));
      const initial = await page.evaluate(() =>
        window.electron.app.hostPower()
      );
      const nativeSession = nativeLock?.read();
      // Inspect the native facts independently from the production decoder.
      // A missing lock flag is valid only in a logged-in console session.
      const nativeScreenLock = !nativeLock
        ? undefined
        : nativeSession?.locked === true
          ? 'locked'
          : (nativeSession?.locked === false ||
                nativeSession?.locked === 'absent') &&
              nativeSession.onConsole === true &&
              nativeSession.loginDone === true
            ? 'unlocked'
            : 'unknown';
      assert.equal(initial.powerSource, actual.powerSource);
      assert.equal(
        initial.screenLock,
        nativeScreenLock ??
          (actual.idle === 'locked'
            ? 'locked'
            : actual.idle === 'unknown'
              ? 'unknown'
              : 'unlocked')
      );
      if (process.env.EXAWATT_EVAL_EXPECT_SCREEN_LOCK) {
        assert.equal(
          initial.screenLock,
          process.env.EXAWATT_EVAL_EXPECT_SCREEN_LOCK,
          'initial bridge state must match the independently confirmed host state'
        );
      }
      let initialParkedRenderPasses = null;
      let initialAmbient = null;
      if (initial.screenLock !== 'unlocked') {
        const parkedStart = await renderPasses(page, 90);
        initialParkedRenderPasses =
          (await renderPasses(page, 90)) - parkedStart;
        assert.equal(
          initialParkedRenderPasses,
          0,
          'a locked or unknown startup must not animate before any synthetic event'
        );
      }
      if (initial.screenLock === 'unlocked') {
        await renderPasses(page, 90);
        initialAmbient = await ambientSample(page, 30);
        assert(
          initialAmbient.rotors > 0 && initialAmbient.moving > 0,
          'an unlocked startup must animate before any synthetic event'
        );
      }
      await event(app, 'on-ac');
      await event(app, 'unlock-screen');
      await renderPasses(page, 90);
      const ac = await ambientSample(page, 30);
      assert(ac.rotors > 0, 'fixture has no working rotors');
      assert.equal(
        ac.moving,
        ac.rotors,
        'AC/unlocked board must turn every working rotor'
      );
      assert(
        ac.painted > 0,
        'AC/unlocked board must animate active Agent marks'
      );
      await event(app, 'lock-screen');
      const lockedStart = await renderPasses(page, 90);
      const lockedEnd = await renderPasses(page, 30);
      assert.equal(lockedEnd, lockedStart, 'locked board must park');
      await event(app, 'unlock-screen');
      const unlockedStart = await renderPasses(page, 10);
      assert(
        (await renderPasses(page, 20)) > unlockedStart,
        'unlock must resume ambient rendering'
      );
      // BUG-263: battery is a cadence, never a freeze or a resolution drop.
      // The 2026-09-25 parking reused the weak-hardware path, which also
      // capped dpr at 1.25: the board went soft and every rotor stopped.
      await event(app, 'on-battery');
      await renderPasses(page, 90);
      const battery = await ambientSample(page, 30);
      assert.equal(
        battery.moving,
        battery.rotors,
        'battery must keep every working rotor turning'
      );
      assert(battery.painted > 0, 'battery board must still paint');
      if (battery.tickMs !== null && battery.tickMs < HEALTHY_TICK_MS) {
        assert(
          battery.painted < battery.ticks,
          `battery painted ${battery.painted} of ${battery.ticks} refreshes; economy cadence must bound ambient frames`
        );
      }
      assert.equal(
        battery.dpr,
        ac.dpr,
        'battery must not change the board resolution'
      );
      await page.screenshot({ path: join(artifacts, 'battery-board.png') });
      await event(app, 'on-ac');
      const acStart = await renderPasses(page, 10);
      assert(
        (await renderPasses(page, 20)) > acStart,
        'AC must restore ambient rendering'
      );
      await page.screenshot({ path: join(artifacts, 'ac-board.png') });
      await event(app, 'suspend');
      const suspendedStart = await renderPasses(page, 90);
      assert.equal(
        await renderPasses(page, 30),
        suspendedStart,
        'suspended host must park'
      );
      await event(app, 'resume');
      const resumed = await page.evaluate(() =>
        window.electron.app.hostPower()
      );
      assert.equal(resumed.systemSleep, 'awake');
      const resumedPower = await app.evaluate(({ powerMonitor }) =>
        powerMonitor.isOnBatteryPower() ? 'battery' : 'ac'
      );
      assert.equal(
        resumed.powerSource,
        resumedPower,
        'resume refreshes real power source'
      );
      const liveDemo = await liveDemoPower(app, page);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          result: 'pass',
          initial,
          nativeSession,
          nativeScreenLock,
          initialAmbient,
          electronIdle: actual.idle,
          initialParkedRenderPasses,
          liveDemo,
          ac,
          lockedRenderPasses: lockedEnd - lockedStart,
          battery,
          evidence:
            'real initial native read; synthetic powerMonitor events through main/preload to real Fleet canvas',
          artifacts,
        })
      );
    },
    { maxMs: 150_000 }
  );
} finally {
  rmSync(userData, { recursive: true, force: true });
}
