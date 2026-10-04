import { describe, expect, it } from 'vitest';
import {
  INITIAL_AGENT_METRICS,
  type ExawattAgent,
  type FleetState,
} from '@exawatt/core';
import { selectFleetCensus } from './fleet-census';
import {
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  selectSpatialBandSelection,
} from './spatial-board';
const parent = (id: string, count = 17): ExawattAgent => ({
  id,
  name: 'Blocked parent',
  goal: 'parent-only',
  project: 'Demo',
  status: 'blocked',
  sessionKey: id,
  createdAt: 1,
  lastActivityAt: 1,
  metrics: INITIAL_AGENT_METRICS,
  delegation: {
    children: Array.from({ length: count }, (_, i) => ({
      id: `c${i}`,
      agentType: 'Explore',
      description: `worker ${i}`,
      startedAt: 1,
    })),
  },
});
const fleet = (agents: ExawattAgent[]): FleetState => ({
  agents: Object.fromEntries(agents.map(a => [a.id, a])),
  lastUpdated: 1,
  metrics: {
    activeCount: 0,
    blockedCount: 0,
    idleCount: 0,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  },
});
describe('delegation census before representation', () => {
  it('keeps a child-only match with an inspectable non-command root', () => {
    const state = fleet([parent('a')]);
    const census = selectFleetCensus(state, {
      query: 'worker 16',
      statuses: ['working'],
    });
    expect(census.matchingAgentIds.size).toBe(0);
    expect([...census.contextAgentIds]).toEqual(['a']);
    expect(census.matchingChildKeys.size).toBe(1);
    const layout = selectSpatialBoardLayout(state, { census });
    expect(selectSpatialDelegationUnits(layout)).toHaveLength(1);
    const selected = selectSpatialBandSelection(
      layout,
      selectSpatialDelegationUnits(layout),
      { x: -10000, y: -10000, width: 20000, height: 20000 }
    );
    expect(selected.agentIds).toEqual([]);
  });
  it('never combines parent text with child status', () => {
    const census = selectFleetCensus(fleet([parent('a')]), {
      query: 'parent-only',
      statuses: ['working'],
    });
    expect(census.visibleAgentIds.size).toBe(0);
  });
  it('scopes reused provider ids and never truncates the semantic roster', () => {
    const state = fleet([parent('one'), parent('two')]);
    const census = selectFleetCensus(state);
    expect(census.childrenByKey.size).toBe(34);
    expect(census.childrenByAgentId.get('one')).toHaveLength(17);
    const layout = selectSpatialBoardLayout(state, { census });
    const keys = selectSpatialDelegationUnits(layout).flatMap(
      u => u.childKeys ?? []
    );
    expect(new Set(keys)).toEqual(census.matchingChildKeys);
    expect(keys).toHaveLength(census.matchingChildKeys.size);
  });
  it('keeps opaque child identities distinct from overflow buckets and other roots', () => {
    const first = parent('a', 17);
    const second = parent('a:b', 1);
    first.delegation!.children[0]!.id = 'overflow';
    first.delegation!.children[1]!.id = 'b:c';
    second.delegation!.children[0]!.id = 'c';
    const state = fleet([first, second]);
    const census = selectFleetCensus(state);
    const units = selectSpatialDelegationUnits(
      selectSpatialBoardLayout(state, { census })
    );
    expect(units.some(unit => unit.kind === 'overflow')).toBe(true);
    expect(units.some(unit => unit.childId === 'overflow')).toBe(true);
    expect(new Set(units.map(unit => unit.id)).size).toBe(units.length);
    expect(new Set(units.flatMap(unit => unit.childKeys ?? []))).toEqual(
      census.matchingChildKeys
    );
  });
  it('conserves aggregate matches across graphics budgets', () => {
    const state = fleet(
      Array.from({ length: 300 }, (_, i) => parent(`a${i}`, 1))
    );
    const census = selectFleetCensus(state, { statuses: ['working'] });
    const layout = selectSpatialBoardLayout(state, { census });
    const keys = layout.pieces
      .filter(p => p.visible && p.kind === 'aggregate')
      .flatMap(p => p.childKeys ?? [])
      .concat(
        selectSpatialDelegationUnits(layout).flatMap(u => u.childKeys ?? [])
      );
    expect(new Set(keys)).toEqual(census.matchingChildKeys);
    expect(keys).toHaveLength(census.matchingChildKeys.size);
    expect(
      layout.pieces
        .filter(p => p.kind === 'aggregate')
        .reduce((n, p) => n + p.count, 0)
    ).toBe(0);
  });
  it('does not turn absent observation into a reported zero', () => {
    const absent = parent('absent', 0);
    delete absent.delegation;
    const census = selectFleetCensus(fleet([absent, parent('reported', 0)]));
    expect(census.childrenByAgentId.has('absent')).toBe(false);
    expect(census.childrenByAgentId.get('reported')).toEqual([]);
  });

  it('preserves hidden child metadata updates without repainting unchanged geometry', () => {
    const root = parent('a');
    const first = selectSpatialBoardLayout(fleet([root]));
    const child = root.delegation!.children.at(-1)!;
    child.description = 'Updated purpose beyond the drawing cap';
    const next = selectSpatialBoardLayout(fleet([root]), {
      previousLayout: first,
    });
    expect(
      next.census.childrenByAgentId.get(root.id)!.at(-1)!.description
    ).toBe(child.description);
    expect(next.census).not.toBe(first.census);
    expect(next.pieces).toBe(first.pieces);
    expect(next.delegationUnits).toBe(first.delegationUnits);
  });

  it('keeps unmatched population changes in the source summary', () => {
    const state = fleet([parent('a')]);
    const census = selectFleetCensus(state, { query: 'unmatched' });
    const first = selectSpatialBoardLayout(state, { census });
    const extra = parent('b', 0);
    delete extra.delegation;
    const nextState = fleet([parent('a'), extra]);
    const next = selectSpatialBoardLayout(nextState, {
      census: selectFleetCensus(nextState, { query: 'unmatched' }),
      previousLayout: first,
    });
    expect(next.census.summary.agentCount).toBe(
      Object.keys(nextState.agents).length
    );
    expect(next.census.summary.matchingAgentCount).toBe(0);
  });

  it('conserves matches when project budgets aggregate entire projects', () => {
    const roots = Array.from({ length: 40 }, (_, i) => ({
      ...parent(`a${i}`, 7),
      project: `Project ${i}`,
    }));
    const state = fleet(roots);
    const census = selectFleetCensus(state, { statuses: ['working'] });
    const layout = selectSpatialBoardLayout(state, { census });
    const represented = [
      ...layout.pieces
        .filter(p => p.visible && p.kind === 'aggregate')
        .flatMap(p => p.childKeys ?? []),
      ...selectSpatialDelegationUnits(layout).flatMap(u => u.childKeys ?? []),
    ];
    expect(new Set(represented)).toEqual(census.matchingChildKeys);
    expect(represented).toHaveLength(census.matchingChildKeys.size);
    const cleared = selectFleetCensus(state);
    expect(cleared.matchingAgentIds.size).toBe(roots.length);
    expect(cleared.contextAgentIds.size).toBe(0);
    expect(cleared.matchingChildKeys).toEqual(census.matchingChildKeys);
  });
  it('applies existing parent filters to aggregates without moving source coordinates', () => {
    const roots = Array.from({ length: 300 }, (_, index) =>
      parent(`a${index}`, 1)
    );
    const state = fleet(roots);
    const all = selectSpatialBoardLayout(state);
    const visibleAgentIds = new Set([roots[0]!.id, roots[1]!.id]);
    const filtered = selectSpatialBoardLayout(state, { visibleAgentIds });
    expect(
      filtered.pieces.reduce((count, piece) => count + piece.count, 0)
    ).toBe(visibleAgentIds.size);
    expect(filtered.zones.map(zone => zone.rect)).toEqual(
      all.zones.map(zone => zone.rect)
    );
    expect(filtered.census.summary.agentCount).toBe(roots.length);
    const empty = selectSpatialBoardLayout(state, {
      visibleAgentIds: new Set(),
    });
    expect(empty.zones.every(zone => !zone.visible)).toBe(true);
    expect(empty.pieces).toEqual([]);
  });
});
