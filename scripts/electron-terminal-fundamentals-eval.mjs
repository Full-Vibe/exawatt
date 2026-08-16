#!/usr/bin/env node
/**
 * Terminal fundamentals eval — the live-app gate for the Session surface.
 *
 * Covers, in one launch:
 *   1. scrollback + search over 20k lines, context copy, text and image paste;
 *   2. the GEOMETRY contract (BUG-019): the pane's declared inset, the column
 *      count it reports, the pixels it paints, and the PTY's window size are
 *      four descriptions of one width and must agree. An inset that bought
 *      itself room by clipping the last column would pass a screenshot and
 *      corrupt every full-width redraw inside the Session, so this asserts
 *      painted-vs-reported, not appearance;
 *   3. the LINK INTERACTION BOUNDARY (BUG-004): target recognition for both
 *      plain text and OSC 8 hyperlinks, left-click dispatch, and context-menu
 *      copy — plus the absence of xterm's unclaimed "Do you want to navigate"
 *      default, which was the original report.
 *
 * Runs against THIS worktree's dev server through `withElectronApp` (never
 * `timeout`, which orphans the Electron tree — see `lib/electron-eval.mjs`):
 *   pnpm dev -p 7031
 *   EXA_BASE=http://localhost:7031 pnpm eval:electron:terminal
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openShellFromLauncher, withElectronApp } from './lib/electron-eval.mjs';

const userData = mkdtempSync(join(tmpdir(), 'exawatt-terminal-eval-'));
const BASE = process.env.EXA_BASE ?? 'http://localhost:7000';

/** Deliberately absent from disk: opening them must FAIL visibly, never open
 *  anything on the operator's machine or steal his focus. */
const MISSING_RELATIVE = 'docs/exawatt-eval-missing-4c1d.md';
const MISSING_ABSOLUTE = '/tmp/exawatt-eval-missing-8f2a.txt';
const EVAL_URL = 'https://exawatt.ai/eval-link-4c1d';

const failures = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures.push(name);
};

/** Buffer row/column of a token currently in the viewport. */
async function locateToken(page, sessionId, token) {
  return page.evaluate(
    ({ id, needle }) => {
      const term = window.__XTERMS__?.[id];
      if (!term) throw new Error('terminal handle is not exposed');
      const buffer = term.buffer.active;
      for (let row = 0; row < term.rows; row += 1) {
        const line = buffer.getLine(buffer.viewportY + row);
        const text = line?.translateToString(true) ?? '';
        const column = text.indexOf(needle);
        if (column >= 0) return { row, column };
      }
      return null;
    },
    { id: sessionId, needle: token }
  );
}

/** Viewport pixel at the middle of a token's first cells. */
async function pointFor(page, position, length) {
  return page.evaluate(
    ({ row, column, len }) => {
      const pane = document.querySelector('.terminal-pane');
      const screen = pane?.querySelector('.xterm-screen');
      if (!pane || !screen) throw new Error('terminal pane is not mounted');
      const rect = screen.getBoundingClientRect();
      const cols = Number(pane.dataset.terminalCols);
      const rows = Number(pane.dataset.terminalRows);
      if (!cols || !rows) {
        throw new Error(
          'the pane publishes no geometry — data-terminal-cols/rows missing'
        );
      }
      const cellWidth = rect.width / cols;
      const cellHeight = rect.height / rows;
      return {
        x: rect.left + (column + Math.min(len, 4) / 2) * cellWidth,
        y: rect.top + (row + 0.5) * cellHeight,
      };
    },
    { row: position.row, column: position.column, len: length }
  );
}

async function hoverToken(page, sessionId, token) {
  const position = await locateToken(page, sessionId, token);
  if (!position) throw new Error(`token never reached the viewport: ${token}`);
  const point = await pointFor(page, position, token.length);
  // park elsewhere first: the linkifier only re-resolves on a CELL change
  await page.mouse.move(point.x, point.y + 60);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(150);
  return point;
}

const linkHovered = page =>
  page.evaluate(
    () =>
      !!document.querySelector('.terminal-pane .xterm-cursor-pointer') ||
      !!document.querySelector('.terminal-pane .xterm.xterm-cursor-pointer')
  );

