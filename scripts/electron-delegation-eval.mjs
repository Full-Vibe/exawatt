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
import { existsSync, readFileSync, rmSync } from 'node:fs';
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
        /^1 delegated agent working\b.*\bExplore$/.test(
          (await dots.getAttribute('aria-label')) ?? ''
        )
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

      // --- the census is a claim with coverage, not a latch (D7, BUG-081) --
      // Three scenarios measured on Claude Code 2.1.270 (2026-09-13). The
      // quiescence window is 1200ms here, so the stale bound is 3.6s.
      const expiries = () => {
        const log = join(fixture.userData, 'logs', 'main.jsonl');
        if (!existsSync(log)) return [];
        return readFileSync(log, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
          .filter(entry => entry.event === 'delegation.census-expired');
      };

      // (1) An interrupted parent: ESC kills the children and the harness
      // posts nothing — not Stop, not SubagentStop. The operator's exact tab.
      await send('turn');
      await send('spawn b1');
      await send('spawn b2');
      await until(
        async () => (await dots.getAttribute('data-delegation')) === '2',
        'two children before the interrupt'
      );
      await send('halt');
      await until(
        async () => (await dots.count()) === 0,
        'an interrupted census to expire',
        15_000
      );
      check('children the harness never closed do not spin the tab forever', true);
      await until(
        async () => (await statusOf()) === 'done',
        'the interrupted Session to land'
      );
      check('the interrupted Session lands as a result', true);
      const interrupted = expiries().find(
        entry =>
          Array.isArray(entry.childIds) &&
          entry.childIds.includes('b1') &&
          entry.childIds.includes('b2')
      );
      check(
        'main.jsonl names the expired children and the silence that expired them',
        !!interrupted &&
          interrupted.sessionId === claude.id &&
          interrupted.harness === 'claude' &&
          typeof interrupted.quietMs === 'number' &&
          interrupted.quietMs >= interrupted.staleMs
      );

      // (2) The premature-green guard: a live child keeps the footer ticking,
      // and no amount of that may read as a result.
      await send('turn');
      await send('spawn c1');
      await send('stop');
      await until(
        async () => (await dots.getAttribute('data-delegation')) === '1',
        'one covered child'
      );
      // three stale bounds of rendering, well past where silence would expire
      await page.waitForTimeout(11_000);
      const covered = (await sessions()).find(s => s.id === claude.id);
      check(
        'a child the harness keeps rendering is never expired',
        (await dots.getAttribute('data-delegation')) === '1' &&
          (await statusOf()) === 'working' &&
          covered?.attention?.kind !== 'turn-end' &&
          !expiries().some(entry => entry.childIds?.includes('c1'))
      );
      await send('done c1');
      await until(
        async () => (await statusOf()) === 'done',
        'the covered child to settle its parent'
      );
      check('the covered child settles the Session when it ends', true);

      // (3) A lost SubagentStop: the harness's next boundary carries a census
      // that no longer names the child, so it heals without inference.
      await send('turn');
      await send('spawn d1');
      await send('spawn d2');
      await send('stop');
      await until(
        async () => (await dots.getAttribute('data-delegation')) === '2',
        'two children before the loss'
      );
      await send('done d1');
      await send('lose d2');
      await send('turn');
      await send('stop');
      await until(
        async () => (await dots.count()) === 0,
        'the boundary census to retire the lost child'
      );
      check(
        "a lost SubagentStop cannot outlive the parent's next boundary",
        !expiries().some(entry => entry.childIds?.includes('d2'))
      );
      await until(
        async () => (await statusOf()) === 'done',
        'the healed Session to land'
      );
      check('the healed Session reads as a result', true);

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

      await sendCodex(`resume ${fixture.codex.childIds[0]}`);
      await until(
        async () =>
          (await sessions()).find(s => s.id === codex.id)?.delegation?.children
            .length === 2,
        'completed Codex child to resume without a timestamp change'
      );
      check(
        'same-timestamp child resumption reaches the shared projection',
        true
      );
      await sendCodex(`fail ${fixture.codex.childIds[0]}`);
      await until(
        async () =>
          (await sessions()).find(s => s.id === codex.id)?.delegation?.children
            .length === 1,
        'failed child to leave the live census'
      );
      check(
        'failed child does not announce a successful result',
        (await sessions()).find(s => s.id === codex.id)?.attention?.kind !==
          'turn-end'
      );

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

      await sendCodex('activity-refused');
      const sourceFact = () =>
        page.evaluate(async () => {
          const registry = await window.electron.agentSources.list('launch');
          return registry.sources.find(source => source.adapterId === 'codex')
            ?.facts.delegation;
        });
      await until(
        async () => (await sourceFact())?.state === 'degraded',
        'refused method to publish partial coverage'
      );
      const isolated = (await sessions()).find(s => s.id === codex.id);
      check(
        'refused activity preserves independently verified sibling',
        isolated?.delegation?.children.length === 1 &&
          isolated.delegation.children[0].id === fixture.codex.childIds[0]
      );
      check(
        'source health names observation loss without claiming completion',
        (await sourceFact())?.basis === 'observed' &&
          isolated?.attention?.kind !== 'turn-end'
      );
      await page.goto(new URL('/settings', page.url()).href);
      await page.getByRole('button', { name: /^Codex,/ }).click();
      const partialFact = await sourceFact();
      await page.getByText(partialFact.value, { exact: true }).waitFor();
      await page
        .getByText(partialFact.value, { exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(root, 'delegation-source-partial.png'),
      });
      check(
        'Agent Sources renders runtime coverage instead of its declaration',
        true
      );
      await sendCodex('activity-restored');
      await until(
        async () => (await sourceFact())?.state === 'ready',
        'restored protocol to clear observation fault'
      );
      check('runtime coverage recovers after a refused RPC', true);
      const recoveredFact = await sourceFact();
      await page.getByText(recoveredFact.value, { exact: true }).waitFor();
      check(
        'Agent Sources receives observation recovery without a recheck',
        true
      );

      await page.screenshot({
        path: join(root, 'delegation.png'),
        fullPage: false,
      });
      completed = true;
    },
    { maxMs: 240_000 }
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
console.log('PASS delegation visibility (ENG-023 D1 / D5 / D7)');
