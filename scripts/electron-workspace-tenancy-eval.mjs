#!/usr/bin/env node

/**
 * ENG-027 W1 acceptance eval: switching Workspaces leaves every live local
 * Session running and exactly where it was.
 *
 * Proof shape:
 *   1. start a real shell PTY in the Personal Workspace, print a marker
 *   2. switch to an `available` non-personal Workspace through the REAL
 *      account-menu switcher (a test tenant registered via the dev-only
 *      registration event — the same path W2 uses to make Demo real)
 *   3. while the other Workspace is on screen, write to the PTY over IPC and
 *      see fresh output — the process is alive and responsive, not paused
 *   4. switch back; the pane re-adopts with BOTH markers replayed and
 *      pty.list() identity byte-identical
 *
 * Also captures the visual evidence: the switcher with the Demo
 * `Coming soon` entry, the scoped non-personal view, and the restored shell.
 *
 * Run against THIS tree's dev server:
 *   pnpm dev -p <port>   then   EXA_BASE=http://localhost:<port> pnpm eval:electron:tenancy
 */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withElectronApp } from './lib/electron-eval.mjs';

const BASE = process.env.EXA_BASE || 'http://localhost:7000';
const SCREENSHOT_DIR =
  process.env.TENANCY_SCREENSHOT_DIR || '/tmp/exawatt-tenancy-eval';
const root = mkdtempSync(join(tmpdir(), 'exawatt-tenancy-eval-'));
const userData = join(root, 'userData');
const projectDir = join(root, 'project');
mkdirSync(userData, { recursive: true });
mkdirSync(projectDir, { recursive: true });
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BENCH_WORKSPACE = {
  id: 'tenancy-bench',
  name: 'Tenancy Bench',
  kind: 'demo',
  availability: 'available',
};
const MARKER_BEFORE = 'ENG027_BEFORE_SWITCH';
const MARKER_DURING = 'ENG027_ALIVE_WHILE_AWAY';

const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures.push(name);
}

async function ptySessions(page) {
  return await page.evaluate(
    async () => (await window.electron?.pty?.list()) ?? []
  );
}

async function waitForPtyBuffer(page, id, text, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const buffer = await page.evaluate(
      async sessionId => window.electron?.pty?.buffer(sessionId),
      id
    );
    if (buffer?.includes(text)) return true;
    await page.waitForTimeout(150);
  }
  return false;
}

