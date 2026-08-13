import { EventEmitter } from 'events';
import { describe, it, expect, beforeEach } from 'vitest';
import { AttentionMonitor } from './attention-monitor';
import type { PtySessionManager } from './session-manager';

/**
 * Attention monitor unit tests (ENG-015 S1): the detection state machine
 * against a fake session manager, with an injected clock — no PTYs, no
 * Electron, no timers.
 */

interface FakeSession {
  id: string;
  harness: string;
  startedAt: number;
  exited: boolean;
}

class FakeManager extends EventEmitter {
  sessions: FakeSession[] = [];
  list() {
    return this.sessions.map(s => ({ ...s }));
  }
}

const BELL = '\x07';

/** the reported record a harness with N running children publishes */
const reportBusy = (busy: Set<string>, id: string) => ({
  ownTurn: 'available' as const,
  blockedOn: null,
  children: busy.has(id) ? [{}] : [],
});

describe('AttentionMonitor', () => {
  let manager: FakeManager;
  let monitor: AttentionMonitor;
  let clock: number;
  let events: Array<{ id: string; att: unknown }>;

  const add = (id: string, harness = 'claude', startedAt = 0) => {
    manager.sessions.push({ id, harness, startedAt, exited: false });
  };
  const data = (id: string, chunk: string) => manager.emit('data', id, chunk);

  beforeEach(() => {
    manager = new FakeManager();
    clock = 100_000;
    monitor = new AttentionMonitor({
      quietMs: 4000,
      minBurstBytes: 100,
      spawnGraceMs: 20_000,
      now: () => clock,
    });
    monitor.attach(manager as unknown as PtySessionManager);
    events = [];
    monitor.on('attention', (id: string, att: unknown) =>
      events.push({ id, att })
    );
  });

  it('raises on a raw bell in an unfocused session', () => {
    add('a');
    data('a', `output${BELL}more`);
    expect(monitor.get('a')).toEqual({ kind: 'bell', since: clock });
    expect(monitor.count()).toBe(1);
  });

  it('ignores BELs that terminate OSC sequences (title updates)', () => {
    add('a');
    data('a', `\x1b]0;my window title${BELL}plain output`);
    expect(monitor.get('a')).toBeNull();
  });

  it('treats OSC 9 / OSC 777 notifications as bells', () => {
    add('a');
    add('b');
    data('a', `\x1b]9;Claude needs your input${BELL}`);
    data('b', `\x1b]777;notify;Title;Body\x1b\\`);
    expect(monitor.get('a')?.kind).toBe('bell');
    expect(monitor.get('b')?.kind).toBe('bell');
  });

  it('handles OSC sequences split across chunks without false bells', () => {
    add('a');
    data('a', '\x1b]0;long titl');
    data('a', `e continues${BELL}after`); // BEL here TERMINATES the carried OSC
    expect(monitor.get('a')).toBeNull();
    // and a REAL bell after the sequence still registers
    data('a', `ping${BELL}`);
    expect(monitor.get('a')?.kind).toBe('bell');
  });

  it('handles ESC ] split exactly at the chunk boundary', () => {
    add('a');
    data('a', 'text\x1b');
    data('a', `]0;title${BELL}rest`);
    expect(monitor.get('a')).toBeNull();
  });

  it('oversized split OSC (clipboard/image payloads) rings no phantom bell', () => {
    add('a');
    // 8KB OSC 52 split across chunks: the carry cap must preserve the
    // ESC ] introducer or the terminator BEL reads as a real bell
    data('a', `\x1b]52;c;${'A'.repeat(8000)}`);
    data('a', `${'B'.repeat(100)}${BELL}after`);
    expect(monitor.get('a')).toBeNull();
    // the scanner still catches a REAL bell afterwards
    data('a', `ping${BELL}`);
    expect(monitor.get('a')?.kind).toBe('bell');
  });

  it('suppresses bells on the watched session (focused tab + focused window)', () => {
    add('a');
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    data('a', `ding${BELL}`);
    expect(monitor.get('a')).toBeNull();
  });

  it('flags the ACTIVE tab when the app window is in the background', () => {
    // the single-tab case this system exists for: operator is in another app
    add('a');
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    monitor.setWindowFocused(false); // ⌘-tab away
    data('a', `done!${BELL}`);
    expect(monitor.get('a')?.kind).toBe('bell');
    // coming back to the app = looking at the active tab -> clears
    monitor.setWindowFocused(true);
    expect(monitor.get('a')).toBeNull();
  });

  it('raises turn-end after a work burst goes quiet (harness only)', () => {
    add('claude-1', 'claude', clock - 60_000);
    add('sh-1', 'shell', clock - 60_000);
    data('claude-1', 'x'.repeat(500));
    data('sh-1', 'y'.repeat(500));
    monitor.sweepNow(); // still active — within quietMs
    expect(monitor.get('claude-1')).toBeNull();
    clock += 5000; // past quietMs
    monitor.sweepNow();
    expect(monitor.get('claude-1')?.kind).toBe('turn-end');
    expect(monitor.get('sh-1')).toBeNull(); // shells never infer turn-end
  });

  it('does not flag small bursts (below minBurstBytes)', () => {
    add('a', 'claude', clock - 60_000);
    data('a', 'tiny');
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')).toBeNull();
  });

  it('consumes the burst at the quiet boundary (no re-flag loop)', () => {
    add('a', 'claude', clock - 60_000);
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')?.kind).toBe('turn-end');
    monitor.setWindowFocused(true);
    monitor.setFocus('a'); // operator looks — clears
    monitor.setFocus(null); // ...and looks away again
    clock += 5000;
    monitor.sweepNow(); // burst already consumed: nothing new to flag
    expect(monitor.get('a')).toBeNull();
  });

  it('respects the spawn grace period', () => {
    add('a', 'claude', clock); // just spawned
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')).toBeNull(); // within spawnGraceMs
  });

  it('never turn-ends the watched session', () => {
    add('a', 'claude', clock - 60_000);
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')).toBeNull();
  });

  it('turn-ends the active tab when the window is unfocused', () => {
    add('a', 'claude', clock - 60_000);
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    monitor.setWindowFocused(false);
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')?.kind).toBe('turn-end');
  });

  it('clears on focus (in a focused window) and emits null', () => {
    add('a');
    data('a', `ding${BELL}`);
    expect(monitor.count()).toBe(1);
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    expect(monitor.get('a')).toBeNull();
    expect(events).toEqual([
      { id: 'a', att: { kind: 'bell', since: clock } },
      { id: 'a', att: null },
    ]);
  });

  it('input clears ONLY the watched session (xterm auto-replies must not)', () => {
    add('a');
    add('b');
    data('a', `ding${BELL}`);
    data('b', `ding${BELL}`);
    // hidden pane auto-answers a cursor query for 'a' — not engagement
    monitor.setWindowFocused(true);
    monitor.setFocus('b'); // clears b (focused); a stays flagged
    monitor.noteInput('a');
    expect(monitor.get('a')?.kind).toBe('bell');
    // real typing into the watched session clears it
    data('b', `ding-again${BELL}`); // b unflagged (watched) — stays null
    expect(monitor.get('b')).toBeNull();
    monitor.setFocus('a');
    expect(monitor.get('a')).toBeNull(); // focusing cleared it
  });

  it('keeps a finished turn stable until explicit operator engagement, for a reported source', () => {
    // Mirrors production Claude: a live report record exists (even a stale
    // one), so the settle this session reaches is corroborated, not a lone
    // guess, and repaint noise must not be able to undo it.
    monitor.setReportedTurnSource(() => ({
      ownTurn: 'available',
      blockedOn: null,
      children: [],
    }));
    add('a', 'claude', clock - 60_000);
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')?.kind).toBe('turn-end');
    // Repaint noise cannot reopen a finished turn, regardless of size.
    data('a', 'y'.repeat(50));
    expect(monitor.get('a')?.kind).toBe('turn-end');
    data('a', 'z'.repeat(600));
    expect(monitor.get('a')?.kind).toBe('turn-end');
    expect(monitor.isWorking('a')).toBe(false);

    // Looking/answering clears attention and explicitly opens the next turn.
    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    monitor.noteEngaged('a');
    data('a', 'real next-turn output');
    expect(monitor.get('a')).toBeNull();
    expect(monitor.isWorking('a')).toBe(true);
  });

  it('keeps the quiescence clock running while the latch holds (BUG-008)', () => {
    // A BEL mid-turn latches the Session, and the latch rightly stops those
    // bytes from reading as WORK. It must not stop them counting as SPEECH:
    // the stale-report reclaim asks whether this Session has been silent long
    // enough that its reported-open turn cannot still be real, and a Session
    // that is streaming has not been silent at all.
    const stale: string[] = [];
    monitor.on('reported-turn-stale', (id: string) => stale.push(id));
    monitor.setReportedTurnSource(() => ({
      ownTurn: 'generating',
      blockedOn: null,
      children: [],
    }));
    add('a', 'claude', clock - 60_000);
    data('a', `waiting${BELL}`);
    expect(monitor.isWorking('a')).toBe(false);

    for (let i = 0; i < 20; i += 1) {
      data('a', 'x'.repeat(500));
      clock += 1000;
      monitor.sweepNow();
    }
    // the latch still holds — these bytes never became "working"
    expect(monitor.isWorking('a')).toBe(false);
    // but nothing declared a talking Session's open turn stale
    expect(stale).toEqual([]);
  });

  it('reopens a settled turn on real subsequent output, for a source with no report at all (BUG-001)', () => {
    // Codex/OpenCode today: `reportedTurn` stays null for the session's whole
    // life, so quiescence is not corroborated by anything — a settle it
    // produces is a guess, not a fact, and cannot outrank real output that
    // arrives after it. The alternative (today's default fixture, above)
    // would leave a session that is genuinely still working stuck showing
    // "done" for the rest of the turn, which is strictly worse than an
    // occasional flicker back to working from noise that then goes quiet
    // again on its own.
    add('a', 'claude', clock - 60_000); // harness name is incidental — what
    // matters is no setReportedTurnSource() call, i.e. reportedTurn(id) is
    // always null, exactly the Codex/OpenCode shape today.
    data('a', 'x'.repeat(500));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')?.kind).toBe('turn-end');
    expect(monitor.isWorking('a')).toBe(false);

    // Real subsequent output — no BEL, no engagement — reopens working.
    data('a', 'more real output the agent is still producing'.repeat(20));
    expect(monitor.isWorking('a')).toBe(true);

    // And it can settle again cleanly once it actually goes quiet.
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.isWorking('a')).toBe(false);
  });

  it('keeps the ORIGINAL since when signals repeat (stable queue order)', () => {
    add('a');
    data('a', `ding${BELL}`);
    const first = monitor.get('a')?.since;
    clock += 1000;
    data('a', `ding${BELL}`);
    expect(monitor.get('a')?.since).toBe(first);
  });

  it('clears on session exit', () => {
    add('a');
    data('a', `ding${BELL}`);
    manager.emit('exit', 'a', 0);
    expect(monitor.get('a')).toBeNull();
    expect(monitor.count()).toBe(0);
  });

  it('drops residue for sessions that vanish from the manager (killed tabs)', () => {
    add('a');
    data('a', `ding${BELL}`);
    manager.sessions = [];
    monitor.sweepNow();
    expect(monitor.count()).toBe(0);
  });

  /**
   * Delegation (ENG-023). Byte quiescence cannot see a Session's children, so
   * a parent that handed work off and went quiet looked exactly like one that
   * finished. The harness reports the difference.
   */
  describe('delegated work', () => {
    const goQuietAfterWork = (id: string) => {
      data(id, 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
    };

    it('raises turn-end when nothing was delegated', () => {
      add('a');
      goQuietAfterWork('a');
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('withholds turn-end while children are still running', () => {
      const busy = new Set(['a']);
      monitor.setReportedTurnSource(id => reportBusy(busy, id));
      add('a');
      goQuietAfterWork('a');
      // the Session's OWN turn ended, but there is no result to read yet
      expect(monitor.get('a')).toBeNull();
    });

    it('raises turn-end normally once the last child finishes', () => {
      const busy = new Set(['a']);
      monitor.setReportedTurnSource(id => reportBusy(busy, id));
      add('a');
      goQuietAfterWork('a');
      expect(monitor.get('a')).toBeNull();

      busy.clear();
      // a returning child reopens the turn, the parent works, then settles
      monitor.noteHarnessTurnStart('a');
      goQuietAfterWork('a');
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('only withholds for the delegating Session', () => {
      monitor.setReportedTurnSource(id => reportBusy(new Set(['a']), id));
      add('a');
      add('b');
      data('a', 'x'.repeat(500));
      data('b', 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toBeNull();
      expect(monitor.get('b')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('reopens a settled turn on a reported turn start', () => {
      // The turn a returning child opens is preceded by no keystroke, so the
      // settled latch would otherwise hold the Session visually quiet while
      // it works through the result.
      add('a');
      goQuietAfterWork('a');
      expect(monitor.isWorking('a')).toBe(false);

      monitor.noteHarnessTurnStart('a');
      expect(monitor.isWorking('a')).toBe(true);
      expect(monitor.isEngaged('a')).toBe(true);
      // and ordinary output now counts again rather than being latched out
      data('a', 'y'.repeat(500));
      expect(monitor.isWorking('a')).toBe(true);
    });

    it('retires a superseded result when a new turn is reported', () => {
      // Measured on a real Session: the previous turn's result signal survived
      // into the next turn, and the light reads a turn-end as `result` no
      // matter the turn state — so it showed "result ready" while the Agent
      // was visibly working again.
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')?.kind).toBe('turn-end');
      monitor.noteHarnessTurnStart('a');
      expect(monitor.get('a')).toBeNull();
      expect(monitor.isWorking('a')).toBe(true);
    });

    it('never retires a real operator gate on a new turn', () => {
      // A question or a block is not answered by more output arriving.
      add('a', 'claude', clock - 60_000);
      data('a', `needs you${BELL}`);
      expect(monitor.get('a')?.kind).toBe('bell');
      monitor.noteHarnessTurnStart('a');
      expect(monitor.get('a')?.kind).toBe('bell');
    });

    it('ignores a reported turn start for a shell or a dead session', () => {
      add('s', 'shell');
      monitor.noteHarnessTurnStart('s');
      expect(monitor.isWorking('s')).toBe(false);

      add('a');
      manager.sessions[1].exited = true;
      monitor.noteHarnessTurnStart('a');
      expect(monitor.isWorking('a')).toBe(false);
      expect(monitor.isEngaged('a')).toBe(false);
    });

    it('settles a reported turn end immediately, without waiting for silence', () => {
      // Inference needs minBurst + quietMs. A reported boundary must not.
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      expect(monitor.isWorking('a')).toBe(true);
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.isWorking('a')).toBe(false);
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('leaves inference running as a backstop for an unreported end', () => {
      // A turn that aborts, or a harness that dies mid-turn, reports nothing.
      // Quiescence must still settle it rather than hanging on working.
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('does not double-raise when both paths observe the same turn', () => {
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      const reportedAt = clock;
      monitor.noteHarnessTurnEnd('a');
      clock += 5000;
      monitor.sweepNow();
      // the ORIGINAL signal is retained, so the attention queue stays ordered
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: reportedAt });
      expect(events.filter(e => e.id === 'a' && e.att)).toHaveLength(1);
    });

    it('consumes the burst so the next sweep cannot re-raise the same turn', () => {
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      monitor.setWindowFocused(true);
      monitor.setFocus('a');
      monitor.setFocus(null);
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toBeNull();
    });

    it('never raises a reported end on the watched Session', () => {
      add('a', 'claude', clock - 60_000);
      monitor.setWindowFocused(true);
      monitor.setFocus('a');
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toBeNull();
      // but it still settles, so an idle repaint cannot resurrect "working"
      expect(monitor.isWorking('a')).toBe(false);
    });

    it('withholds a reported end while children are still running', () => {
      const busy = new Set(['a']);
      monitor.setReportedTurnSource(id => reportBusy(busy, id));
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toBeNull();
    });

    it('does not apply the spawn grace to a reported end', () => {
      // The grace protects INFERENCE from reading a startup banner as a
      // finished turn. A reported boundary is unambiguous, and most first
      // turns finish inside the 20s grace — swallowing their result would
      // make the feature useless exactly when a Session is newest.
      add('a', 'claude', clock); // just spawned
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
      // inference still respects it
      add('b', 'claude', clock);
      data('b', 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('b')).toBeNull();
    });

    it('ignores a reported end for a shell or a dead session', () => {
      add('s', 'shell', clock - 60_000);
      monitor.noteHarnessTurnEnd('s');
      expect(monitor.get('s')).toBeNull();

      add('a', 'claude', clock - 60_000);
      manager.sessions[1].exited = true;
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toBeNull();
    });

    it('cycles cleanly across repeated reported turns', () => {
      add('a', 'claude', clock - 60_000);
      for (let turn = 0; turn < 3; turn += 1) {
        monitor.noteHarnessTurnStart('a');
        expect(monitor.isWorking('a')).toBe(true);
        data('a', 'x'.repeat(300));
        clock += 1000;
        monitor.noteHarnessTurnEnd('a');
        expect(monitor.isWorking('a')).toBe(false);
        expect(monitor.get('a')?.kind).toBe('turn-end');
        // the operator looks, clearing it, and the next turn opens clean
        monitor.setWindowFocused(true);
        monitor.setFocus('a');
        monitor.setFocus(null);
        monitor.setWindowFocused(false);
        expect(monitor.get('a')).toBeNull();
        clock += 1000;
      }
    });

    it('raises the withheld result once the last child finishes', () => {
      // The delegating Session's result arrives at its LAST CHILD's end, not
      // at its own turn end — that boundary was withheld on purpose. Without
      // re-raising, a Session that fans out and finishes never enters the
      // attention queue, which is the Session most worth returning to.
      const busy = new Set(['a']);
      monitor.setReportedTurnSource(id => reportBusy(busy, id));
      add('a', 'claude', clock - 60_000);
      data('a', 'x'.repeat(500));
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toBeNull();

      busy.clear();
      monitor.noteHarnessTurnEnd('a'); // what the last child-end triggers
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    it('defaults to reporting nothing delegated', () => {
      // A source with no delegation capability never calls the setter; the
      // monitor must behave exactly as it did before ENG-023.
      add('a');
      goQuietAfterWork('a');
      expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });
    });

    /**
     * The idle nudge of a delegating parent (operator report, 2026-08-13).
     *
     * Measured against Claude Code 2.1.231 launched exactly as Exawatt
     * launches it: `UserPromptSubmit` +1.2s, `SubagentStart` +3.5s, `Stop`
     * +4.5s, a BARE BEL at +64.5s — 60.0s after the parent's own turn ended —
     * and `SubagentStop` for that same child only at +135.8s. Every other
     * raise path already deferred to the reported record; this one did not, so
     * Sessions with demonstrably busy teams went amber.
     */
    describe('the idle bell of a delegating parent', () => {
      const report = (state: {
        children: number;
        blockedOn?: string | null;
      }) => ({
        ownTurn: 'available' as const,
        blockedOn: state.blockedOn ?? null,
        children: Array.from({ length: state.children }, () => ({})),
      });

      it('does not raise needs-you while delegated children are running', () => {
        monitor.setReportedTurnSource(() => report({ children: 1 }));
        add('a');
        data('a', 'x'.repeat(500));
        monitor.noteHarnessTurnEnd('a'); // the parent's own `Stop`
        clock += 60_000; // the harness nudges its idle prompt
        data('a', BELL);
        expect(monitor.get('a')).toBeNull();
      });

      it('still raises needs-you when nothing was delegated', () => {
        monitor.setReportedTurnSource(() => report({ children: 0 }));
        add('a');
        data('a', 'x'.repeat(500));
        monitor.noteHarnessTurnEnd('a');
        clock += 60_000;
        data('a', BELL);
        expect(monitor.get('a')).toEqual({ kind: 'bell', since: clock });
      });

      it('still raises needs-you for a gate held while children run', () => {
        // The case the suppression must not cost: a parent parked on a
        // permission decision it cannot answer itself, with its team still
        // working. The reported gate is the guaranteed-human channel.
        monitor.setReportedTurnSource(() =>
          report({ children: 1, blockedOn: 'permission' })
        );
        add('a');
        data('a', 'x'.repeat(500));
        clock += 60_000;
        data('a', BELL);
        expect(monitor.get('a')).toEqual({ kind: 'bell', since: clock });
      });

      it('raises the reported gate itself while children run', () => {
        // Belt and braces on the same seam from the other direction: the D4
        // gate path never consulted delegation and must not start.
        const gate = { children: 1, blockedOn: null as string | null };
        monitor.setReportedTurnSource(() => report(gate));
        add('a');
        gate.blockedOn = 'question';
        monitor.noteHarnessBlocked('a');
        expect(monitor.get('a')).toEqual({ kind: 'blocked', since: clock });
      });

      it('returns to ordinary bell behavior once the team finishes', () => {
        const team = { children: 1 };
        monitor.setReportedTurnSource(() => report(team));
        add('a');
        data('a', 'x'.repeat(500));
        monitor.noteHarnessTurnEnd('a');
        clock += 60_000;
        data('a', BELL);
        expect(monitor.get('a')).toBeNull();

        // the last child ends: the withheld result raises as it always did …
        team.children = 0;
        monitor.noteHarnessTurnEnd('a');
        expect(monitor.get('a')).toEqual({ kind: 'turn-end', since: clock });

        // … and the next bell upgrades that result to a human gate again
        clock += 60_000;
        data('a', BELL);
        expect(monitor.get('a')).toEqual({ kind: 'bell', since: clock });
      });

      /**
       * Grok Build (ENG-003 S4) has Claude Code-compatible hooks but no
       * per-launch seam Exawatt can inject into, so it launches unsubscribed
       * and reports nothing. The suppression must therefore not fire for it:
       * `teamWorkingWithoutGate` reads the REPORTED record, and a source that
       * writes none has no children to defer to. A source with no reported
       * channel keeps ordinary inference — the same posture Codex and
       * OpenCode already have.
       */
      it('leaves an unsubscribed source on ordinary inference', () => {
        monitor.setReportedTurnSource(() => null);
        add('a', 'grok');
        data('a', 'x'.repeat(500));
        clock += 60_000;
        data('a', BELL);
        expect(monitor.get('a')).toEqual({ kind: 'bell', since: clock });
      });
    });
  });
});

describe('AttentionMonitor activity truth (D18)', () => {
  let manager: FakeManager;
  let monitor: AttentionMonitor;
  let clock: number;
  let transitions: Array<{ id: string; working: boolean }>;

  beforeEach(() => {
    manager = new FakeManager();
    clock = 100_000;
    monitor = new AttentionMonitor({
      quietMs: 4000,
      minBurstBytes: 100,
      spawnGraceMs: 20_000,
      now: () => clock,
    });
    monitor.attach(manager as unknown as PtySessionManager);
    transitions = [];
    monitor.on('activity', (id: string, working: boolean) =>
      transitions.push({ id, working })
    );
  });

  it('marks a session working on output and quiet after the window', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    manager.emit('data', 'a', 'streaming output');
    expect(transitions).toEqual([{ id: 'a', working: true }]);
    expect(monitor.isWorking('a')).toBe(true);

    // continued output does not re-emit
    manager.emit('data', 'a', 'more output');
    expect(transitions).toHaveLength(1);

    clock += 3500;
    monitor.sweepNow();
    expect(transitions).toEqual([
      { id: 'a', working: true },
      { id: 'a', working: false },
    ]);
    expect(monitor.isWorking('a')).toBe(false);

    // This session has no reported-turn source (the Codex/OpenCode shape):
    // inference is the only signal, so real subsequent output reopens it
    // rather than freezing a guess against all future evidence (BUG-001,
    // decision `0018` amendment). The stable-against-repaint-noise case for
    // a REPORTED source is covered separately, below.
    manager.emit('data', 'a', 'passive TUI repaint'.repeat(100));
    expect(monitor.isWorking('a')).toBe(true);
    expect(transitions).toHaveLength(3);

    // Explicit human engagement still opens the next turn immediately; it
    // does not depend on prompt echo, which can be absent or resize-guarded.
    clock += 3500;
    monitor.sweepNow();
    monitor.noteEngaged('a');
    expect(monitor.isWorking('a')).toBe(true);
    manager.emit('data', 'a', 'next turn output');
    expect(monitor.isWorking('a')).toBe(true);
    expect(transitions.at(-1)).toEqual({ id: 'a', working: true });
  });

  it('keeps a repaint from reopening working when a reported source exists', () => {
    // Mirrors production Claude: `reportedTurn` returns a live (even if
    // stale) record, so the settle is corroborated and repaint noise must
    // not undo it — the exact case D38 was written to fix.
    monitor.setReportedTurnSource(() => ({
      ownTurn: 'available',
      blockedOn: null,
      children: [],
    }));
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    manager.emit('data', 'a', 'streaming output');
    clock += 3500;
    monitor.sweepNow();
    expect(monitor.isWorking('a')).toBe(false);

    manager.emit('data', 'a', 'passive TUI repaint'.repeat(100));
    expect(monitor.isWorking('a')).toBe(false);

    monitor.noteEngaged('a');
    expect(monitor.isWorking('a')).toBe(true);
  });

  it('keeps shell activity output-driven because shells have no turns', () => {
    manager.sessions.push({
      id: 'shell',
      harness: 'shell',
      startedAt: 0,
      exited: false,
    });
    manager.emit('data', 'shell', 'first command');
    clock += 3500;
    monitor.sweepNow();
    expect(monitor.isWorking('shell')).toBe(false);

    manager.emit('data', 'shell', 'later command');
    expect(monitor.isWorking('shell')).toBe(true);
  });

  it('guards synchronous WINCH output before resizing the PTY (D24)', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    monitor.runWithResizeGuard('a', () => {
      // node-pty may emit this synchronously from resize(); the guard must
      // exist before the side effect begins, not after resize returns.
      manager.emit('data', 'a', 'full TUI repaint after WINCH');
    });
    expect(monitor.isWorking('a')).toBe(false);
    expect(transitions).toEqual([]);
    // real output beyond the grace window still reads as working
    clock += 2500;
    manager.emit('data', 'a', 'genuine agent output');
    expect(monitor.isWorking('a')).toBe(true);
  });

  it('treats BEL as a turn boundary, never as stale working output', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    manager.emit('data', 'a', 'streaming output');
    expect(monitor.isWorking('a')).toBe(true);

    manager.emit('data', 'a', `waiting for the operator${BELL}`);

    expect(monitor.get('a')?.kind).toBe('bell');
    expect(monitor.isWorking('a')).toBe(false);
    expect(transitions).toEqual([
      { id: 'a', working: true },
      { id: 'a', working: false },
    ]);

    monitor.setWindowFocused(true);
    monitor.setFocus('a');
    // No reported-turn source is wired (the Codex/OpenCode shape): a BEL
    // settle from pure inference is still just a guess, so real subsequent
    // output reopens it (BUG-001, decision `0018` amendment). The
    // stable-against-repaint case for a REPORTED source is covered by
    // 'keeps a repaint from reopening working when a reported source exists'.
    manager.emit('data', 'a', 'late prompt repaint'.repeat(100));
    expect(monitor.isWorking('a')).toBe(true);
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')).toBeNull();
  });

  it('drops the working state when the session exits', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    manager.emit('data', 'a', 'output');
    manager.emit('exit', 'a');
    expect(transitions).toEqual([
      { id: 'a', working: true },
      { id: 'a', working: false },
    ]);
  });
});

describe('AttentionMonitor started truth (D22)', () => {
  let manager: FakeManager;
  let monitor: AttentionMonitor;
  let clock: number;
  let engagedEvents: string[];

  beforeEach(() => {
    manager = new FakeManager();
    clock = 100_000;
    monitor = new AttentionMonitor({
      quietMs: 4000,
      minBurstBytes: 100,
      spawnGraceMs: 20_000,
      now: () => clock,
    });
    monitor.attach(manager as unknown as PtySessionManager);
    engagedEvents = [];
    monitor.on('engaged', (id: string) => engagedEvents.push(id));
  });

  it('starts unengaged; noteEngaged marks and emits exactly once', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    expect(monitor.isEngaged('a')).toBe(false);
    monitor.noteEngaged('a');
    monitor.noteEngaged('a');
    expect(monitor.isEngaged('a')).toBe(true);
    expect(engagedEvents).toEqual(['a']);
  });

  it('repeated engagement reopens a settled turn without re-emitting startedness', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    monitor.noteEngaged('a');
    manager.emit('data', 'a', 'first turn');
    clock += 3500;
    monitor.sweepNow();
    expect(monitor.isWorking('a')).toBe(false);

    monitor.noteEngaged('a');
    manager.emit('data', 'a', 'second turn');
    expect(monitor.isWorking('a')).toBe(true);
    expect(engagedEvents).toEqual(['a']);
  });

  it('spawn-banner output alone does not mark a session started', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      // just spawned: the welcome banner arrives inside the spawn grace
      startedAt: 100_000,
      exited: false,
    });
    manager.emit('data', 'a', 'Welcome to Claude Code!\n'.repeat(20));
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.isEngaged('a')).toBe(false);
  });

  it('a raised turn-end implies the session started', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 100_000 - 30_000, // past spawn grace
      exited: false,
    });
    manager.emit('data', 'a', 'x'.repeat(200)); // real work burst
    clock += 5000;
    monitor.sweepNow();
    expect(monitor.get('a')?.kind).toBe('turn-end');
    expect(monitor.isEngaged('a')).toBe(true);
    expect(engagedEvents).toEqual(['a']);
  });

  it('clearing attention (operator looked) does not clear startedness', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    monitor.noteEngaged('a');
    monitor.setWindowFocused(true);
    monitor.setFocus('a'); // clears attention, must not clear startedness
    expect(monitor.isEngaged('a')).toBe(true);
  });

  it('drops engagement when the session exits', () => {
    manager.sessions.push({
      id: 'a',
      harness: 'claude',
      startedAt: 0,
      exited: false,
    });
    monitor.noteEngaged('a');
    manager.emit('exit', 'a', 0);
    expect(monitor.isEngaged('a')).toBe(false);
  });
});
