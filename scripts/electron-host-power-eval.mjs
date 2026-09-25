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
      const activeStart = await renderPasses(page, 90);
      const activeEnd = await renderPasses(page, 20);
      assert(
        activeEnd > activeStart,
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
      await event(app, 'on-battery');
      const batteryStart = await renderPasses(page, 90);
      const batteryEnd = await renderPasses(page, 30);
      assert.equal(batteryEnd, batteryStart, 'battery board must park');
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
          activeRenderPasses: activeEnd - activeStart,
          lockedRenderPasses: lockedEnd - lockedStart,
          batteryRenderPasses: batteryEnd - batteryStart,
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
