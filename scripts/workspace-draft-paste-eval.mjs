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
 *
 * Every wait is for an effect (BUG-221). Pastes are counted in the PTY's
 * INPUT, recorded by the process reading it, never in terminal output: a
 * shell redraw, an echo, or a prompt repaint can print a pasted string twice,
 * and a count of what the terminal shows then fails a paste that happened
 * once.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  seedWorkspaceLayout,
  waitForWorkspaceReady,
  withElectronApp,
} from './lib/electron-eval.mjs';

const OUT = process.env.DRAFT_SCREENSHOT_DIR || '/tmp/exawatt-draft-eval';
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'exawatt-draft-eval-'));
const emptyProjectDir = mkdtempSync(join(tmpdir(), 'exawatt-draft-empty-'));
const inputLog = join(
  mkdtempSync(join(tmpdir(), 'exawatt-draft-input-')),
  'pty-input.log'
);

const ALPHA = '/tmp';
const DRAFT_TEXT = 'Half-written brief: overhaul the intake flow end to end';
const PASTE_ONE = 'EXAWATT_PASTE_ONCE_4821';
const PASTE_TWO = 'EXAWATT_MENU_PASTE_9317';
const AFTER_ONE = 'EXAWATT_AFTER_KEY_PASTE_0512';
const AFTER_TWO = 'EXAWATT_AFTER_MENU_PASTE_7760';

const failures = [];
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) failures.push(name);
};

/** Resolve with `read()`'s first truthy value; the effect decides, and the
 *  deadline only names a wait that never ends. */
