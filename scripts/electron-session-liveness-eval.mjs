#!/usr/bin/env node

/**
 * Session liveness (ENG-002, ENG-016; BUG-330, BUG-102's evidence).
 *
 * A Claude Code Agent's working counter froze on screen for a minute or two
 * and nothing could say afterwards whether the harness stopped writing or the
 * pane stopped painting. This drives the real app against the fixture Claude,
 * whose `count` command redraws an elapsed counter every second exactly as
 * Claude Code does, and reads `logs/harness-events.jsonl` for the answer:
 *
 * 1. While the harness counts and the pane paints, nothing is recorded, and
 *    the pane's window is on the record as reporting.
 * 2. The page's main thread is frozen while the harness keeps counting: the
 *    record names the PANE, and its recovery once the page paints again.
 * 3. The harness stops counting inside an open turn: the record names the
 *    HARNESS, and its recovery once it writes again. The pane is not blamed.
 *
 * Bounds are shortened for eval time only (quiescence 1.5 s, so the reported
 * turn's stale bound is 4.5 s; pane bound 4 s); production keeps its own.
 */
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { sweepOrphans, withElectronApp } from './lib/electron-eval.mjs';
import {
  createHarnessFixture,
  fixtureLaunch,
  openFixtureSession,
} from './lib/harness-event-fixture.mjs';

const PANE_STALL_MS = 4_000;
const fixture = createHarnessFixture('exawatt-session-liveness');
const failures = [];
const check = (label, ok, detail = '') => {
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok || !detail ? '' : ` — ${detail}`}`
  );
  if (!ok) failures.push(label);
};

/** Every liveness line so far. A log that does not exist yet has none; any
 *  other read failure throws rather than reading as "no stall". */
function livenessLines() {
  let raw;
  try {
    raw = readFileSync(
      join(fixture.userData, 'logs', 'harness-events.jsonl'),
      'utf8'
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(line => line.event.startsWith('liveness.'));
}

sweepOrphans();
let completed = false;
try {
  await withElectronApp(
    fixtureLaunch(fixture, {
      EXAWATT_ATTENTION_QUIET_MS: '1500',
      EXAWATT_ATTENTION_MIN_BURST: '1',
      EXAWATT_LIVENESS_PAINT_STALL_MS: String(PANE_STALL_MS),
    }),
    async (_app, page) => {
      page.on('pageerror', error =>
        console.log(`[session-liveness] pageerror: ${error.message}`)
      );
      const { claude, sessions, until, send } = await openFixtureSession(
        page,
        fixture
      );
      const durable = claude.durableSessionId;
      const mine = line =>
        line.durableSessionId === durable || line.ptyId === claude.id;
      const stalls = side =>
        livenessLines().filter(
          line =>
            line.event === 'liveness.stall' && line.side === side && mine(line)
        );
      const clears = side =>
        livenessLines().filter(
          line =>
            line.event === 'liveness.stall-cleared' &&
            line.side === side &&
            mine(line)
        );
      const ownTurn = async () =>
        (await sessions()).find(s => s.id === claude.id)?.delegation?.ownTurn ??
        'unreported';

      // 1. A working Agent whose pane paints: the window reports, nothing stalls.
      await send('turn');
      await until(
        async () => (await ownTurn()) === 'generating',
        'reported turn start'
      );
      await send('count');
      await until(
        async () =>
          livenessLines().some(
            line =>
              line.event === 'liveness.paint-reporting' &&
              line.state === 'started'
          ),
        'the window to start reporting its panes'
      );
      const counterText = () =>
        page.evaluate(id => {
          const term = window.__XTERMS__?.[id];
          const buffer = term?.buffer?.active;
          if (!buffer) return null;
          const line = buffer.getLine(buffer.baseY + buffer.cursorY);
          return line?.translateToString(true) ?? null;
        }, claude.id);
      await page.waitForTimeout(1_500);
      const before = await counterText();
      await page.waitForTimeout(3 * PANE_STALL_MS);
      const after = await counterText();
      check(
        'a working Agent’s pane keeps up with its counter',
        typeof before === 'string' &&
          typeof after === 'string' &&
          /Clauding/.test(after) &&
          before !== after,
        `${JSON.stringify(before)} → ${JSON.stringify(after)}`
      );
      check(
        'nothing is recorded while the harness writes and the pane paints',
        stalls('pane').length === 0 && stalls('harness').length === 0,
        JSON.stringify(livenessLines())
      );

      // 2. The page freezes while the harness keeps counting: the pane stopped.
      await page.evaluate(ms => {
        const end = performance.now() + ms;
        while (performance.now() < end) {
          // a renderer main thread that does not come back for a while
        }
      }, PANE_STALL_MS + 5_000);
      await until(
        async () => clears('pane').length > 0,
        'the pane stall to clear once the page paints again',
        15_000
      );
      const [pane] = stalls('pane');
      check(
        'a frozen page while the harness writes is recorded as the pane',
        stalls('pane').length === 1 &&
          pane.unpaintedMs >= PANE_STALL_MS &&
          pane.unpaintedChars > 0 &&
          typeof pane.windowId === 'number',
        JSON.stringify(stalls('pane'))
      );
      check(
        'its recovery says how long the pane was stalled',
        clears('pane')[0]?.cause === 'painted' &&
          clears('pane')[0]?.stalledMs >= PANE_STALL_MS,
        JSON.stringify(clears('pane'))
      );
      check(
        'the harness is not blamed for a frozen page',
        stalls('harness').length === 0,
        JSON.stringify(stalls('harness'))
      );

      // 3. The harness stops counting inside its turn: the harness stopped.
      await send('freeze');
      await until(
        async () => stalls('harness').length > 0,
        'the harness stall to be recorded',
        20_000
      );
      const [harness] = stalls('harness');
      check(
        'a harness that stops writing inside an open turn is recorded as the harness',
        harness.silentMs >= 4_500 &&
          harness.harness === 'claude' &&
          harness.inputBeforeSilence === false &&
          harness.inputDuringSilence === false,
        JSON.stringify(harness)
      );
      await page.waitForTimeout(3_000);
      await send('count');
      await until(
        async () => clears('harness').length > 0,
        'the harness stall to clear once it writes again',
        10_000
      );
      check(
        'its recovery says how long the harness was silent',
        clears('harness')[0]?.cause === 'output' &&
          clears('harness')[0]?.stalledMs >= 7_500,
        JSON.stringify(clears('harness'))
      );
      check(
        'the pane is not blamed for a silent harness',
        stalls('pane').length === 1,
        JSON.stringify(stalls('pane'))
      );
      check(
        'every liveness line is content-free',
        livenessLines().every(
          line => !JSON.stringify(line).includes('Clauding')
        )
      );
      await send('freeze');
      completed = true;
    },
    { maxMs: 240_000 }
  );
} finally {
  if (process.env.EXAWATT_KEEP_EVAL) {
    console.log(`[session-liveness] retained fixture: ${fixture.root}`);
  } else {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

if (!completed || failures.length > 0) {
  console.error(`FAIL session liveness — ${failures.length} check(s) failed`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('PASS session liveness names the side that stopped (BUG-330)');
