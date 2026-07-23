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

  it('keeps a finished turn stable until explicit operator engagement', () => {
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

    // A late idle repaint is not a new turn and cannot replace the check
    // with the working pie.
    manager.emit('data', 'a', 'passive TUI repaint'.repeat(100));
    expect(monitor.isWorking('a')).toBe(false);
    expect(transitions).toHaveLength(2);

    // Explicit human engagement opens the next turn immediately; it does not
    // depend on prompt echo, which can be absent or resize-guarded.
    monitor.noteEngaged('a');
    expect(monitor.isWorking('a')).toBe(true);
    manager.emit('data', 'a', 'next turn output');
    expect(monitor.isWorking('a')).toBe(true);
    expect(transitions.at(-1)).toEqual({ id: 'a', working: true });
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
    manager.emit('data', 'a', 'late prompt repaint'.repeat(100));
    expect(monitor.isWorking('a')).toBe(false);
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
