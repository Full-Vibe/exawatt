#!/usr/bin/env node

// Real Electron bridge and Fleet rendering; synthetic events affect only
// this isolated app. Never locks, sleeps, or changes power on the operator's Mac.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const base = process.env.EXA_BASE || 'http://localhost:7000';
const userData = mkdtempSync(join(tmpdir(), 'exawatt-electron-host-power-'));
const artifacts = '/tmp/exawatt-host-power-eval';
mkdirSync(artifacts, { recursive: true });

async function renderPasses(page, count) {
  return page.evaluate(async ticks => {
    for (let tick = 0; tick < ticks; tick++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return window.__EVAL_GL__.info.render.frame;
  }, count);
}

/** A refresh this fast can show the economy bound; a starved host's rAF is
 * already slower than the economy timer. */
const HEALTHY_TICK_MS = 30;

/** Painted refreshes, rotor motion and the renderer's resolution over `count`
 * refreshes, so one sample answers both halves of BUG-263. Refreshes that
 * painted are counted, not `render()` calls: a bloom frame makes several. */
async function ambientSample(page, count) {
  return page.evaluate(async ticks => {
    const gl = window.__EVAL_GL__;
    const before = new Map();
    window.__EVAL_SCENE__.traverse(node => {
      if (
        node.name.startsWith('mark:') &&
        node.parent?.geometry?.parameters?.thetaLength === Math.PI
      )
        before.set(node, node.rotation.z);
    });
    const frameStart = gl.info.render.frame;
    const times = [];
    let painted = 0;
    for (let tick = 0; tick < ticks; tick++) {
      const renders = gl.info.render.frame;
      times.push(await new Promise(resolve => requestAnimationFrame(resolve)));
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
  }, count);
}

async function event(app, name) {
  await app.evaluate(
    ({ powerMonitor }, eventName) => powerMonitor.emit(eventName),
    name
  );
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
      await page.goto(`${base}/eval/t5-operations-board`, {
        waitUntil: 'load',
      });
      await page.waitForFunction(
        () => window.__EVAL_GL__ && document.querySelector('canvas')?.width > 0
      );
      const actual = await app.evaluate(({ powerMonitor }) => ({
        powerSource: powerMonitor.isOnBatteryPower() ? 'battery' : 'ac',
        idle: powerMonitor.getSystemIdleState(1),
      }));
      const initial = await page.evaluate(() =>
        window.electron.app.hostPower()
      );
      assert.equal(initial.powerSource, actual.powerSource);
      assert.equal(
        initial.screenLock,
        actual.idle === 'locked'
          ? 'locked'
          : actual.idle === 'unknown'
            ? 'unknown'
            : 'unlocked'
      );
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
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          result: 'pass',
          initial,
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