async function openAccountMenu(page) {
  await page.locator('[data-account-menu-trigger]').click();
  await page.locator('[data-workspace-switch="personal"]').waitFor();
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
        EXAWATT_DEV_URL: `${BASE}/workspace`,
      },
    },
    async (app, page) => {
      page.setDefaultTimeout(25_000);
      await page.locator('[data-command-altitude]').waitFor();
      await page.waitForFunction(
        () => !document.body.innerText.includes('Loading…')
      );
      // the open-project listener belongs to the workspace client — wait for
      // the shell to be interactive before dispatching at it
      await page
        .locator(
          '[data-agent-composer], [data-composer-toggle], button:has-text("Open Project")'
        )
        .first()
        .waitFor();
      console.log('[tenancy] workspace shell ready');

      // register an available non-personal tenant (dev-only event)
      await page.evaluate(workspace => {
        window.dispatchEvent(
          new CustomEvent('exawatt:register-test-workspaces', {
            detail: [workspace],
          })
        );
      }, BENCH_WORKSPACE);

      // ---- Personal: start a real shell Session -------------------------
      await page.evaluate(dir => {
        window.dispatchEvent(
          new CustomEvent('exawatt:open-project', { detail: dir })
        );
      }, projectDir);
      await page
        .locator('[data-agent-composer], [data-composer-toggle]')
        .first()
        .waitFor();
      // the composer is summoned, not permanent — expand it if collapsed
      if ((await page.locator('[data-agent-composer]').count()) === 0) {
        await page
          .locator('[data-composer-toggle][aria-expanded="false"]')
          .click();
        await page.locator('[data-agent-composer]').waitFor();
      }
      await page.getByRole('button', { name: /Open shell in / }).click();
      await page.waitForFunction(async () => {
        const sessions = (await window.electron?.pty?.list()) ?? [];
        return sessions.length === 1;
      });
      const [before] = await ptySessions(page);
      await page.evaluate(
        async ({ id, text }) =>
          window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
        { id: before.id, text: MARKER_BEFORE }
      );
      check(
        'shell session prints in Personal',
        await waitForPtyBuffer(page, before.id, MARKER_BEFORE)
      );

      // ---- the switcher: Personal active, Demo coming soon --------------
      await openAccountMenu(page);
      const demoItem = page.locator('[data-workspace-switch="demo"]');
      await demoItem.waitFor();
      check(
        'Demo entry is present and disabled (Coming soon)',
        (await demoItem.getAttribute('data-disabled')) !== null ||
          (await demoItem.getAttribute('aria-disabled')) === 'true'
      );
      check(
        'Demo entry carries Coming soon copy',
        (await demoItem.innerText()).includes('Coming soon')
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'account-menu-switcher.png'),
      });
      console.log('[tenancy] switcher screenshot captured');

      // ---- switch away through the real menu ----------------------------
      await page
        .locator(`[data-workspace-switch="${BENCH_WORKSPACE.id}"]`)
        .click();
      await page
        .locator(`[data-tenant-workspace-scope="${BENCH_WORKSPACE.id}"]`)
        .waitFor();
      check(
        'non-personal Workspace identity chip is visible',
        (await page
          .locator(`[data-active-tenant-workspace="${BENCH_WORKSPACE.id}"]`)
          .count()) === 1
      );
      check(
        'personal terminal is not rendered in the other Workspace',
        (await page.locator('.xterm-helper-textarea').count()) === 0
      );

      const during = await ptySessions(page);
      check(
        'pty.list() identity untouched after switch',
        during.length === 1 &&
          during[0].id === before.id &&
          during[0].exitCode === null,
        JSON.stringify(during.map(s => [s.id, s.exitCode]))
      );
      // the live process must be RESPONSIVE while the other Workspace shows
      await page.evaluate(
        async ({ id, text }) =>
          window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
        { id: before.id, text: MARKER_DURING }
      );
      check(
        'session keeps executing while another Workspace is on screen',
        await waitForPtyBuffer(page, before.id, MARKER_DURING)
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'bench-scope-view.png'),
      });

      // ---- the Fleet altitude is gated too (ENG-027 review finding 2) ----
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.waitForFunction(
        () => window.location.pathname === '/fleet/spatial'
      );
      await page
        .locator(`[data-tenant-workspace-scope="${BENCH_WORKSPACE.id}"]`)
        .waitFor();
      check(
        'Fleet altitude shows the scoped view, not the personal live fleet',
        (await page.locator('[data-spatial-command]').count()) === 0
      );
      check(
        'identity chip still visible on the Fleet altitude',
        (await page
          .locator(`[data-active-tenant-workspace="${BENCH_WORKSPACE.id}"]`)
          .count()) === 1
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'bench-fleet-gate.png'),
      });

      // ---- switch back: exactly where it was ----------------------------
      await openAccountMenu(page);
      await page.locator('[data-workspace-switch="personal"]').click();
      await page.locator('.xterm-helper-textarea').waitFor();
      const replayed = await page.waitForFunction(
        ({ id, markers }) => {
          const terminal = window.__XTERMS__?.[id];
          if (!terminal) return false;
          const buffer = terminal.buffer.active;
          let text = '';
          for (let i = 0; i < buffer.length; i += 1) {
            text += `${buffer.getLine(i)?.translateToString(true) ?? ''}\n`;
          }
          return markers.every(marker => text.includes(marker));
        },
        { id: before.id, markers: [MARKER_BEFORE, MARKER_DURING] }
      );
      check('pane re-adopts with both markers replayed', Boolean(replayed));
      const after = await ptySessions(page);
      check(
        'pty.list() identity byte-identical after round trip',
        after.length === 1 &&
          after[0].id === before.id &&
          after[0].harnessSessionId === before.harnessSessionId &&
          after[0].exitCode === null,
        JSON.stringify(after.map(s => [s.id, s.exitCode]))
      );
      check(
        'identity chip cleared back in Personal',
        (await page.locator('[data-active-tenant-workspace]').count()) === 0
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'personal-restored.png'),
      });
    },
    { maxMs: 150_000, firstWindowMs: 45_000 }
  );

  if (failures.length > 0) {
    console.error(`FAIL workspace tenancy: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(
    'PASS workspace tenancy: switch away and back left the live Session running, responsive, and exactly where it was'
  );
  console.log(`[tenancy] screenshots: ${SCREENSHOT_DIR}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
