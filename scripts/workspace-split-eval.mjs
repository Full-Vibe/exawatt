#!/usr/bin/env node
/**
 * Split-view eval (S2 ⌘D, reworked D26): the pin follows the TAB, not the
 * PTY. Verifies against the live app that
 *   - switching to an EMPTY Project keeps the pinned pane up beside the
 *     empty-Project composer (the reported disappearing-pane bug),
 *   - a ⌘T draft page drives the left side beside the pin,
 *   - the pinned pane SURVIVES its session's exit (retained scrollback +
 *     restore bar stay watched),
 *   - ⌘D on a dead pin unpins (never silently re-pins something else),
 *   - a stopped tab is still pinnable.
 * Requires the dev server (`pnpm dev`, EXA_BASE overrides the port) and a
 * compiled Electron main (`pnpm electron:compile`).
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const OUT = process.env.SPLIT_SCREENSHOT_DIR || '/tmp/exawatt-split-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-split-eval-'));
const emptyProjectDir = mkdtempSync(join(tmpdir(), 'exawatt-split-empty-'));

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

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
  async (app, page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', e =>
      console.log('[pageerror]', String(e.message || e).slice(0, 300))
    );

    await page.locator('[data-workspace-stage]').waitFor();

    // Seed: Project A (/tmp) empty, Project B (fresh dir) empty. The live
    // tab is launched through the real ⌘⌥T path below, not seeded.
    await page.evaluate(
      ({ emptyDir }) =>
        window.electron.workspace.save({
          v: 5,
          lastUsedDir: '/tmp',
          activeDir: '/tmp',
          pinnedTabId: null,
          recentProjects: [],
          projects: [
            {
              dir: '/tmp',
              name: 'Alpha',
              color: '#19E6FF',
              activeTabId: null,
              tabs: [],
            },
            {
              dir: emptyDir,
              name: 'Empty',
              color: '#FFB84D',
              activeTabId: null,
              tabs: [],
            },
          ],
        }),
      { emptyDir: emptyProjectDir }
    );
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('[data-workspace-stage]').waitFor();

    // launch a real shell in Alpha (⌘⌥T), then pin it (⌘D)
    await page.keyboard.press('Meta+Alt+KeyT');
    await page.locator('.terminal-pane .xterm').waitFor();
    await page.keyboard.press('Meta+KeyD');
    await page.locator('[data-pinned]').waitFor();
    check(
      'pin alone renders full (nothing to drive beside it)',
      (await page.locator('.terminal-pane[data-pane="full"]').count()) === 1
    );

    // THE REPORTED BUG: switching to an empty Project must keep the pinned
    // pane up — composer LEFT, watched pane RIGHT.
    await page.keyboard.press('Meta+Alt+Digit2');
    await page.locator('[data-pane="left"] [data-agent-composer]').waitFor();
    check(
      'empty Project: composer drives the left pane',
      (await page.locator('[data-pane="left"] [data-agent-composer]').count()) ===
        1
    );
    check(
      'empty Project: pinned terminal stays watched on the right',
      (await page.locator('.terminal-pane[data-pane="right"]').count()) === 1
    );
    await page.screenshot({ path: join(OUT, 'split-empty-project.png') });

    // back in Alpha, a ⌘T draft page drives the left side beside the pin
    await page.keyboard.press('Meta+Alt+Digit1');
    await page.keyboard.press('Meta+KeyT');
    await page.locator('[data-pane="left"] [data-agent-composer]').waitFor();
    check(
      'draft new-tab page drives the left pane beside the pin',
      (await page.locator('.terminal-pane[data-pane="right"]').count()) === 1
    );
    await page.screenshot({ path: join(OUT, 'split-draft-left.png') });

    // kill the watched session: click into the pinned pane and exit the
    // shell — the pane must SURVIVE with retained scrollback + restore bar
    await page.locator('.terminal-pane[data-pane="right"]').click();
    await page.keyboard.type('exit');
    await page.keyboard.press('Enter');
    await page
      .locator('[data-pane="right"] [data-session-restore]')
      .waitFor({ timeout: 20000 });
    check(
      'pinned pane survives session exit (restore bar on the watched side)',
      (await page.locator('[data-pane="right"] [data-session-restore]').count()) ===
        1
    );
    check(
      'retained scrollback renders in the dead pinned pane',
      (await page.locator('[data-pane="right"] .xterm').count()) === 1
    );
    check(
      'the draft still drives the left side beside the dead pin',
      (await page.locator('[data-pane="left"] [data-agent-composer]').count()) ===
        1
    );
    await page.screenshot({ path: join(OUT, 'split-dead-pin.png') });

    // ⌘D on the dead pin UNPINS — it never silently pins something else
    await page.keyboard.press('Meta+KeyD');
    await page
      .locator('[data-pinned]')
      .waitFor({ state: 'detached', timeout: 5000 });
    check(
      'unpinning collapses to the active tab full-screen',
      (await page.locator('[data-pane="right"]').count()) === 0
    );
    check(
      'dead tab renders full with its restore bar after unpin',
      (await page.locator('[data-pane="full"] [data-session-restore]').count()) ===
        1
    );
    await page.screenshot({ path: join(OUT, 'unpinned-dead-full.png') });

    // a stopped tab is still pinnable (watch a finished agent while driving)
    await page.keyboard.press('Meta+KeyD');
    await page.locator('[data-pinned]').waitFor();
    check(
      'a stopped tab can be pinned again',
      (await page.locator('[data-pinned]').count()) === 1
    );
  },
  { maxMs: 120_000 }
);

console.log(
  failures.length
    ? `\n${failures.length} FAILURE(S)`
    : '\nALL SPLIT CHECKS PASSED'
);
console.log(`screenshots: ${OUT}`);
process.exit(failures.length ? 1 : 0);
