import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { AttentionMonitor } from '../pty/attention-monitor';
import type { PtySessionManager } from '../pty/session-manager';
import { DelegationMonitor } from './delegation-monitor';
import { TURN_RECLAIMED_EVENT, wireReportedTurnTruth } from './turn-truth';

/**
 * The wiring between reported and inferred truth (ENG-023 D4/D7), tested as
 * the unit it is: the light-level contract lives in
 * `turn-truth-pipeline.test.ts`; this pins the evidence trail and its bounds.
 */

class FakeManager extends EventEmitter {
  sessions = [{ id: 'S', harness: 'claude', startedAt: 0, exited: false }];
  list() {
    return this.sessions.map(s => ({ ...s }));
  }
}

function rig() {
  let clock = 100_000;
  const manager = new FakeManager();
  const delegation = new DelegationMonitor();
  const attention = new AttentionMonitor({
    quietMs: 4000,
    minBurstBytes: 600,
    spawnGraceMs: 0,
    now: () => clock,
  });
  attention.attach(manager as unknown as PtySessionManager);
  const log: Array<{ event: string; fields: Record<string, unknown> }> = [];
  wireReportedTurnTruth({
    attention,
    delegation,
    now: () => clock,
    record: (event, fields = {}) => log.push({ event, fields }),
    harnessOf: () => 'claude',
  });
  return {
    attention,
    delegation,
    log,
    get reclaims() {
      return log.filter(entry => entry.event === TURN_RECLAIMED_EVENT);
    },
    silence: (ms: number) => {
      clock += ms;
      attention.sweepNow();
    },
    stream: (bytes: number) => manager.emit('data', 'S', 'x'.repeat(bytes)),
  };
}

