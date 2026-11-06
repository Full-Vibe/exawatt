import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  attentionIsUnread,
  orderedAttentionTargets,
  type TurnInitiator,
} from '@exawatt/core';
import {
  AttentionMonitor,
  type AttentionBell,
  type ReportedTurn,
} from './attention-monitor';
import type { PtySessionManager } from './session-manager';

/**
 * The turn record (review front 2026-11-05): a turn opens in one place, at a
 * real boundary, and the initiator binds to that turn. Each case here is a
 * probe the review confirmed against the earlier loose-flag design, asserted
 * the right way round.
 */

class FakeManager extends EventEmitter {
  sessions: Array<{
    id: string;
    harness: string;
    startedAt: number;
    exited: boolean;
  }> = [];
  list() {
    return this.sessions.map(session => ({ ...session }));
  }
}

const peer: TurnInitiator = { kind: 'agent', sessionId: 's-b', name: 'b' };
const OPERATOR: TurnInitiator = { kind: 'operator' };

describe('the turn record', () => {
  let manager: FakeManager;
  let monitor: AttentionMonitor;
  let clock: number;
  let alerts: string[];
  let bells: AttentionBell[];
  let report: ReportedTurn | null;

  const add = (id: string, harness = 'claude') =>
    manager.sessions.push({ id, harness, startedAt: 0, exited: false });
  const data = (id: string, chunk: string) => manager.emit('data', id, chunk);
  const jumpTargets = (id: string) => {
    const attention = monitor.get(id);
    return orderedAttentionTargets(attention ? { [id]: attention } : {}, null);
  };
  const generating = (children: unknown[] = []): ReportedTurn => ({
    ownTurn: 'generating',
    blockedOn: null,
    children,
  });
  const available = (children: unknown[] = []): ReportedTurn => ({
    ownTurn: 'available',
    blockedOn: null,
    children,
  });

  beforeEach(() => {
    manager = new FakeManager();
    clock = 100_000;
    alerts = [];
    bells = [];
    report = null;
    monitor = new AttentionMonitor({
      quietMs: 4000,
      minBurstBytes: 100,
      spawnGraceMs: 20_000,
      now: () => clock,
    });
    monitor.attach(manager as unknown as PtySessionManager);
    monitor.setReportedTurnSource(() => report);
    monitor.on('alert', (id, record) =>
      alerts.push(`${id}:${record.kind}:${record.unread}`)
    );
    monitor.on('bell', (_id, bell) => bells.push(bell));
  });

  describe('a peer message delivered into the operator’s running turn', () => {
    // Review P8. The socket (Claude) joins the running turn; the queue
    // (Codex) runs it as the next turn. Neither may hand the operator's
    // turn to the peer because the output paused for a few seconds.
    for (const [harness, midTurn] of [
      ['claude', 'joins'],
      ['codex', 'next-turn'],
    ] as const)
      it(`${harness}: a pause and resumed output keep the turn the operator’s`, () => {
        add('a', harness);
        monitor.noteEngaged('a');
        report = generating();
        monitor.noteHarnessTurnStart('a');
        clock += 30_000;
        data('a', 'x'.repeat(300));
        monitor.expectTurn('a', peer, midTurn);
        clock += 3500;
        monitor.sweepNow();
        expect(monitor.isWorking('a')).toBe(false);
        data('a', 'y'.repeat(300));
        expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
        report = available();
        monitor.noteHarnessTurnEnd('a');
        expect(monitor.get('a')).toMatchObject({
          kind: 'turn-end',
          unread: true,
        });
        expect(alerts).toEqual(['a:turn-end:true']);
      });

    it('codex: the queued message opens the next turn, as the peer’s', () => {
      add('a', 'codex');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      monitor.expectTurn('a', peer, 'next-turn');
      report = available();
      monitor.noteHarnessTurnEnd('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      expect(monitor.turnInitiator('a')).toEqual(peer);
      report = available();
      monitor.noteHarnessTurnEnd('a');
      // the operator's result stays his, unread; the peer's adds nothing
      expect(alerts).toEqual(['a:turn-end:true']);
      expect(attentionIsUnread(monitor.get('a'))).toBe(true);
    });

    it('codex: back-to-back turns with no reported end still give the next turn to the peer', () => {
      add('a', 'codex');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      monitor.expectTurn('a', peer, 'next-turn');
      // the source's next observation is already the queued turn running
      monitor.noteHarnessTurnStart('a');
      expect(monitor.turnInitiator('a')).toEqual(peer);
    });
  });

  it('Antigravity: a queued door’s Enter into a running turn leaves that turn the operator’s', () => {
    // Review P7.
    add('a', 'antigravity');
    monitor.noteEngaged('a');
    report = generating();
    monitor.noteHarnessTurnStart('a');
    monitor.expectTurn('a', peer, 'next-turn');
    monitor.noteTurnOpened('a');
    expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
    report = available();
    monitor.noteHarnessTurnEnd('a');
    expect(monitor.get('a')).toMatchObject({ kind: 'turn-end', unread: true });
    expect(alerts).toEqual(['a:turn-end:true']);
    // the harness runs the queued message as its next turn: the peer's
    report = generating();
    monitor.noteHarnessTurnStart('a');
    expect(monitor.turnInitiator('a')).toEqual(peer);
  });

  it('a door’s Enter into an idle recipient opens the peer’s turn, and the source’s report of it is that same turn', () => {
    add('a', 'antigravity');
    monitor.expectTurn('a', peer, 'next-turn');
    monitor.noteTurnOpened('a');
    expect(monitor.turnInitiator('a')).toEqual(peer);
    report = generating();
    monitor.noteHarnessTurnStart('a');
    expect(monitor.turnInitiator('a')).toEqual(peer);
    report = available();
    monitor.noteHarnessTurnEnd('a');
    expect(attentionIsUnread(monitor.get('a'))).toBe(false);
    expect(alerts).toEqual([]);
  });

  describe('a turn nobody claimed is the operator’s', () => {
    it('after delegation and a peer turn, the parent resuming on its child’s result is his (P3)', () => {
      add('a');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      report = available([{}]);
      monitor.noteHarnessTurnEnd('a');
      monitor.expectTurn('a', peer, 'joins');
      report = generating([{}]);
      monitor.noteHarnessTurnStart('a');
      expect(monitor.turnInitiator('a')).toEqual(peer);
      report = available([{}]);
      monitor.noteHarnessTurnEnd('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
      report = available();
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true']);
    });

    it('a result withheld from the operator’s turn stays his when a peer turn ran meanwhile', () => {
      add('a');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      report = available([{}]);
      monitor.noteHarnessTurnEnd('a');
      monitor.expectTurn('a', peer, 'joins');
      report = generating([{}]);
      monitor.noteHarnessTurnStart('a');
      report = available([{}]);
      monitor.noteHarnessTurnEnd('a');
      // the last child ends with no resume: the withheld result arrives
      report = available();
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true']);
    });

    it('a message the running turn absorbed leaves no expectation behind (P2)', () => {
      add('a');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      monitor.expectTurn('a', peer, 'joins'); // read between tool calls
      report = available([{}]);
      monitor.noteHarnessTurnEnd('a');
      clock += 30_000;
      report = generating();
      monitor.noteHarnessTurnStart('a'); // resumes on its child's result
      expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
      report = available();
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true']);
    });

    it('a delivery that failed leaves no expectation: output ten minutes later is not the peer’s (P5)', () => {
      add('a', 'codex');
      const withdraw = monitor.expectTurn('a', peer, 'next-turn');
      withdraw(); // the door answered undeliverable
      clock += 600_000;
      data('a', 'z'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true']);
    });

    it('activity resuming after a pause is not a turn opening', () => {
      add('a', 'opencode');
      monitor.noteEngaged('a');
      data('a', 'x'.repeat(300));
      monitor.expectTurn('a', peer, 'next-turn');
      clock += 3500;
      monitor.sweepNow();
      data('a', 'y'.repeat(300));
      expect(monitor.turnInitiator('a')).toEqual(OPERATOR);
    });
  });

  describe('a new turn’s result supersedes the last one, whatever its read bit', () => {
    it('OpenCode: the operator’s result after a peer turn’s read result arrives unread (P4)', () => {
      add('a', 'opencode');
      monitor.expectTurn('a', peer, 'next-turn');
      monitor.noteTurnOpened('a');
      data('a', 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: false,
      });
      clock += 60_000;
      monitor.noteEngaged('a');
      data('a', 'y'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        since: clock,
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true']);
      expect(jumpTargets('a')).toEqual(['a']);
    });

    it('Grok: the next result after the operator viewed the last one arrives unread (P4b)', () => {
      add('a', 'grok');
      monitor.noteEngaged('a');
      data('a', 'x'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      monitor.setWindowFocused(true);
      monitor.setFocus('a');
      monitor.setFocus(null);
      clock += 60_000;
      monitor.noteEngaged('a');
      data('a', 'y'.repeat(500));
      clock += 5000;
      monitor.sweepNow();
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        since: clock,
        unread: true,
      });
      expect(alerts).toEqual(['a:turn-end:true', 'a:turn-end:true']);
    });

    it('a second raise inside the same turn is the same result, not a new one', () => {
      add('a');
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      report = available();
      monitor.noteHarnessTurnEnd('a');
      monitor.setWindowFocused(true);
      monitor.setFocus('a');
      monitor.setFocus(null);
      // a late duplicate boundary for the turn already accounted for
      monitor.noteHarnessTurnEnd('a');
      expect(attentionIsUnread(monitor.get('a'))).toBe(false);
      expect(alerts).toEqual(['a:turn-end:true']);
    });
  });

  describe('a turn another Agent started is quiet however it ends', () => {
    it('Claude’s idle bell a minute after a peer turn raises nothing (P1)', () => {
      add('a');
      report = generating();
      monitor.expectTurn('a', peer, 'joins');
      monitor.noteHarnessTurnStart('a');
      report = available();
      monitor.noteHarnessTurnEnd('a');
      clock += 60_000;
      data('a', '\x07');
      expect(monitor.get('a')).toMatchObject({
        kind: 'turn-end',
        unread: false,
      });
      expect(alerts).toEqual([]);
      expect(jumpTargets('a')).toEqual([]);
      expect(bells).toEqual([
        { signal: 'bel', outcome: 'suppressed', reason: 'agent-turn' },
      ]);
    });

    it('a terminal notification inside a peer turn raises nothing either', () => {
      add('a', 'opencode');
      monitor.expectTurn('a', peer, 'next-turn');
      monitor.noteTurnOpened('a');
      data('a', '\x1b]9;done\x07');
      expect(monitor.get('a')).toBeNull();
      expect(alerts).toEqual([]);
    });

    it('a request only the operator can answer still alerts, with its visible blocked state', () => {
      add('a');
      monitor.expectTurn('a', peer, 'joins');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      monitor.noteHarnessBlocked('a', 'blocking', 'permission-1');
      expect(monitor.get('a')).toMatchObject({ kind: 'blocked', unread: true });
      expect(alerts).toEqual(['a:blocked:true']);
      expect(jumpTargets('a')).toEqual(['a']);
    });

    it('a peer turn neither clears nor replaces a bell the operator is owed', () => {
      add('a', 'opencode');
      monitor.noteEngaged('a');
      data('a', 'x'.repeat(200));
      data('a', '\x07');
      const owed = monitor.get('a');
      expect(owed).toMatchObject({ kind: 'bell', unread: true });
      clock += 5000;
      monitor.sweepNow(); // the operator's turn is over
      report = generating();
      monitor.expectTurn('a', peer, 'next-turn');
      monitor.noteHarnessTurnStart('a');
      expect(monitor.get('a')).toEqual(owed);
    });
  });

  describe('sound and visible attention are one-to-one', () => {
    it('a bell upgraded to a permission request alerts once', () => {
      add('a', 'opencode');
      monitor.noteEngaged('a');
      data('a', '\x07');
      report = { ...available(), blockedOn: 'permission' };
      monitor.noteHarnessBlocked('a', 'blocking');
      expect(monitor.get('a')).toMatchObject({ kind: 'blocked' });
      expect(alerts).toEqual(['a:bell:true']);
    });

    it('a result behind an unread open question changes nothing visible, so it is silent', () => {
      add('a');
      monitor.noteEngaged('a');
      monitor.noteHarnessBlocked('a', 'working', 'q1');
      monitor.noteHarnessTurnEnd('a');
      expect(monitor.get('a')).toMatchObject({ kind: 'blocked', unread: true });
      expect(alerts).toEqual(['a:blocked:true']);
    });

    it('every alert coincides with a visible rise, and every source-caused rise alerts', () => {
      add('a', 'opencode');
      const visible = () => {
        const attention = monitor.get('a');
        return {
          needsYou: !!attention && attention.kind !== 'turn-end',
          unread: attentionIsUnread(attention),
        };
      };
      let before = visible();
      const trace: string[] = [];
      monitor.on('attention', () => {
        const after = visible();
        if (
          (!before.needsYou && after.needsYou) ||
          (!before.unread && after.unread)
        )
          trace.push('rise');
        before = after;
      });
      monitor.on('alert', () => trace.push('alert'));
      monitor.noteEngaged('a');
      data('a', 'x'.repeat(200));
      data('a', '\x07'); // rise: a bell
      monitor.noteHarnessBlocked('a', 'blocking', 'p1'); // same needs-you
      monitor.noteHarnessTurnEnd('a'); // gate gives way to a result, still unread
      monitor.setWindowFocused(true);
      monitor.setFocus('a');
      monitor.noteHarnessUnblocked('a', 'p1');
      monitor.setFocus(null);
      monitor.noteHarnessBlocked('a', 'working', 'q2'); // rise: a new question
      expect(trace).toEqual(['rise', 'alert', 'rise', 'alert']);
    });
  });

  describe('Exawatt’s own bytes are not process output', () => {
    it('the exit marker neither rings a bell nor feeds the quiet clock', () => {
      add('a');
      manager.emit('data', 'a', '[session stopped]\x07', 10, 'd', 'exawatt');
      expect(monitor.get('a')).toBeNull();
      expect(monitor.isWorking('a')).toBe(false);
    });
  });

  describe('an expected interrupt', () => {
    it('a lone Escape in a generating turn closes it at ordinary quiet, without the stale bound', () => {
      add('a');
      const stale: Array<{ cause: string; quietMs: number }> = [];
      monitor.on('reported-turn-stale', (_id, evidence) =>
        stale.push({ cause: evidence.cause, quietMs: evidence.quietMs })
      );
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      data('a', 'x'.repeat(300));
      monitor.noteEngaged('a', '\x1b');
      data('a', 'Interrupted');
      clock += 4000;
      monitor.sweepNow();
      expect(stale).toEqual([{ cause: 'interrupt', quietMs: 4000 }]);
    });

    it('Escape that answers an open gate is not an interrupt', () => {
      add('a');
      const stale: string[] = [];
      monitor.on('reported-turn-stale', (_id, evidence) =>
        stale.push(evidence.cause)
      );
      monitor.noteEngaged('a');
      report = generating();
      monitor.noteHarnessTurnStart('a');
      report = { ...generating(), blockedOn: 'permission' };
      monitor.noteHarnessBlocked('a', 'blocking', 'p1');
      monitor.noteEngaged('a', '\x1b');
      report = generating();
      monitor.noteHarnessUnblocked('a', 'p1');
      clock += 4000;
      monitor.sweepNow();
      expect(stale).toEqual([]);
    });
  });

  describe('suspended time is never silence', () => {
    it('a sleep inside a reported turn reclaims nothing', () => {
      let awake = 50_000;
      const asleep = new AttentionMonitor({
        quietMs: 4000,
        minBurstBytes: 100,
        spawnGraceMs: 20_000,
        now: () => clock,
        awake: () => awake,
      });
      asleep.attach(manager as unknown as PtySessionManager);
      asleep.setReportedTurnSource(() => report);
      const stale: string[] = [];
      asleep.on('reported-turn-stale', id => stale.push(id));
      add('a');
      asleep.noteEngaged('a');
      report = generating();
      asleep.noteHarnessTurnStart('a');
      data('a', 'x'.repeat(300));
      clock += 414_000; // the Mac slept; the awake clock did not move
      awake += 1000;
      asleep.sweepNow();
      expect(stale).toEqual([]);
    });
  });
});
