import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { AttentionMonitor } from '../pty/attention-monitor';
import type { PtySessionManager } from '../pty/session-manager';
import { DelegationMonitor } from './delegation-monitor';
import { CENSUS_EXPIRED_EVENT, wireReportedTurnTruth } from './turn-truth';

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
    get expiries() {
      return log.filter(entry => entry.event === CENSUS_EXPIRED_EVENT);
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

  it('logs an expired census with the child ids and the silence that expired it', () => {
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.delegation.report('S', {
      kind: 'child-start',
      childId: 'c1',
      agentType: 'Explore',
      at: 1,
    });
    r.delegation.report('S', { kind: 'turn-end' });
    r.silence(13_000);
    expect(r.expiries).toEqual([
      {
        event: CENSUS_EXPIRED_EVENT,
        fields: expect.objectContaining({
          sessionId: 'S',
          harness: 'claude',
          childIds: ['c1'],
          agentTypes: ['Explore'],
          ownTurn: 'available',
          staleMs: 12_000,
        }),
      },
    ]);
    expect(r.expiries[0].fields.quietMs).toBeGreaterThanOrEqual(12_000);
  });

  it('delivers the withheld result when the parent had already reported its turn ended', () => {
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
    r.silence(13_000);
    expect(r.attention.get('S')?.kind).toBe('turn-end');
    expect(r.delegation.getLive('S')).toBeNull();
  });

  it('reclaims a bare aborted turn without logging a census expiry', () => {
    // No children were withdrawn, so there is nothing to leave evidence of;
    // the D4 reclaim is unchanged.
    const r = rig();
    r.delegation.report('S', { kind: 'turn-start' });
    r.stream(2000);
    r.silence(13_000);
    expect(r.delegation.get('S')?.ownTurn).toBe('available');
    expect(r.attention.get('S')?.kind).toBe('turn-end');
    expect(r.expiries).toEqual([]);
  });

  it('never expires a census behind an open gate', () => {
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
    expect(r.expiries).toEqual([]);
  });
});