await withElectronApp(
  {
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'development',
      EXAWATT_TEST: '1',
      EXAWATT_USER_DATA: userData,
      EXAWATT_DEV_URL: `${BASE}/workspace`,
    },
  },
  async (app, page) => {
    page.setDefaultTimeout(30_000);
    await page.locator('[data-command-altitude]').waitFor();
    // xterm's OSC 8 default pops `confirm('Do you want to navigate to …')`
    // and then a `window.open()` Electron denies. Record instead of block so
    // the assertion is "the dialog never happened", not a hung eval.
    await page.evaluate(() => {
      window.__confirmCalls = [];
      window.confirm = message => {
        window.__confirmCalls.push(String(message));
        return true;
      };
    });
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('exawatt:open-project', { detail: '/tmp' })
      );
    });
    await page.locator('[data-agent-composer]').waitFor();
    await openShellFromLauncher(page);
    const textarea = page.locator('.xterm-helper-textarea');
    await textarea.waitFor();

    const sessionId = await page.evaluate(async () => {
      const sessions = await window.electron?.pty?.list();
      if (sessions?.length !== 1) {
        throw new Error(
          `Expected one terminal session; got ${sessions?.length ?? 0}`
        );
      }
      return sessions[0].id;
    });
    await page.waitForTimeout(2_000);

    // ── 1. geometry contract ────────────────────────────────────────────
    // The shell's own idea of its width, read through the PTY, is the
    // independent oracle: nothing in the renderer can talk it into agreeing.
    await page.evaluate(
      async id =>
        window.electron?.pty?.write(
          id,
          "stty size | sed 's/^/EXAWATT_STTY=/'\n"
        ),
      sessionId
    );
    let shellSize = null;
    for (let attempt = 0; attempt < 40 && !shellSize; attempt += 1) {
      const buffer = await page.evaluate(
        async id => window.electron?.pty?.buffer(id),
        sessionId
      );
      // the echoed command carries the literal too — take the LAST match
      const matches = [
        ...(buffer ?? '').matchAll(/EXAWATT_STTY=(\d+)\s+(\d+)/g),
      ];
      const last = matches.at(-1);
      if (last) shellSize = { rows: Number(last[1]), cols: Number(last[2]) };
      else await page.waitForTimeout(250);
    }

    const geometry = await page.evaluate(async id => {
      const pane = document.querySelector('.terminal-pane');
      const xterm = pane?.querySelector('.xterm');
      const screen = pane?.querySelector('.xterm-screen');
      if (!pane || !xterm || !screen) throw new Error('pane is not mounted');
      const paneRect = pane.getBoundingClientRect();
      const screenRect = screen.getBoundingClientRect();
      const style = getComputedStyle(xterm);
      const sessions = await window.electron?.pty?.list();
      const session = sessions?.find(entry => entry.id === id);
      return {
        insetX: Number(pane.dataset.terminalInsetX),
        insetY: Number(pane.dataset.terminalInsetY),
        reportedCols: Number(pane.dataset.terminalCols),
        reportedRows: Number(pane.dataset.terminalRows),
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        paddingTop: Number.parseFloat(style.paddingTop),
        paneLeft: paneRect.left,
        paneRight: paneRect.right,
        paneTop: paneRect.top,
        paneWidth: paneRect.width,
        screenLeft: screenRect.left,
        screenRight: screenRect.right,
        screenTop: screenRect.top,
        screenWidth: screenRect.width,
        ptyCols: session?.cols ?? null,
        ptyRows: session?.rows ?? null,
      };
    }, sessionId);

    const cellWidth = geometry.screenWidth / geometry.reportedCols;
    const insetViewport = geometry.paneWidth - geometry.insetX * 2;
    check(
      'the pane declares a real inset and the fit addon can see it',
      geometry.insetX > 0 &&
        Math.abs(geometry.paddingLeft - geometry.insetX) < 0.5 &&
        Math.abs(geometry.paddingRight - geometry.insetX) < 0.5,
      JSON.stringify(geometry)
    );
    check(
      'live terminal content is inset from the app boundary',
      geometry.screenLeft - geometry.paneLeft >= geometry.insetX - 0.5 &&
        geometry.screenTop - geometry.paneTop >= geometry.insetY - 0.5,
      `left gutter ${geometry.screenLeft - geometry.paneLeft}px, top gutter ${geometry.screenTop - geometry.paneTop}px`
    );
    check(
      'no painted column is clipped by the inset',
      geometry.screenRight <= geometry.paneRight + 0.5 &&
        geometry.screenWidth > 0,
      `screen right ${geometry.screenRight} vs pane right ${geometry.paneRight}`
    );
    // painted width = cols x cell. What remains of the inset viewport is the
    // scrollbar gutter plus at most one cell that could not fit — never a
    // whole column the operator paid for and cannot see.
    const leftover = insetViewport - geometry.screenWidth;
    check(
      'reported columns are the most that FIT inside the inset viewport',
      leftover >= 13.5 && leftover < 14 + cellWidth + 0.5,
      `painted ${geometry.screenWidth}px of ${insetViewport}px, ${leftover}px spare at ${cellWidth}px/cell`
    );
    check(
      'the PTY window size equals the reported geometry',
      geometry.ptyCols === geometry.reportedCols &&
        geometry.ptyRows === geometry.reportedRows,
      `pty ${geometry.ptyCols}x${geometry.ptyRows} vs reported ${geometry.reportedCols}x${geometry.reportedRows}`
    );
    check(
      'the shell inside the Session agrees about its own width',
      !!shellSize && shellSize.cols === geometry.reportedCols,
      `stty ${JSON.stringify(shellSize)} vs reported ${geometry.reportedCols}`
    );

    // ── 2. link interaction boundary ────────────────────────────────────
    check(
      'the pane claims xterm’s OSC 8 handler instead of its confirm() default',
      await page.evaluate(id => {
        const handler = window.__XTERMS__?.[id]?.options?.linkHandler;
        return (
          !!handler &&
          typeof handler.activate === 'function' &&
          handler.allowNonHttpProtocols === true
        );
      }, sessionId),
      'unclaimed linkHandler → confirm() + denied window.open()'
    );

    // plain text through the real PTY: a bare repo-relative path and a URL
    await page.evaluate(
      async ({ id, relative, url }) =>
        window.electron?.pty?.write(id, `echo "EDIT ${relative} SEE ${url}"\n`),
      { id: sessionId, relative: MISSING_RELATIVE, url: EVAL_URL }
    );
    await page.waitForFunction(
      async ({ id, needle }) =>
        (await window.electron?.pty?.buffer(id))?.includes(needle),
      { id: sessionId, needle: EVAL_URL }
    );
    // an OSC 8 hyperlink exactly as an Agent emits one
    await page.evaluate(
      ({ id, target }) => {
        const ESC = '\u001b';
        const ST = `${ESC}\\`;
        window.__XTERMS__?.[id]?.write(
          `\r\n${ESC}]8;;file://${target}${ST}OSC8FILELINK${ESC}]8;;${ST}\r\n`
        );
      },
      { id: sessionId, target: MISSING_ABSOLUTE }
    );
    await page.waitForTimeout(400);

    await hoverToken(page, sessionId, MISSING_RELATIVE);
    check(
      'a bare repo-relative path is recognised as a target',
      await linkHovered(page)
    );
    await hoverToken(page, sessionId, EVAL_URL);
    check('a web URL is recognised as a target', await linkHovered(page));
    const oscPoint = await hoverToken(page, sessionId, 'OSC8FILELINK');
    check(
      'an OSC 8 file:// hyperlink is recognised as a target',
      await linkHovered(page),
      'the built-in http-only filter used to drop these silently'
    );

    // right-click copies the LINK, not just whatever happened to be selected
    await page.mouse.click(oscPoint.x, oscPoint.y, { button: 'right' });
    const copyTarget = page.locator('[data-terminal-copy-target]');
    await copyTarget.waitFor();
    check(
      'the context menu names the target under the pointer',
      (await copyTarget.innerText()).trim() === 'Copy Path',
      await copyTarget.innerText()
    );
    await app.evaluate(({ clipboard }) => clipboard.writeText('unset'));
    await copyTarget.click();
    await page.waitForTimeout(300);
    check(
      'right-click copies the link target to the clipboard',
      (await app.evaluate(({ clipboard }) => clipboard.readText())) ===
        MISSING_ABSOLUTE,
      await app.evaluate(({ clipboard }) => clipboard.readText())
    );

    // left click dispatches, and a target that cannot open SAYS so instead of
    // failing silently — the shape the original report took
    await hoverToken(page, sessionId, 'OSC8FILELINK');
    await page.mouse.click(oscPoint.x, oscPoint.y);
    const notice = page.locator('[data-terminal-notice]');
    await notice.waitFor({ timeout: 10_000 });
    check(
      'left-clicking a link dispatches and reports its outcome',
      (await notice.innerText()).includes(MISSING_ABSOLUTE),
      await notice.innerText()
    );
    check(
      'no navigation confirmation dialog is ever raised',
      (await page.evaluate(() => window.__confirmCalls ?? [])).length === 0
    );

    // ── 3. scrollback, search, copy, paste ──────────────────────────────
    await page.evaluate(async id => {
      await window.electron?.pty?.write(
        id,
        "/usr/bin/awk 'BEGIN { for (i = 1; i <= 20000; i++) printf \"EXAWATT_LINE_%05d\\n\", i }'\n"
      );
    }, sessionId);
    await page.waitForFunction(async id => {
      const buffer = await window.electron?.pty?.buffer(id);
      if (!buffer) return false;
      const marker = 'EXAWATT_LINE_20000';
      return buffer.indexOf(marker) !== buffer.lastIndexOf(marker);
    }, sessionId);
    await page.waitForTimeout(3_000);
    if (process.env.EXAWATT_EVAL_SCREENSHOT) {
      await page.screenshot({ path: process.env.EXAWATT_EVAL_SCREENSHOT });
    }

    await textarea.focus();
    await textarea.press('Meta+f');
    const search = page.getByLabel('Search terminal scrollback');
    await search.fill('EXAWATT_LINE_00001');
    await page.waitForFunction(() => {
      const value = document.querySelector(
        '[data-terminal-search] span'
      )?.textContent;
      return value && value !== '0/0';
    });
    await page.getByLabel('Close terminal search').click();

    await page
      .locator('.terminal-pane')
      .click({ button: 'right', position: { x: 40, y: 80 } });
    await page.getByRole('menuitem', { name: 'Select All' }).click();
    await textarea.focus();
    await textarea.press('Meta+c');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    check(
      'Select All and Copy reach the Electron clipboard',
      copied.includes('EXAWATT_LINE_00001') &&
        copied.includes('EXAWATT_LINE_20000')
    );

    const clipboardMarker = 'EXAWATT_CLIPBOARD_TEXT_9713';
    await app.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      clipboardMarker
    );
    await textarea.focus();
    await textarea.press('Meta+v');
    await page.waitForFunction(
      async ({ id, marker }) => {
        const buffer = await window.electron?.pty?.buffer(id);
        return buffer?.includes(marker);
      },
      { id: sessionId, marker: clipboardMarker }
    );
    check('text paste reaches the PTY', true);

    const onePixelPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    await app.evaluate(({ clipboard, nativeImage }, dataUrl) => {
      clipboard.writeImage(nativeImage.createFromDataURL(dataUrl));
    }, onePixelPng);
    const imagePaste = await page.evaluate(
      async id => window.electron?.pty?.pasteClipboard(id),
      sessionId
    );
    check(
      'image paste creates a private temporary file',
      imagePaste?.kind === 'image' &&
        !!imagePaste.path &&
        existsSync(imagePaste.path),
      JSON.stringify(imagePaste)
    );
  },
  { maxMs: 240_000 }
);

rmSync(userData, { recursive: true, force: true });
console.log(
  failures.length
    ? `\n${failures.length} FAILURE(S): ${failures.join('; ')}`
    : '\nALL TERMINAL FUNDAMENTALS CHECKS PASSED'
);
process.exit(failures.length ? 1 : 0);
