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
      estimatedCost:
        partial.metrics?.estimatedCost ?? base.metrics.estimatedCost,
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
        metrics: {
          ...createAgent({ id: 'x', name: 'x' }).metrics,
          costRate: 1,
          estimatedCost: 2,
        },
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
    expect(groups.find(g => g.label === 'Beta')!.clusterId).toBe(
      'project:Beta'
    );
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
    const alpha = groups.find(g => g.label === 'Alpha')!.summary
      .attentionPressure;
    const beta = groups.find(g => g.label === 'Beta')!.summary
      .attentionPressure;
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

  it('keeps known Projects without inventing Agents and joins later Agents by stable id', () => {
    const projects = [{ id: '/code/alpha', label: 'Alpha' }];
    const empty = resolveContextGroups(stateOf([]), { projects });
    expect(empty).toEqual([
      expect.objectContaining({
        clusterId: 'project:/code/alpha',
        label: 'Alpha',
        agentIds: [],
        summary: expect.objectContaining({ agentCount: 0 }),
      }),
    ]);

    const active = resolveContextGroups(
      stateOf([
        mk({
          id: 'a1',
          name: 'A1',
          projectId: '/code/alpha',
          project: 'Alpha (stale label)',
        }),
      ]),
      { projects }
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      clusterId: 'project:/code/alpha',
      label: 'Alpha',
      agentIds: ['a1'],
    });
  });
});

/*
 * ENG-010: a coworker whose source reported no work state.
 *
 * The cluster resolver is the first thing every altitude reads, so a claim
 * invented here travels to the board, the Team overview, and the metrics row
 * at once.
 */
describe('a work state nobody reported', () => {
  const mixed = () =>
    stateOf([
      mk({ id: 'u1', name: 'Unheard', project: 'Alpha', status: null }),
      mk({ id: 'a1', name: 'Resting', project: 'Alpha', status: 'idle' }),
      mk({ id: 'a2', name: 'Busy', project: 'Alpha', status: 'working' }),
    ]);

  it('is not counted as an idle Agent', () => {
    const alpha = resolveContextGroups(mixed()).find(
      g => g.label === 'Alpha'
    )!.summary;
    expect(alpha.agentCount).toBe(3);
    // One reported idle, not two. The buckets describe what sources said, so
    // they are free to sum to less than the population.
    expect(alpha.idleCount).toBe(1);
    expect(alpha.activeCount).toBe(1);
    expect(alpha.blockedCount).toBe(0);
    expect(
      alpha.activeCount + alpha.blockedCount + alpha.idleCount
    ).toBeLessThan(alpha.agentCount);
  });

  it('sorts after every Agent whose source said something', () => {
    const alpha = resolveContextGroups(mixed()).find(g => g.label === 'Alpha')!;
    expect(alpha.agentIds).toEqual(['a2', 'a1', 'u1']);
  });

  it('never becomes the cluster dominant state', () => {
    const alpha = resolveContextGroups(mixed()).find(
      g => g.label === 'Alpha'
    )!.summary;
    expect(alpha.dominantStatus).toBe('working');
  });

  it('leaves a cluster nobody has reported on with no dominant state', () => {
    const silent = stateOf([
      mk({ id: 'u1', name: 'Unheard', project: 'Quiet', status: null }),
      mk({ id: 'u2', name: 'Also unheard', project: 'Quiet', status: null }),
    ]);
    const quiet = resolveContextGroups(silent).find(
      g => g.label === 'Quiet'
    )!.summary;
    // `idle` used to be the answer here, about two Agents nobody had heard
    // from. `null` is a tint that claims nothing.
    expect(quiet.dominantStatus).toBeNull();
    expect(quiet.idleCount).toBe(0);
    expect(quiet.agentCount).toBe(2);
  });

  it('leaves an empty Project with no dominant state either', () => {
    const [empty] = resolveContextGroups(stateOf([]), {
      projects: [{ id: 'p1', label: 'Nobody here' }],
    });
    expect(empty!.summary.agentCount).toBe(0);
    expect(empty!.summary.dominantStatus).toBeNull();
  });
});
