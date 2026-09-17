import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { AttentionMonitor } from '../pty/attention-monitor';
import type { PtySessionManager } from '../pty/session-manager';
import { boundDiagnosticRecorder } from '../diagnostics-log';
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
    silence: (ms: number) => {
      clock += ms;
      attention.sweepNow();
    },
    stream: (bytes: number) => manager.emit('data', 'S', 'x'.repeat(bytes)),
  };
}

describe('wireReportedTurnTruth', () => {
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
    expect(r.log).toEqual([
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
    expect(r.log[0].fields.quietMs).toBeGreaterThanOrEqual(12_000);
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
    expect(r.log).toEqual([]);
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
    expect(r.log).toEqual([]);
  });
});

describe('boundDiagnosticRecorder', () => {
  it('caps records per minute with one suppression line, and per run with one exhaustion line', () => {
    let clock = 0;
    const sink: string[] = [];
    const record = boundDiagnosticRecorder(
      (event, fields) => sink.push(`${event}${fields?.n ?? ''}`),
      { perMinute: 2, perRun: 3, now: () => clock }
    );
    record('x', { n: 1 });
    record('x', { n: 2 });
    record('x', { n: 3 });
    record('x', { n: 4 });
    expect(sink).toEqual(['x1', 'x2', 'x.suppressed']);
    clock += 60_000;
    record('x', { n: 5 });
    record('x', { n: 6 });
    record('x', { n: 7 });
    expect(sink).toEqual(['x1', 'x2', 'x.suppressed', 'x5', 'x.exhausted']);
  });
});
