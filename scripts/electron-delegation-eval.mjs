#!/usr/bin/env node

/**
 * Delegation visibility eval (ENG-023 D1 / D5).
 *
 * Exercises the WHOLE pipeline in the real Electron app: Exawatt writes a
 * settings file for the launch, the harness reads it, posts its own lifecycle
 * to the loopback channel, and the strip stops reporting a delegating Session
 * as a finished one. The fixture harness is shared with the turn-truth eval —
 * see `scripts/lib/harness-event-fixture.mjs` for why it is not a mock.
 */
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  startAgentFromLauncher,
  sweepOrphans,
  withElectronApp,
} from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';

const fixture = createHarnessFixture('exawatt-delegation', {
  codexProtocol: true,
});
const { root, project } = fixture;

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const launch = fixtureLaunch(fixture, {
  // a delegating parent goes quiet fast; shorten the turn-end inference so
  // the "does it wrongly claim a result?" question resolves in eval time
  EXAWATT_ATTENTION_QUIET_MS: '1200',
  EXAWATT_ATTENTION_MIN_BURST: '1',
});

sweepOrphans();
let completed = false;
try {
  await withElectronApp(
    launch,
    async (_app, page) => {
      page.on('pageerror', error =>
        console.log(`[delegation] pageerror: ${error.message}`)
      );
      const { claude, sessions, until, buffer, send, status } =
        await openFixtureSession(page, fixture);
      const dots = page.locator('[data-delegation]').first();
      const statusOf = status;

      // --- the launch actually subscribed -------------------------------
      await until(
        async () => (await buffer()).includes('FAKE_CLAUDE_SUBSCRIBED'),
        'harness to read the injected settings'
      );
      const launchOutput = await buffer();
      check(
        'Exawatt injects a settings file the harness can read',
        launchOutput.includes('FAKE_CLAUDE_SUBSCRIBED')
      );
      check(
        'the settings file lives in Exawatt state, not the user harness config',
        /FAKE_CLAUDE_SETTINGS:.*harness-events/.test(launchOutput) &&
          !/FAKE_CLAUDE_SETTINGS:.*\.claude/.test(launchOutput)
      );

      // --- a delegating parent must not read as finished ----------------
      await send('turn');
      // the spawn label precedes the child's start, as it does live (D3a)
      await send('label Explore Map the Sessions tab layout');
      await send('spawn a1');
      await send('stop');
      await until(
        async () => (await dots.count()) > 0,
        'delegation dots to appear'
      );
      check('a delegated child shows as a dot', (await dots.count()) === 1);
      check(
        'one child reads as one working agent',
        (await dots.getAttribute('aria-label')) ===
          '1 delegated agent working — Explore'
      );

      // The parent's own turn ended and it has gone quiet. Before ENG-023
      // this is exactly where the strip claimed "result ready".
      await page.waitForTimeout(3_000);
      check(
        'a quiet parent with a live child still reads as working',
        (await statusOf()) === 'working'
      );
      const attention = await page.evaluate(async () =>
        ((await window.electron?.pty?.list()) ?? []).map(s => s.attention)
      );
      check(
        'no turn-end result is raised while a child runs',
        attention.every(entry => entry?.kind !== 'turn-end')
      );

      // --- a child's own turn boundary must not move the parent ---------
      await send('child-stop a1');
      await page.waitForTimeout(600);
      check(
        'a Stop from inside a child leaves the parent delegating',
        (await dots.count()) === 1 && (await statusOf()) === 'working'
      );

      // --- the idle nudge of a delegating parent (ENG-015 S1) -----------
      // Claude Code rings a BARE BEL 60s after its own Stop, and its
      // `idle_prompt` Notification is deliberately unsubscribed, so that bell
      // is the only channel the nudge has. Measured on 2.1.231 launched
      // exactly as Exawatt launches it: Stop +4.5s, BEL +64.5s, and the child
      // still running until +135.8s. The bell was the one raise path that
      // never consulted the reported record, so the operator saw amber
      // "needs you" on Sessions whose team was demonstrably busy.
      await send('bell');
      await page.waitForTimeout(1_500);
      const afterBell = await page.evaluate(async () =>
        ((await window.electron?.pty?.list()) ?? []).map(s => s.attention)
      );
      check(
        'an idle bell while a child runs raises no needs-you',
        afterBell.every(entry => entry?.kind !== 'bell')
      );
      check(
        'the delegating Session still reads as working after the bell',
        (await statusOf()) === 'working'
      );
      check(
        'no Session paints the needs-you marker while its team works',
        (await page.locator('[data-attention]').count()) === 0
      );
      await page.screenshot({
        path: join(root, 'delegation-idle-bell.png'),
        fullPage: false,
      });

      // --- the Sessions tile details the team as a labeled rail (D3a) ---
      await page.keyboard.press('Control+Meta+2');
      await page.locator('[data-expose-tile]').first().waitFor();
      const rail = page.locator('[data-session-delegation-rail]').first();
      await rail.waitFor();
      const railText = await rail.textContent();
      check(
        'the Sessions tile names the child and its spawn label',
        railText.includes('Explore') &&
          railText.includes('Map the Sessions tab layout')
      );
      check(
        'the child prompt never reaches the Sessions surface',
        !(await page.evaluate(() =>
          document.body.innerHTML.includes('PRIVATE_PROMPT_BODY')
        ))
      );
      // The boundary is the IPC payload, not the DOM: a prompt smuggled into
      // the delegation record but not rendered must still fail here.
      check(
        'the child prompt never crosses IPC at all',
        !(await page.evaluate(async () =>
          JSON.stringify((await window.electron?.pty?.list()) ?? []).includes(
            'PRIVATE_PROMPT_BODY'
          )
        ))
      );
      await page.keyboard.press('Escape');
      await page
        .locator('[data-expose-tile]')
        .first()
        .waitFor({ state: 'detached' });

      // --- more children, stable geometry -------------------------------
      const widthBefore = await dots.evaluate(node => node.style.width);
      await send('spawn a2');
      await send('spawn a3');
      await until(
        async () => (await dots.getAttribute('data-delegation')) === '3',
        'three children'
      );
      check(
        'children arriving never resize the row',
        (await dots.evaluate(node => node.style.width)) === widthBefore
      );

      // --- the last child finishing settles the Session -----------------
      for (const id of ['a1', 'a2', 'a3']) await send(`done ${id}`);
      await until(
        async () => (await dots.count()) === 0,
        'delegation dots to clear'
      );
      check('dots clear when the last child finishes', true);
      const settled = await until(
        async () => ((await statusOf()) === 'done' ? 'done' : null),
        'the Session to settle as a ready result',
        12_000
      );
      check(
        'a finished Session finally reads as a ready result',
        settled === 'done'
      );

      // --- the child's report never reaches the renderer ----------------
      const leaked = await page.evaluate(() =>
        document.body.innerHTML.includes('PRIVATE_REPORT_BODY')
      );
      check('a child report body never reaches a surface', !leaked);

      // --- Codex's owned protocol drives the same three altitudes --------
      await page.keyboard.press('Meta+KeyT');
      await page.locator('[data-agent-composer]').waitFor();
      await startAgentFromLauncher(page, { engine: 'Codex' });
      const codex = await until(
        async () =>
          (await sessions()).find(
            s =>
              s.harness === 'codex' &&
              s.harnessSessionId === fixture.codex.rootId
          ),
        'Codex session identity'
      );
      const codexDots = page.locator('[data-delegation]').first();
      await until(
        async () => (await codexDots.getAttribute('data-delegation')) === '2',
        'two source-reported Codex children'
      );
      check(
        'Codex protocol reports an exact two-child Agent census',
        (await codexDots.getAttribute('data-delegation')) === '2'
      );

      await page.keyboard.press('Control+Meta+2');
      const codexRail = page
        .locator('[data-session-delegation-rail]')
        .filter({ hasText: 'map release' });
      await codexRail.waitFor();
      const codexRailText = await codexRail.textContent();
      check(
        'Team renders source-owned Codex child labels',
        codexRailText.includes('map release') &&
          codexRailText.includes('audit ci')
      );

      await page.keyboard.press('Escape');
      await codexRail.waitFor({ state: 'detached' });
      await page.locator('[data-command-altitude-level="spatial"]').click();
      await page.locator('[data-spatial-board]').waitFor();
      await page.locator('[data-board-zone]').first().click();
      await page.locator('[data-board-agent]').first().waitFor();
      await until(
        async () =>
          (await page.locator('[data-board-delegation-unit]').count()) === 2,
        'two Codex Fleet child units'
      );
      check(
        'Fleet renders two Codex children through the shared view model',
        (await page.locator('[data-board-delegation-unit]').count()) === 2
      );

      const sendCodex = async command =>
        page.evaluate(
          async ({ id, data }) => window.electron?.pty?.write(id, data),
          { id: codex.id, data: `${command}\r` }
        );
      await sendCodex(`finish ${fixture.codex.childIds[0]}`);
      await until(
        async () =>
          (await sessions()).find(s => s.id === codex.id)?.delegation?.children
            .length === 1,
        'one Codex child to complete'
      );
      check('Codex child completion correlates by exact thread ID', true);

      await sendCodex('protocol-down');
      await until(
        async () =>
          (await sessions()).find(s => s.id === codex.id)?.delegation == null,
        'Codex protocol loss to withdraw the observation'
      );
      const afterProtocolLoss = (await sessions()).find(s => s.id === codex.id);
      check(
        'protocol loss fails to absent without a synthetic result',
        afterProtocolLoss?.delegation == null &&
          afterProtocolLoss?.attention?.kind !== 'turn-end'
      );

      await sendCodex('protocol-up');
      await until(
        async () =>
          (await sessions()).find(s => s.id === codex.id)?.delegation?.children
            .length === 1,
        'Codex reconnect snapshot'
      );
      check('Codex reconnect resnapshots authoritative descendants', true);

      await page.screenshot({
        path: join(root, 'delegation.png'),
        fullPage: false,
      });
      completed = true;
    },
    { maxMs: 180_000 }
  );
} finally {
  if (process.env.EXAWATT_KEEP_EVAL) {
    console.log(`[delegation] retained fixture: ${root}`);
  } else {
    rmSync(root, { recursive: true, force: true });
  }
}

if (!completed || failures.length > 0) {
  console.error(`FAIL delegation eval — ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('PASS delegation visibility (ENG-023 D1 / D5)');