describe('wireReportedTurnTruth', () => {
  it('does not resolve or re-alert a restored working request on a new turn', () => {
    const r = rig();
    let alerts = 0;
    r.attention.on('alert', () => alerts++);
    r.attention.restore('S', {
      kind: 'blocked',
      since: 1,
      unread: false,
      request: 'working',
      requestId: 'old:0',
    });
    r.delegation.report('S', { kind: 'turn-start' });
    expect(r.attention.get('S')).toMatchObject({
      requestId: 'old:0',
      unread: false,
    });
    r.delegation.report('S', {
      kind: 'blocked',
      reason: 'question',
      request: 'working',
      requestId: 'old:0',
    });
    expect(alerts).toBe(0);
    expect(r.attention.get('S')?.unread).toBe(false);
  });

  it('only a source release for the active gate may clear attention', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'blocked', reason: 'question' });
    r.delegation.report('S', { kind: 'unblocked', reason: 'permission' });
    expect(r.attention.get('S')?.kind).toBe('blocked');
    r.delegation.report('S', { kind: 'unblocked', reason: 'question' });
    expect(r.attention.get('S')).toBeNull();
  });

  it('keeps content-free evidence of a Stop and its remaining census', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.delegation.report('S', {
      kind: 'turn-end',
      census: { live: [], completed: [], at: 1 },
    });
    expect(
      r.log
        .filter(entry => entry.event === 'harness.turn-truth')
        .map(entry => entry.fields)
    ).toEqual([
      {
        sessionId: 'S',
        harness: 'claude',
        boundary: 'turn-start',
        ownTurn: 'generating',
        blockedOn: null,
        childCount: 0,
        backgroundTypes: [],
      },
      {
        sessionId: 'S',
        harness: 'claude',
        boundary: 'turn-end',
        ownTurn: 'available',
        blockedOn: null,
        childCount: 0,
        backgroundTypes: [],
      },
    ]);
  });

  it('keeps an async request through completion and quiet unknown observations', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.delegation.report('S', {
      kind: 'blocked',
      reason: 'question',
      request: 'working',
      requestId: 'question:0',
    });
    expect(r.attention.isWorking('S')).toBe(true);
    r.delegation.report('S', { kind: 'turn-end' });
    expect(r.delegation.get('S')?.blockedOn).toBe('question');
    expect(r.attention.get('S')?.kind).toBe('blocked');
    r.delegation.report('S', { kind: 'turn-unknown' });
    r.silence(120_000);
    expect(r.delegation.get('S')?.ownTurn).toBe('unknown');
    expect(r.attention.get('S')?.kind).toBe('blocked');
    r.delegation.report('S', { kind: 'unblocked', reason: 'question' });
    expect(r.attention.get('S')).toBeNull();
  });

  it('logs a reclaimed turn with the children it left standing and the silence that closed it', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.delegation.report('S', {
      kind: 'child-start',
      childId: 'c1',
      agentType: 'Explore',
      at: 1,
    });
    r.silence(13_000);
    expect(r.reclaims).toEqual([
      {
        event: TURN_RECLAIMED_EVENT,
        fields: expect.objectContaining({
          sessionId: 'S',
          harness: 'claude',
          ownTurn: 'generating',
          childCount: 1,
          staleMs: 12_000,
        }),
      },
    ]);
    expect(r.reclaims[0].fields.quietMs).toBeGreaterThanOrEqual(12_000);
    // The child stays the source's claim; its presence withholds the result.
    expect(r.delegation.get('S')).toMatchObject({
      ownTurn: 'available',
      children: [{ id: 'c1' }],
    });
    expect(r.attention.get('S')).toBeNull();
  });

  it('never withdraws a reported child by silence; its own end delivers the withheld result (BUG-258)', () => {
    // Every silence-expired child in the operator's log (154 of 154) was a
    // background child whose transcript shows it still running.
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.delegation.report('S', {
      kind: 'child-start',
      childId: 'c1',
      agentType: null,
      at: 1,
    });
    r.delegation.report('S', { kind: 'turn-end' });
    expect(r.attention.get('S')).toBeNull();
    for (let minute = 0; minute < 17; minute += 1) r.silence(60_000);
    expect(r.delegation.get('S')?.children).toHaveLength(1);
    expect(r.attention.get('S')).toBeNull();
    expect(r.reclaims).toEqual([]);
    r.delegation.report('S', { kind: 'child-end', childId: 'c1' });
    expect(r.attention.get('S')?.kind).toBe('turn-end');
    expect(r.delegation.getLive('S')).toBeNull();
  });

  it('a census-only record never delivers a result on a child end (BUG-257)', () => {
    // A Codex parent observed through its children before its own turn was
    // ever reported holds the ledger default; the last child finishing a step
    // must not read as the parent's withheld result.
    const r = rig();
    r.delegation.reconcileReportedChildren('S', [
      { id: 'c1', agentType: 'Codex', description: null, startedAt: 1 },
    ]);
    r.delegation.reconcileReportedChildren('S', [], ['c1']);
    expect(r.attention.get('S')).toBeNull();
    // Once the source itself reports the turn, the same path delivers.
    r.delegation.report('S', { kind: 'turn-end' });
    r.delegation.reconcileReportedChildren('S', [
      { id: 'c2', agentType: 'Codex', description: null, startedAt: 2 },
    ]);
    r.delegation.reconcileReportedChildren('S', [], ['c2']);
    expect(r.attention.get('S')?.kind).toBe('turn-end');
  });

  it('reclaims a bare aborted turn and raises its result from its own burst', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.silence(13_000);
    expect(r.delegation.get('S')?.ownTurn).toBe('available');
    expect(r.attention.get('S')?.kind).toBe('turn-end');
    expect(r.reclaims).toEqual([
      {
        event: TURN_RECLAIMED_EVENT,
        fields: expect.objectContaining({
          ownTurn: 'generating',
          childCount: 0,
        }),
      },
    ]);
  });

  it('never reclaims a turn behind an open gate', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.delegation.report('S', {
      kind: 'child-start',
      childId: 'c1',
      agentType: null,
      at: 1,
    });
    r.delegation.report('S', { kind: 'blocked', reason: 'question' });
    r.silence(120_000);
    expect(r.delegation.get('S')?.children).toHaveLength(1);
    expect(r.delegation.get('S')?.ownTurn).toBe('generating');
    expect(r.reclaims).toEqual([]);
  });
});
