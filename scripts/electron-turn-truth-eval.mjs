#!/usr/bin/env node

/**
 * Reported turn truth (ENG-015 S1.1).
 *
 * Byte quiescence needs ~600 bytes plus 4 s of silence to decide a turn ended.
 * Measured against a real Claude session, that trailed the harness's own
 * boundary by 6-7 s on EVERY turn — long enough for the strip to read
 * "working" for an Agent that had provably finished.
 *
 * These permutations pin the corrected behavior in the real app: a reported
 * boundary settles instantly and in both directions, a source that reports
 * nothing keeps the inferred behavior exactly, and inference still catches a
 * turn that ends without ever being reported.
 */
import { rmSync } from 'node:fs';

import { withElectronApp, sweepOrphans } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';

const fixture = createHarnessFixture('exawatt-turn-truth');
const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

sweepOrphans();
let completed = false;
try {
  await withElectronApp(
    // Quiescence stays SHORT so the backstop is observable inside eval time;
    // the reported path must beat it regardless of the threshold.
    fixtureLaunch(fixture, {
      EXAWATT_ATTENTION_QUIET_MS: '1500',
      EXAWATT_ATTENTION_MIN_BURST: '1',
    }),
    async (app, page) => {
      page.on('pageerror', error =>
        console.log(`[turn-truth] pageerror: ${error.message}`)
      );
      const { claude, sessions, until, send, status } =
        await openFixtureSession(page, fixture);
      const attentionOf = async () =>
        (await sessions()).find(s => s.id === claude.id)?.attention?.kind ??
        'none';
      const ownTurnOf = async () =>
        (await sessions()).find(s => s.id === claude.id)?.delegation?.ownTurn ??
        'unreported';

      // 1. A reported turn start is working IMMEDIATELY, with no output at all.
      await send('turn');
      await until(
        async () => (await ownTurnOf()) === 'generating',
        'reported turn start'
      );
      check(
        'a reported turn reads as working before any output arrives',
        (await status()) === 'working'
      );

      // 2. Silence inside a live turn must NOT settle it. This is the window
      //    where inference alone would have gone quiet and called it done.
      await page.waitForTimeout(4_000);
      check(
        'a silent stretch inside a reported turn stays working',
        (await status()) === 'working' && (await attentionOf()) === 'none'
      );

      // 3. A reported end settles instantly, even while bytes keep arriving —
      //    the measured 6-7s lie.
      await send('say still-painting-the-tui');
      await send('stop');
      await until(
        async () => (await status()) === 'done',
        'reported turn end to settle the glyph'
      );
      check('a reported turn end settles the glyph at once', true);

      // The watched/unwatched split is NOT asserted here: a Playwright-driven
      // Electron window never fires `browser-window-focus`, so nothing in this
      // environment is ever "watched" and the check would only ever prove the
      // harness's own quirk. `attention-monitor.test.ts` covers it with an
      // injectable focus state, which is where that belongs.

      // 4. A source that reports nothing behaves exactly as before — and
      //    starting it moves focus, so the Claude Session is now UNWATCHED,
      //    which is the case attention exists for.
      await page.keyboard.press('Meta+KeyT');
      await page.locator('[data-agent-composer]').waitFor();
      await page.getByLabel('Agent Source').click();
      await page.getByRole('option', { name: 'Codex' }).click();
      await page.getByRole('button', { name: 'Start' }).click();
      const codex = await until(
        async () => (await sessions()).find(s => s.harness === 'codex'),
        'Codex session'
      );
      check(
        'an unreporting source carries no turn report at all',
        codex.delegation == null
      );
      await page.waitForTimeout(2_000);
      check(
        'an unreporting source shows no delegation affordance',
        (await page.locator('[data-delegation]').count()) === 0
      );

      // 5. Unwatched: a reported end must raise the ready result at once.
      await send('turn');
      await until(
        async () => (await ownTurnOf()) === 'generating',
        'unwatched turn start'
      );
      await send('stop');
      await until(
        async () => (await attentionOf()) === 'turn-end',
        'result signal on an unwatched Session'
      );
      check('an unwatched reported end raises the ready result at once', true);

      // A superseded result must not survive into the next turn: the light
      // reads a turn-end as `result` regardless of turn state.
      await send('turn');
      await until(
        async () => (await ownTurnOf()) === 'generating',
        'the next turn to open'
      );
      check(
        'a new reported turn retires the previous ready result',
        (await attentionOf()) === 'none' && (await status()) === 'working'
      );
      await send('stop');
      await until(
        async () => (await attentionOf()) === 'turn-end',
        're-raised result'
      );

      // 6. Repeated cycles stay clean — no stuck state, no double raise.
      for (let turn = 0; turn < 3; turn += 1) {
        await send('turn');
        await until(
          async () => (await ownTurnOf()) === 'generating',
          `cycle ${turn} start`
        );
        await send('stop');
        await until(
          async () => (await ownTurnOf()) === 'available',
          `cycle ${turn} end`
        );
      }
      check('repeated reported turns cycle without sticking', true);

      // 7. Delegation still outranks a finished own turn (ENG-023 holds).
      await send('turn');
      await send('spawn a1');
      await send('stop');
      await page.waitForTimeout(2_500);
      const claudeRow = async () =>
        (await sessions()).find(s => s.id === claude.id);
      check(
        'a finished own turn with a live child is still reported busy',
        ((await claudeRow())?.delegation?.children?.length ?? 0) === 1 &&
          (await claudeRow())?.delegation?.ownTurn === 'available'
      );
      await send('done a1');
      await until(
        async () =>
          ((await claudeRow())?.delegation?.children?.length ?? 0) === 0,
        'the child to finish'
      );
      check('the Session settles once its last child finishes', true);
      // The withheld result must arrive HERE, at the last child's end. A
      // Session that fans out and finishes has to reach the attention queue.
      await until(
        async () => (await attentionOf()) === 'turn-end',
        'the withheld result once delegation completes'
      );
      check(
        'a delegating Session reaches the attention queue when its team finishes',
        true
      );

      // 8. Inference is untouched for a source that reports nothing. Driving
      //    the Codex Session directly is the control for the reported path:
      //    the same quiescence rule must still raise a result there.
      const sendCodex = async text =>
        page.evaluate(
          async ({ id, data }) => window.electron?.pty?.write(id, data),
          { id: codex.id, data: `${text}\r` }
        );
      const codexAttention = async () =>
        (await sessions()).find(s => s.id === codex.id)?.attention?.kind ??
        'none';
      // Inference deliberately ignores a Session inside its 20s spawn grace —
      // a fresh tab printing its banner and going quiet is not news. Wait that
      // out, or this measures the grace rather than the inference.
      const graceEndsAt = codex.startedAt + 21_000;
      if (Date.now() < graceEndsAt) {
        await page.waitForTimeout(graceEndsAt - Date.now());
      }
      // A burst that clears the DEFAULT 600-byte threshold, so this proves
      // inference itself rather than an env override reaching the main process.
      await sendCodex(`say ${'inferred-work-then-quiet '.repeat(40)}`);
      await until(
        async () => (await codexAttention()) === 'turn-end',
        'inference to settle an unreporting source',
        25_000
      );
      check('byte inference still settles a source that reports nothing', true);

      completed = true;
    },
    { maxMs: 240_000 }
  );
} finally {
  if (process.env.EXAWATT_KEEP_EVAL) {
    console.log(`[turn-truth] retained fixture: ${fixture.root}`);
  } else {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

if (!completed || failures.length > 0) {
  console.error(`FAIL turn truth — ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('PASS reported turn truth (ENG-015 S1.1)');
