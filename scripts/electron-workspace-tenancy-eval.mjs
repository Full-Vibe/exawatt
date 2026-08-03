#!/usr/bin/env node

/**
 * ENG-027 W1+W2 acceptance eval: switching Workspaces leaves every live
 * local Session running and exactly where it was — and the Demo tenant is
 * REAL: Voltaic populates every altitude through the production surfaces.
 *
 * Proof shape (one launch):
 *   1. start a real shell PTY in the Personal Workspace, print a marker
 *   2. switch to a contentless non-personal tenant (registered bench) —
 *      scoped view, PTY untouched and RESPONSIVE while away (W1 checks)
 *   3. switch back; the pane re-adopts with the markers replayed and
 *      pty.list() identity byte-identical
 *   4. switch to the REAL Demo tenant (W2): the demo shell renders readable
 *      transcript content (never a PTY, never a blank pane), the preview
 *      desk carries its ENG-026 marker, ⌘K lists Voltaic Sessions and
 *      offers no launch verbs, the Team altitude fans out the 27 authored
 *      Sessions, and the Fleet altitude shows the populated Voltaic board —
 *      all while the live Personal PTY keeps executing
 *   5. return to Personal — everything exactly as it was — then end the run
 *      inside Demo
 * Then a SECOND launch on the same userData proves the W1 review-fix
 * composition: relaunching inside Demo restores Demo (never Personal's
 * memory, never the gate placeholder, never the personal fleet).
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
const MARKER_DEMO = 'ENG027_ALIVE_IN_DEMO';

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
      // Bounded explicit poll — NOT waitForFunction with an async predicate:
      // the returned Promise object is truthy on the first tick, so that
      // form resolves before the spawn completes and the next read races.
      const spawnDeadline = Date.now() + 15_000;
      let before;
      while (Date.now() < spawnDeadline) {
        const sessions = await ptySessions(page);
        if (sessions.length === 1) {
          [before] = sessions;
          break;
        }
        await page.waitForTimeout(150);
      }
      if (!before) {
        throw new Error(
          'TIMED OUT after 15s waiting for the Personal shell session to spawn'
        );
      }
      await page.evaluate(
        async ({ id, text }) =>
          window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
        { id: before.id, text: MARKER_BEFORE }
      );
      check(
        'shell session prints in Personal',
        await waitForPtyBuffer(page, before.id, MARKER_BEFORE)
      );

      // ---- the switcher: Personal active, Demo REAL (W2) ----------------
      await openAccountMenu(page);
      const demoItem = page.locator('[data-workspace-switch="demo"]');
      await demoItem.waitFor();
      check(
        'Demo entry is enabled (available since W2)',
        (await demoItem.getAttribute('data-disabled')) === null &&
          (await demoItem.getAttribute('aria-disabled')) !== 'true'
      );
      check(
        'Demo entry no longer reads Coming soon',
        !(await demoItem.innerText()).includes('Coming soon')
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

      // ================= W2: the REAL Demo tenant =========================
      await openAccountMenu(page);
      await page.locator('[data-workspace-switch="demo"]').click();
      await page.locator('[data-demo-workspace]').waitFor();
      check(
        'Demo identity chip is visible',
        (await page
          .locator('[data-active-tenant-workspace="demo"]')
          .count()) === 1
      );
      check(
        'no terminal renders in the Demo tenant',
        (await page.locator('.xterm-helper-textarea').count()) === 0
      );
      // Agent altitude: the default Session opens READABLE authored content
      await page.locator('[data-demo-session-pane]').waitFor();
      check(
        'demo Session opens a readable transcript (pane content source)',
        (await page.locator('[data-demo-transcript]').count()) === 1
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-agent-altitude.png'),
      });
      // The Demo shell rides the REAL ribbon (W6): live TabStrip chrome,
      // no demo-only navigation surface.
      check(
        'Demo Agent altitude renders the live TabStrip ribbon',
        (await page
          .locator('[data-workspace-chrome] [data-workspace-tab-strip]')
          .count()) === 1
      );
      // A preview desk carries the ENG-026 marker (readiness truth).
      // Reach it the way a user would: ⌘K session jump (the ribbon may hold
      // its Project mini or folded at this window width).
      await page.keyboard.press('Meta+k');
      await page.locator('[cmdk-root]').waitFor();
      await page.keyboard.type('NPRR impact briefs');
      await page.locator('[cmdk-root] [data-session-id="vg-res-nprr"]').click();
      await page.locator('[data-demo-session-pane="vg-res-nprr"]').waitFor();
      check(
        'preview desk Session carries the shared Coming soon marker',
        (await page
          .locator(
            '[data-demo-session-pane] [data-readiness="preview"]'
          )
          .count()) === 1
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-preview-desk.png'),
      });

      // The live Personal PTY keeps EXECUTING while Demo is on screen
      const duringDemo = await ptySessions(page);
      check(
        'pty.list() identity untouched inside Demo',
        duringDemo.length === 1 &&
          duringDemo[0].id === before.id &&
          duringDemo[0].exitCode === null,
        JSON.stringify(duringDemo.map(s => [s.id, s.exitCode]))
      );
      await page.evaluate(
        async ({ id, text }) =>
          window.electron?.pty?.write(id, `printf '${text}\\n'\n`),
        { id: before.id, text: MARKER_DEMO }
      );
      check(
        'live Session keeps executing while Demo is on screen',
        await waitForPtyBuffer(page, before.id, MARKER_DEMO)
      );

      // ⌘K lists Voltaic Sessions and offers no PTY-reaching verbs
      await page.keyboard.press('Meta+k');
      await page.locator('[cmdk-root]').waitFor();
      check(
        'palette lists demo Sessions',
        (await page.locator('[cmdk-root] [data-session-id^="vg-"]').count()) >
          0
      );
      check(
        'palette offers no launch verbs in Demo',
        (await page
          .locator('[cmdk-item]', { hasText: 'Start Agent with' })
          .count()) === 0 &&
          (await page
            .locator('[cmdk-item]', { hasText: 'Open shell in' })
            .count()) === 0
      );
      check(
        'palette exposes source-safe Project movement in Demo',
        (await page
          .locator('[cmdk-item]', { hasText: 'Move Project left' })
          .count()) === 1 &&
          (await page
            .locator('[cmdk-item]', { hasText: 'Move Project right' })
            .count()) === 1
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-command-palette.png'),
      });
      await page.keyboard.press('Escape');

      // Fixed workspace families run through a Demo-backed action adapter —
      // the help surface never advertises inert Live-only keys.
      const demoProjectMove = await page.evaluate(() => {
        // Ribbon truth (W6): Project headers are `project:<dir>` tokens and
        // the active chip names its Project via data-project-parent.
        const projects = Array.from(
          document.querySelectorAll('[data-ribbon-key^="project:"]')
        ).map(header => header.getAttribute('data-ribbon-key'));
        const activeDir = document
          .querySelector('[data-tab-id][data-active]')
          ?.getAttribute('data-project-parent');
        const active = projects.indexOf(`project:${activeDir}`);
        return {
          before: projects,
          active,
          delta: active < projects.length - 1 ? 1 : -1,
        };
      });
      await page.keyboard.press(
        demoProjectMove.delta === 1
          ? 'Meta+Alt+Shift+BracketRight'
          : 'Meta+Alt+Shift+BracketLeft'
      );
      const demoProjectOrderAfter = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll('[data-ribbon-key^="project:"]')
        ).map(header => header.getAttribute('data-ribbon-key'))
      );
      check(
        'fixed Project movement executes in Demo',
        demoProjectOrderAfter[
          demoProjectMove.active + demoProjectMove.delta
        ] === demoProjectMove.before[demoProjectMove.active]
      );
      check(
        'Demo Project movement announces its result',
        (await page
          .locator('[role="status"]', { hasText: 'Moved Project' })
          .count()) === 1
      );

      const demoPane = page.locator('[data-workspace-session-focus-owner]');
      await demoPane.focus();
      await page.keyboard.press('F6');
      check(
        'F6 moves focus from the Demo Session to app controls',
        await page.evaluate(
          () =>
            document.activeElement?.hasAttribute('data-tab-chrome') ?? false
        )
      );
      await page.keyboard.press('Escape');
      check(
        'Escape returns focus to the Demo Session',
        await page.evaluate(
          () =>
            document.activeElement?.hasAttribute(
              'data-workspace-session-focus-owner'
            ) ?? false
        )
      );

      // The global registry deliberately ignores keys for 100 ms after a
      // palette closes so its closing Enter/Escape cannot trigger a second
      // command. Keep this assertion outside that protection window.
      await page.waitForTimeout(150);
      await page.keyboard.press('Meta+Slash');
      const demoHelp = page.getByRole('dialog');
      await demoHelp.waitFor();
      check(
        'Demo help entries name working fixed commands',
        (await demoHelp
          .getByText('Move focus between the Session and app controls')
          .count()) === 1 &&
          (await demoHelp.getByText('Return focus to the Session').count()) ===
            1
      );
      await page.keyboard.press('Escape');
      await demoHelp.waitFor({ state: 'detached' });

      // Team altitude: the exposé fans out the 27 authored Sessions
      await page.locator('[data-command-altitude-level="sessions"]').click();
      await page.locator('[data-expose]').waitFor();
      const tileCount = await page.locator('[data-expose-tile]').count();
      check(
        'Team altitude shows the authored demo fleet (27 Sessions)',
        tileCount === 27,
        `tiles=${tileCount}`
      );
      const railText =
        (await page.locator('[data-roadmap-rail]').count()) > 0
          ? await page.locator('[data-roadmap-rail]').innerText()
          : '';
      check(
        'roadmap rail renders the Voltaic roadmap in-tenant',
        railText.length > 50,
        railText.length === 0 ? 'rail not visible at this width' : ''
      );
      // let the exposé entrance transition finish before the evidence shot
      await page.waitForTimeout(900);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-team-altitude.png'),
      });

      // Fleet altitude: the VOLTAIC board — populated, not the gate, not
      // the personal fleet
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-command]').waitFor();
      const agentCount = Number(
        await page
          .locator('[data-spatial-command]')
          .getAttribute('data-agent-count')
      );
      check(
        'Fleet altitude shows the populated Voltaic board',
        agentCount >= 150,
        `agents=${agentCount}`
      );
      check(
        'Demo identity chip still visible on the Fleet altitude',
        (await page
          .locator('[data-active-tenant-workspace="demo"]')
          .count()) === 1
      );
      // let the board settle before the evidence shot
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-fleet-altitude.png'),
      });

      // Closing fix (ENG-027): native-menu launch verbs are TENANT-GATED.
      // Fire the real menu IPC inside Demo — the dispatch gate must drop
      // them whole, and the launch-family request functions must store no
      // pending slot that could fire against Personal after the switch back.
      await app.evaluate(({ BrowserWindow }, commands) => {
        const win = BrowserWindow.getAllWindows()[0];
        for (const command of commands) {
          win?.webContents.send('menu:command', command);
        }
      }, ['launch-shell', 'launch-claude', 'new-agent']);
      await page.waitForTimeout(500);
      check(
        'menu launch verbs are inert inside Demo (no terminal, tenant intact)',
        (await page
          .locator('[data-active-tenant-workspace="demo"]')
          .count()) === 1 &&
          (await page.locator('.xterm-helper-textarea').count()) === 0 &&
          (await page.locator('[data-spatial-command]').count()) === 1
      );

      // ---- return to Personal: everything exactly as it was --------------
      await openAccountMenu(page);
      await page.locator('[data-workspace-switch="personal"]').click();
      await page.locator('.xterm-helper-textarea').waitFor();
      const replayedAll = await page.waitForFunction(
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
        {
          id: before.id,
          markers: [MARKER_BEFORE, MARKER_DURING, MARKER_DEMO],
        }
      );
      check(
        'pane re-adopts with all three markers after the Demo round trip',
        Boolean(replayedAll)
      );
      const afterDemo = await ptySessions(page);
      check(
        'pty.list() identity byte-identical after the Demo round trip',
        afterDemo.length === 1 &&
          afterDemo[0].id === before.id &&
          afterDemo[0].harnessSessionId === before.harnessSessionId &&
          afterDemo[0].exitCode === null,
        JSON.stringify(afterDemo.map(s => [s.id, s.exitCode]))
      );
      // …and stays that way: a pending-launch slot leaked from Demo would
      // fire on this mount (use-workspace-state replays it when ready) and
      // spawn a second PTY within moments. Give it time, then re-list.
      await page.waitForTimeout(1500);
      const settled = await ptySessions(page);
      check(
        'no pending-launch slot leaked from Demo fires after the switch back',
        settled.length === 1 && settled[0].id === before.id,
        JSON.stringify(settled.map(s => [s.id, s.exitCode]))
      );

      // End the run INSIDE Demo so the relaunch phase can prove boot-restore
      await openAccountMenu(page);
      await page.locator('[data-workspace-switch="demo"]').click();
      await page.locator('[data-active-tenant-workspace="demo"]').waitFor();
    },
    { maxMs: 240_000, firstWindowMs: 45_000 }
  );

  // ============ relaunch: boot-restore INSIDE Demo (W1 review fix) ========
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
      await page.locator('[data-active-tenant-workspace="demo"]').waitFor();
      check(
        'relaunch restores the Demo tenant (identity chip present)',
        (await page
          .locator('[data-active-tenant-workspace="demo"]')
          .count()) === 1
      );
      check(
        'relaunch inside Demo never mounts the personal terminal',
        (await page.locator('.xterm-helper-textarea').count()) === 0
      );
      // Demo content — the shell or the board, depending on the remembered
      // surface — but never the contentless gate placeholder
      const demoContent =
        (await page.locator('[data-demo-workspace]').count()) +
        (await page.locator('[data-spatial-command]').count());
      check('relaunch lands on Demo content, not a placeholder', demoContent > 0);
      // The Fleet altitude after a relaunch is the VOLTAIC board
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-command]').waitFor();
      const rebootAgents = Number(
        await page
          .locator('[data-spatial-command]')
          .getAttribute('data-agent-count')
      );
      check(
        'Fleet altitude after relaunch is the Voltaic board, not the personal fleet',
        rebootAgents >= 150,
        `agents=${rebootAgents}`
      );
      // evidence shot after the board's dynamic bundle actually paints
      await page
        .locator('[data-spatial-command] canvas')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'demo-relaunch-restored.png'),
      });
      // leave the persisted state clean for a human relaunch
      await openAccountMenu(page);
      await page.locator('[data-workspace-switch="personal"]').click();
      await page
        .locator('[data-active-tenant-workspace]')
        .waitFor({ state: 'detached' })
        .catch(() => {});
    },
    { maxMs: 120_000, firstWindowMs: 45_000 }
  );

  if (failures.length > 0) {
    console.error(`FAIL workspace tenancy: ${failures.join('; ')}`);
    process.exit(1);
  }
  console.log(
    'PASS workspace tenancy: the bench and Demo round trips left the live Session running, responsive, and exactly where it was; Demo populated every altitude and survived a relaunch'
  );
  console.log(`[tenancy] screenshots: ${SCREENSHOT_DIR}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
