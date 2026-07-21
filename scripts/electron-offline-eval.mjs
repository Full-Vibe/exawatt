#!/usr/bin/env node
/**
 * Offline-authority eval (ENG-016 D18): with every non-loopback request dead
 * (airplane mode with the local renderer server still alive), the command
 * altitudes must stay fully navigable — ⌃⌘1 Terminal, ⌃⌘2 Sessions,
 * ⌃⌘3 Spatial and back — with no black screen and no hung transition.
 *
 * The server-side half of the guarantee (the middleware never touches the
 * network for public paths) is unit-tested in src/proxy.test.ts; this eval
 * proves the packaged navigation loop end to end from the renderer side.
 *
 * Requires the dev server (`pnpm dev`) and a compiled Electron main
 * (`pnpm electron:compile`), like the spine eval.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const OUT = process.env.OFFLINE_SCREENSHOT_DIR || '/tmp/exawatt-offline-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-offline-eval-'));

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
    },
  },
  async (_app, page) => {
    page.setDefaultTimeout(15000);
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e.message || e)));

    // Airplane mode: only the loopback renderer server survives. Abort with
    // an internet-disconnected error so client code sees a real offline
    // failure, not a silent stall.
    let blockedRequests = 0;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (
        LOOPBACK.has(url.hostname) ||
        url.protocol === 'devtools:' ||
        url.protocol === 'chrome-extension:'
      ) {
        return route.continue();
      }
      blockedRequests += 1;
      return route.abort('internetdisconnected');
    });

    await page.waitForSelector('#site-header');
    await page.waitForURL('**/workspace**');

    /** the screen counts as alive when the chrome renders AND some visible
     *  text exists — a black unmounted root has neither */
    const alive = async () => {
      const headerVisible = await page
        .locator('#site-header')
        .isVisible()
        .catch(() => false);
      const text = await page.evaluate(() => document.body.innerText.trim());
      return headerVisible && text.length > 0;
    };

    check('workspace renders offline', await alive());
    await page.screenshot({ path: join(OUT, '1-terminal.png') });

    // ⌃⌘2 — Sessions. THE flight bug: this navigation black-screened.
    await page.keyboard.press('Control+Meta+2');
    await page.waitForURL('**view=sessions**', { timeout: 10000 });
    await page.waitForTimeout(400);
    check('⌃⌘2 reaches Sessions offline', await alive());
    await page.screenshot({ path: join(OUT, '2-sessions.png') });

    // ⌃⌘3 — Spatial (R3F chunk loads from the local server).
    await page.keyboard.press('Control+Meta+3');
    await page.waitForURL('**/fleet/spatial**', { timeout: 10000 });
    await page.waitForTimeout(800);
    check('⌃⌘3 reaches Spatial offline', await alive());
    await page.screenshot({ path: join(OUT, '3-spatial.png') });

    // ⌃⌘1 — back to Terminal.
    await page.keyboard.press('Control+Meta+1');
    await page.waitForURL(
      url => url.pathname === '/workspace' && !url.href.includes('view='),
      { timeout: 10000 }
    );
    await page.waitForTimeout(400);
    check('⌃⌘1 returns to Terminal offline', await alive());
    await page.screenshot({ path: join(OUT, '4-terminal-again.png') });

    // A second full loop proves the cycle is repeatable, not a one-shot.
    await page.keyboard.press('Control+Meta+2');
    await page.waitForURL('**view=sessions**', { timeout: 10000 });
    await page.keyboard.press('Control+Meta+1');
    await page.waitForURL(
      url => url.pathname === '/workspace' && !url.href.includes('view='),
      { timeout: 10000 }
    );
    check('second offline altitude loop completes', await alive());

    const fatal = pageErrors.filter(
      e => !/Failed to fetch|NetworkError|ERR_INTERNET_DISCONNECTED/i.test(e)
    );
    check(`no fatal page errors (saw: ${fatal.slice(0, 3).join(' | ') || 'none'})`, fatal.length === 0);
    console.log(
      `[info] blocked ${blockedRequests} non-loopback request(s) during the run`
    );
  },
  { maxMs: 120_000 }
);

if (failures.length > 0) {
  console.error(`\nOFFLINE EVAL FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log('\nOFFLINE EVAL PASSED');
