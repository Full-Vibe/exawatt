#!/usr/bin/env node
/**
 * Draft durability + single-funnel paste eval (D28). Verifies against the
 * live app that
 *   - terminal ⌘V writes the clipboard to the PTY exactly ONCE and CONSUMES
 *     the key event (an unconsumed ⌘V is what let the Edit ▸ Paste menu
 *     role fire a second paste),
 *   - a menu-driven paste (webContents.paste(), what Edit ▸ Paste sends)
 *     funnels through the same single image-aware write — once,
 *   - text typed into a ⌘T draft composer survives switching tabs away and
 *     back,
 *   - a draft WITH content persists and restores across an app relaunch,
 *     while an EMPTY draft vanishes with the run.
 * Requires the dev server (`pnpm dev`, EXA_BASE overrides the port) and a
 * compiled Electron main (`pnpm electron:compile`).
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const OUT = process.env.DRAFT_SCREENSHOT_DIR || '/tmp/exawatt-draft-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-draft-eval-'));
const emptyProjectDir = mkdtempSync(join(tmpdir(), 'exawatt-draft-empty-'));

const DRAFT_TEXT = 'Half-written brief: overhaul the intake flow end to end';
const PASTE_ONE = 'EXAWATT_PASTE_ONCE_4821';
const PASTE_TWO = 'EXAWATT_MENU_PASTE_9317';

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

const launchOpts = {
  args: ['.'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'development',
    EXAWATT_TEST: '1',
    EXAWATT_USER_DATA: userData,
    EXAWATT_DEV_URL: `${process.env.EXA_BASE ?? 'http://localhost:7000'}/workspace`,
  },
};

await withElectronApp(
  launchOpts,
  async (app, page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', e =>
      console.log('[pageerror]', String(e.message || e).slice(0, 300))
    );

    await page.locator('[data-workspace-stage]').waitFor();
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

    // real shell in Alpha (⌘⇧T)
    await page.keyboard.press('Meta+Shift+KeyT');
    await page.locator('.terminal-pane .xterm').waitFor();
    const sessionId = await page.evaluate(async () => {
      const sessions = await window.electron?.pty?.list();
      if (sessions?.length !== 1) {
        throw new Error(`expected one session; got ${sessions?.length ?? 0}`);
      }
      return sessions[0].id;
    });
    await page.waitForTimeout(1500);

    // park the shell inside `cat`: canonical-mode echo prints pasted input
    // back exactly once, with no interactive-shell redraw noise to distort
    // the occurrence count
    const textarea = page.locator('.xterm-helper-textarea');
    await textarea.focus();
    await page.keyboard.type('cat');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const countInBuffer = (marker) =>
      page.evaluate(async ({ id, m }) => {
        const buffer = await window.electron.pty.buffer(id);
        return buffer.split(m).length - 1;
      }, { id: sessionId, m: marker });

    // ⌘V: exactly one write, and the keydown is CONSUMED (defaultPrevented
    // observed after xterm's handler ran) so the menu role can never
    // re-fire it — the root of the reported double paste
    await page.evaluate(() => {
      window.__pasteKeydownPrevented = null;
      window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'v' && e.metaKey) {
          window.__pasteKeydownPrevented = e.defaultPrevented;
        }
      });
    });
    await app.evaluate(({ clipboard }, v) => clipboard.writeText(v), PASTE_ONE);
    await textarea.focus();
    await textarea.press('Meta+v');
    await page.waitForFunction(async ({ id, m }) => {
      const buffer = await window.electron.pty.buffer(id);
      return buffer.includes(m);
    }, { id: sessionId, m: PASTE_ONE });
    await page.waitForTimeout(750);
    check('⌘V pastes exactly once', (await countInBuffer(PASTE_ONE)) === 1);
    check(
      '⌘V keydown is consumed (menu role cannot double-fire)',
      await page.evaluate(() => window.__pasteKeydownPrevented === true)
    );

    // Edit ▸ Paste path: webContents.paste() lands as a DOM paste event and
    // must funnel through the SAME single image-aware write
    await app.evaluate(({ clipboard }, v) => clipboard.writeText(v), PASTE_TWO);
    await textarea.focus();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.paste();
    });
    await page.waitForFunction(async ({ id, m }) => {
      const buffer = await window.electron.pty.buffer(id);
      return buffer.includes(m);
    }, { id: sessionId, m: PASTE_TWO });
    await page.waitForTimeout(750);
    check(
      'menu-driven paste funnels through one write',
      (await countInBuffer(PASTE_TWO)) === 1
    );

    // ⌘T draft: type, switch away, switch back — the work must remain
    await page.keyboard.press('Meta+KeyT');
    const draftTask = page.locator('[data-agent-composer] textarea');
    await draftTask.waitFor();
    await draftTask.fill(DRAFT_TEXT);
    await page.locator('[data-tab-id]').first().click();
    await page.locator('.terminal-pane[data-pane="full"]').waitFor();
    check(
      'composer unmounts while its tab is inactive',
      (await page.locator('[data-agent-composer]').count()) === 0
    );
    await page.locator('[data-tab-id]').nth(1).click();
    await draftTask.waitFor();
    check(
      'draft text survives switching tabs away and back',
      (await draftTask.inputValue()) === DRAFT_TEXT
    );
    await page.screenshot({ path: join(OUT, 'draft-survives-switch.png') });

    // an EMPTY draft in another Project must NOT persist
    await page.keyboard.press('Meta+Alt+Digit2');
    await page.keyboard.press('Meta+KeyT');
    await page.locator('[data-agent-composer] textarea').waitFor();
    await page.waitForTimeout(900); // debounced layout save
    const persisted = await page.evaluate(() =>
      window.electron.workspace.load()
    );
    const alphaTabs = persisted.projects.find(p => p.dir === '/tmp')?.tabs ?? [];
    const emptyTabs =
      persisted.projects.find(p => p.name === 'Empty')?.tabs ?? [];
    check(
      'content-bearing draft persists with its text',
      alphaTabs.some(
        t => t.lifecycle === 'draft' && t.draftTask === DRAFT_TEXT
      )
    );
    check(
      'empty draft is not persisted',
      !emptyTabs.some(t => t.lifecycle === 'draft')
    );
  },
  { maxMs: 120_000 }
);

// relaunch with the SAME userData: the typed draft must restore whole
await withElectronApp(
  launchOpts,
  async (_app, page) => {
    page.setDefaultTimeout(15000);
    await page.locator('[data-workspace-stage]').waitFor();
    // land on Alpha and open its restored draft tile
    await page.keyboard.press('Meta+Alt+Digit1');
    await page.getByText('New agent', { exact: true }).click();
    const draftTask = page.locator('[data-agent-composer] textarea');
    await draftTask.waitFor();
    check(
      'draft text survives an app relaunch',
      (await draftTask.inputValue()) === DRAFT_TEXT
    );
    check(
      'the empty draft vanished with the previous run',
      (await page.getByText('New agent', { exact: true }).count()) === 1
    );
    await page.screenshot({ path: join(OUT, 'draft-survives-relaunch.png') });
  },
  { maxMs: 90_000 }
);

if (failures.length > 0) {
  console.error(`FAIL workspace draft+paste eval: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('PASS workspace draft+paste eval');