async function until(read, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) {
      throw new Error(`TIMED OUT after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

const recorded = () =>
  existsSync(inputLog) ? readFileSync(inputLog, 'utf8') : '';
const occurrences = (text, marker) => text.split(marker).length - 1;

// Alpha (/tmp) and Empty, both without tabs: the layout this launch restores.
seedWorkspaceLayout(userData, {
  v: 5,
  lastUsedDir: ALPHA,
  activeDir: ALPHA,
  pinnedTabId: null,
  recentProjects: [],
  projects: [
    {
      dir: ALPHA,
      name: 'Alpha',
      color: '#19E6FF',
      activeTabId: null,
      tabs: [],
    },
    {
      dir: emptyProjectDir,
      name: 'Empty',
      color: '#FFB84D',
      activeTabId: null,
      tabs: [],
    },
  ],
});

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

const alphaTab = attributes =>
  `[data-tab-id][data-project-parent="${ALPHA}"]${attributes}`;

await withElectronApp(
  launchOpts,
  async (app, page) => {
    page.setDefaultTimeout(15000);
    page.on('pageerror', e =>
      console.log('[pageerror]', String(e.message || e).slice(0, 300))
    );

    await waitForWorkspaceReady(page);

    // real shell in Alpha (⌘⌥T; ⌘⇧T is browser-style reopen)
    await page.keyboard.press('Meta+Alt+KeyT');
    await page.locator('.terminal-pane .xterm').waitFor();
    const sessionId = await page.evaluate(async () => {
      const sessions = await window.electron?.pty?.list();
      if (sessions?.length !== 1) {
        throw new Error(`expected one session; got ${sessions?.length ?? 0}`);
      }
      return sessions[0].id;
    });
    await until(
      async () =>
        (await page.evaluate(id => window.electron.pty.buffer(id), sessionId))
          ?.length > 0,
      'the shell to print its prompt'
    );

    // Hand the PTY to a recorder: with echo and line buffering off, `cat`
    // receives each byte written to the PTY once, as it arrives, and appends
    // it to a file no redraw can reach. The file appears when the shell has
    // run the redirection, which is when input starts reaching `cat`.
    const textarea = page.locator('.xterm-helper-textarea');
    await textarea.focus();
    await page.keyboard.type(`stty -echo -icanon && cat > '${inputLog}'`);
    await page.keyboard.press('Enter');
    await until(() => existsSync(inputLog), 'the PTY input recorder to start');

    /** Everything the renderer wrote before `after` has reached the PTY once
     *  `after` has: writes from one renderer reach main in order, and a text
     *  paste writes in the same task that receives it. */
    const inputThrough = async after => {
      await page.evaluate(
        ({ id, data }) => window.electron.pty.write(id, data),
        { id: sessionId, data: after }
      );
      return until(
        () => (recorded().includes(after) ? recorded() : null),
        `${after} to reach the PTY`
      );
    };

    // ⌘V: exactly one write, and the keydown is CONSUMED (defaultPrevented
    // observed after xterm's handler ran) so the menu role can never
    // re-fire it — the root of the reported double paste
    await page.evaluate(() => {
      window.__pasteKeydownPrevented = null;
      window.addEventListener('keydown', e => {
        if (e.key.toLowerCase() === 'v' && e.metaKey) {
          window.__pasteKeydownPrevented = e.defaultPrevented;
        }
      });
    });
    await app.evaluate(({ clipboard }, v) => clipboard.writeText(v), PASTE_ONE);
    await textarea.focus();
    await textarea.press('Meta+v');
    await until(() => recorded().includes(PASTE_ONE), '⌘V to reach the PTY');
    check(
      '⌘V pastes exactly once',
      occurrences(await inputThrough(AFTER_ONE), PASTE_ONE) === 1
    );
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
    await until(
      () => recorded().includes(PASTE_TWO),
      'the menu paste to reach the PTY'
    );
    check(
      'menu-driven paste funnels through one write',
      occurrences(await inputThrough(AFTER_TWO), PASTE_TWO) === 1
    );

    // An EMPTY draft in another Project, opened BEFORE the Alpha draft gets
    // its text: the save that carries that text serializes this draft too,
    // so reading that save proves what happened to it.
    await page.keyboard.press('Meta+Alt+Digit2');
    await page.keyboard.press('Meta+KeyT');
    await page
      .locator(
        `[data-tab-id][data-project-parent="${emptyProjectDir}"][data-tab-lifecycle="draft"]`
      )
      .waitFor();

    // ⌘T draft in Alpha: type, switch away, switch back — the work must remain
    await page.keyboard.press('Meta+Alt+Digit1');
    await page.keyboard.press('Meta+KeyT');
    const alphaDraft = page.locator(alphaTab('[data-tab-lifecycle="draft"]'));
    // the new draft is Alpha's and is the active tab, so the composer below is
    // the one this step types into
    await page
      .locator(alphaTab('[data-tab-lifecycle="draft"][data-active]'))
      .waitFor();
    const draftTask = page.locator('[data-agent-composer] textarea');
    await draftTask.waitFor();
    await draftTask.fill(DRAFT_TEXT);
    await page.locator(alphaTab('[data-tab-harness="shell"]')).click();
    await page.locator('.terminal-pane[data-pane="full"]').waitFor();
    check(
      'composer unmounts while its tab is inactive',
      (await page.locator('[data-agent-composer]').count()) === 0
    );
    await alphaDraft.click();
    await draftTask.waitFor();
    check(
      'draft text survives switching tabs away and back',
      (await draftTask.inputValue()) === DRAFT_TEXT
    );
    await page.screenshot({ path: join(OUT, 'draft-survives-switch.png') });

    // The first save that carries the Alpha draft's text is also a save of
    // the Empty Project after its draft opened, so it answers both checks.
    const persisted = await until(async () => {
      const layout = await page.evaluate(() =>
        window.electron.workspace.load()
      );
      const alpha = layout?.projects.find(p => p.dir === ALPHA);
      return alpha?.tabs.some(
        t => t.lifecycle === 'draft' && t.draftTask === DRAFT_TEXT
      )
        ? layout
        : null;
    }, 'the saved layout to carry the Alpha draft').catch(error => {
      console.log(`[draft] ${error.message}`);
      return null;
    });
    check('content-bearing draft persists with its text', persisted !== null);
    const emptyTabs =
      persisted?.projects.find(p => p.dir === emptyProjectDir)?.tabs ?? [];
    check(
      'empty draft is not persisted',
      persisted !== null && !emptyTabs.some(t => t.lifecycle === 'draft')
    );
  },
  { maxMs: 120_000 }
);

// relaunch with the SAME userData: the typed draft must restore whole
await withElectronApp(
  launchOpts,
  async (_app, page) => {
    page.setDefaultTimeout(15000);
    await waitForWorkspaceReady(page);
    // land on Alpha and open its restored draft tile
    await page.keyboard.press('Meta+Alt+Digit1');
    await page.locator(alphaTab('[data-tab-lifecycle="draft"]')).click();
    const draftTask = page.locator('[data-agent-composer] textarea');
    await draftTask.waitFor();
    check(
      'draft text survives an app relaunch',
      (await draftTask.inputValue()) === DRAFT_TEXT
    );
    check(
      'the empty draft vanished with the previous run',
      (await page
        .locator('[data-tab-id][data-tab-lifecycle="draft"]')
        .count()) === 1
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
