import { describe, expect, it } from 'vitest';
import { createAgent, type ExawattAgent } from '../types/agent';
import type { FleetState, FleetMetrics } from '../types/fleet';
import { resolveContextGroups } from '../state/context-groups';

const EMPTY_METRICS: FleetMetrics = {
  activeCount: 0,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

function mk(
  partial: Partial<ExawattAgent> & { id: string; name: string }
): ExawattAgent {
  const base = createAgent(partial);
  return {
    ...base,
    metrics: {
      ...base.metrics,
      estimatedCost: partial.metrics?.estimatedCost ?? base.metrics.estimatedCost,
      costRate: partial.metrics?.costRate ?? base.metrics.costRate,
    },
  };
}

function stateOf(agents: ExawattAgent[]): FleetState {
  return {
    agents: Object.fromEntries(agents.map(a => [a.id, a])),
    metrics: EMPTY_METRICS,
    lastUpdated: 0,
  };
}

describe('resolveContextGroups', () => {
  const fixture = () =>
    stateOf([
      mk({
        id: 'a1',
        name: 'A1',
        project: 'Alpha',
        status: 'working',
        metrics: { ...createAgent({ id: 'x', name: 'x' }).metrics, costRate: 1, estimatedCost: 2 },
      }),
      mk({
        id: 'a2',
        name: 'A2',
        project: 'Alpha',
        status: 'idle',
      }),
      mk({
        id: 'b1',
        name: 'B1',
        project: 'Beta',
        status: 'blocked',
      }),
      mk({
        id: 'b2',
        name: 'B2',
        project: 'Beta',
        status: 'reviewing',
      }),
      mk({
        id: 'b3',
        name: 'B3',
        project: 'Beta',
        status: 'working',
      }),
    ]);

  it('groups agents by project string', () => {
    const groups = resolveContextGroups(fixture());
    expect(groups.map(g => g.label)).toEqual(['Alpha', 'Beta']); // label-sorted
    expect(groups.find(g => g.label === 'Alpha')!.agentIds).toHaveLength(2);
    expect(groups.find(g => g.label === 'Beta')!.agentIds).toHaveLength(3);
  });

  it('uses clusterId prefixed by kind, defaulting to project', () => {
    const groups = resolveContextGroups(fixture());
    expect(groups.every(g => g.kind === 'project')).toBe(true);
    expect(groups.find(g => g.label === 'Beta')!.clusterId).toBe('project:Beta');
  });

  it('status-priority sorts agentIds within a group (blocked first)', () => {
    const beta = resolveContextGroups(fixture()).find(g => g.label === 'Beta')!;
    // blocked < reviewing < working by STATUS_RANK
    expect(beta.agentIds).toEqual(['b1', 'b2', 'b3']);
  });

  it('computes summary counts and dominantStatus (worst status)', () => {
    const groups = resolveContextGroups(fixture());
    const beta = groups.find(g => g.label === 'Beta')!.summary;
    expect(beta.agentCount).toBe(3);
    expect(beta.blockedCount).toBe(1);
    expect(beta.activeCount).toBe(2); // working + reviewing
    expect(beta.idleCount).toBe(0);
    expect(beta.dominantStatus).toBe('blocked');

    const alpha = groups.find(g => g.label === 'Alpha')!.summary;
    expect(alpha.dominantStatus).toBe('working');
    expect(alpha.costRate).toBe(1);
    expect(alpha.totalCost).toBe(2);
  });

  it('attentionPressure is bounded 0..1 and rises with blockers', () => {
    const groups = resolveContextGroups(fixture());
    const alpha = groups.find(g => g.label === 'Alpha')!.summary.attentionPressure;
    const beta = groups.find(g => g.label === 'Beta')!.summary.attentionPressure;
    expect(alpha).toBe(0); // no blocked/reviewing
    expect(beta).toBeGreaterThan(0);
    expect(beta).toBeLessThanOrEqual(1);
  });

  it('is deterministic across repeated calls', () => {
    expect(resolveContextGroups(fixture())).toEqual(
      resolveContextGroups(fixture())
    );
  });

  it('buckets blank project strings under the ungrouped label', () => {
    const groups = resolveContextGroups(
      stateOf([mk({ id: 'n1', name: 'N1', project: '  ', status: 'idle' })]),
      { ungroupedLabel: 'Unassigned' }
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('Unassigned');
  });

  it('returns an empty array for an empty fleet', () => {
    expect(resolveContextGroups(stateOf([]))).toEqual([]);
  });
});
