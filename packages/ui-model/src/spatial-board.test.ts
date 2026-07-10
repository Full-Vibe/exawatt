import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  selectSpatialBoardLayout,
  spatialBoardPieceForAgent,
  spatialBoardZoneForAgent,
} from './spatial-board';

const metrics: FleetMetrics = {
  activeCount: 0,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

function agent(
  id: string,
  project: string,
  status: ExawattAgent['status'] = 'idle'
): ExawattAgent {
  return {
    id,
    name: `Agent ${id}`,
    status,
    goal: `Work assigned to ${id}`,
    project,
    sessionKey: id,
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      turnCount: 0,
      startedAt: null,
      duration: 0,
      costRate: 0,
      tokenRate: 0,
      costHistory: [],
    },
    lastActivityAt: 0,
    createdAt: 0,
  };
}

function fleet(agents: ExawattAgent[]): FleetState {
  return {
    agents: Object.fromEntries(agents.map(item => [item.id, item])),
    metrics,
    lastUpdated: 1,
  };
}

function projectFleet(projectCount: number, agentsPerProject = 1): FleetState {
  const agents: ExawattAgent[] = [];
  for (let project = 0; project < projectCount; project++) {
    for (let member = 0; member < agentsPerProject; member++) {
      agents.push(
        agent(
          `p${String(project).padStart(3, '0')}-a${String(member).padStart(4, '0')}`,
          `Project ${String(project).padStart(3, '0')}`,
          member % 9 === 0 ? 'blocked' : member % 3 === 0 ? 'working' : 'idle'
        )
      );
    }
  }
  return fleet(agents);
}

describe('selectSpatialBoardLayout', () => {
  it('returns a finite empty board', () => {
    const layout = selectSpatialBoardLayout(fleet([]));
    expect(layout.zones).toEqual([]);
    expect(layout.pieces).toEqual([]);
    expect(layout.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(layout.stats.sourceAgentCount).toBe(0);
  });

  it.each([1, 2, 3, 6])(
    'places %i sparse Projects on a compact fixed lattice',
    projectCount => {
      const layout = selectSpatialBoardLayout(projectFleet(projectCount));
      expect(layout.zones).toHaveLength(projectCount);
      expect(new Set(layout.zones.map(zone => zone.slotIndex)).size).toBe(
        projectCount
      );
      expect(layout.bounds.width).toBeLessThanOrEqual(111);
      expect(layout.bounds.height).toBeLessThanOrEqual(37);
      for (const zone of layout.zones) {
        expect(Number.isFinite(zone.rect.x)).toBe(true);
        expect(Number.isFinite(zone.rect.y)).toBe(true);
      }
    }
  );

  it('is invariant to FleetState insertion order and projection', () => {
    const agents = [
      agent('z', 'Zulu', 'working'),
      agent('a', 'Alpha', 'blocked'),
      agent('m', 'Middle', 'idle'),
    ];
    const forward = selectSpatialBoardLayout(fleet(agents), {
      projection: 'top-down',
    });
    const reverse = selectSpatialBoardLayout(fleet([...agents].reverse()), {
      projection: 'fixed-angle',
    });
    expect(reverse).toEqual(forward);
  });

  it('does not move Projects or Agents when only live status changes', () => {
    const beforeState = fleet([
      agent('a', 'Alpha', 'idle'),
      agent('b', 'Alpha', 'working'),
      agent('c', 'Beta', 'blocked'),
    ]);
    const afterState = fleet([
      agent('a', 'Alpha', 'blocked'),
      agent('b', 'Alpha', 'idle'),
      agent('c', 'Beta', 'working'),
    ]);
    const before = selectSpatialBoardLayout(beforeState);
    const after = selectSpatialBoardLayout(afterState);
    expect(after.zones.map(zone => zone.rect)).toEqual(
      before.zones.map(zone => zone.rect)
    );
    expect(after.pieces.map(piece => [piece.id, piece.x, piece.y])).toEqual(
      before.pieces.map(piece => [piece.id, piece.x, piece.y])
    );
  });

  it('applies filters after placement so surviving addresses stay stable', () => {
    const state = fleet([
      agent('a', 'Alpha'),
      agent('b', 'Alpha'),
      agent('c', 'Beta'),
    ]);
    const full = selectSpatialBoardLayout(state);
    const filtered = selectSpatialBoardLayout(state, {
      visibleAgentIds: new Set(['b']),
    });
    expect(spatialBoardZoneForAgent(filtered, 'b')?.rect).toEqual(
      spatialBoardZoneForAgent(full, 'b')?.rect
    );
    expect(spatialBoardPieceForAgent(filtered, 'b')).toMatchObject({
      x: spatialBoardPieceForAgent(full, 'b')?.x,
      y: spatialBoardPieceForAgent(full, 'b')?.y,
      visible: true,
    });
    expect(spatialBoardPieceForAgent(filtered, 'a')?.visible).toBe(false);
    expect(filtered.minimap.visibleZoneIds).toEqual(['project:Alpha']);
  });

  it('uses the previous layout to keep existing slots when entities arrive', () => {
    const initialState = fleet([
      agent('b', 'Beta'),
      agent('c', 'Gamma'),
      agent('beta-2', 'Beta'),
    ]);
    const initial = selectSpatialBoardLayout(initialState);
    const nextState = fleet([
      agent('a', 'Alpha'),
      agent('b', 'Beta'),
      agent('c', 'Gamma'),
      agent('beta-1', 'Beta'),
      agent('beta-2', 'Beta'),
    ]);
    const next = selectSpatialBoardLayout(nextState, {
      previousLayout: initial,
    });
    expect(spatialBoardZoneForAgent(next, 'b')?.rect).toEqual(
      spatialBoardZoneForAgent(initial, 'b')?.rect
    );
    expect(spatialBoardZoneForAgent(next, 'c')?.rect).toEqual(
      spatialBoardZoneForAgent(initial, 'c')?.rect
    );
    expect(spatialBoardPieceForAgent(next, 'beta-2')).toMatchObject({
      x: spatialBoardPieceForAgent(initial, 'beta-2')?.x,
      y: spatialBoardPieceForAgent(initial, 'beta-2')?.y,
    });
  });

  it('folds distant Projects into one bounded aggregate zone', () => {
    const layout = selectSpatialBoardLayout(projectFleet(30), {
      maxProjectZones: 4,
    });
    expect(layout.zones).toHaveLength(5);
    expect(layout.zones.at(-1)).toMatchObject({
      id: 'aggregate:remaining-projects',
      isAggregate: true,
      aggregatedProjectCount: 26,
      agentCount: 26,
    });
    expect(layout.stats.sourceProjectCount).toBe(30);
  });

  it('keeps a 10,000-Agent fleet structurally bounded', () => {
    const layout = selectSpatialBoardLayout(projectFleet(50, 200), {
      maxProjectZones: 24,
    });
    expect(layout.stats.sourceAgentCount).toBe(10_000);
    expect(layout.zones).toHaveLength(25);
    expect(layout.pieces.length).toBeLessThanOrEqual(25 * 6);
    expect(layout.stats.aggregatedAgentCount).toBe(10_000);
    expect(layout.pieces.every(piece => piece.kind === 'aggregate')).toBe(true);
  });

  it('budgets labels while keeping the selected Agent label visible', () => {
    const state = fleet([
      agent('a', 'Alpha'),
      agent('b', 'Alpha'),
      agent('c', 'Alpha'),
      agent('d', 'Alpha'),
      agent('e', 'Alpha'),
    ]);
    const layout = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: 'project:Alpha',
      selectedAgentId: 'e',
      projectAgentLabelLimit: 2,
    });
    expect(layout.stats.visibleLabelCount).toBe(3);
    expect(spatialBoardPieceForAgent(layout, 'e')?.labelVisibility).toBe(
      'always'
    );
    expect(spatialBoardPieceForAgent(layout, 'd')?.labelVisibility).toBe(
      'selected'
    );
  });

  it('focuses Agent camera bounds without duplicating Session content', () => {
    const state = fleet([agent('a', 'Alpha'), agent('b', 'Alpha')]);
    const layout = selectSpatialBoardLayout(state, {
      altitude: 'agent',
      selectedAgentId: 'b',
    });
    const piece = spatialBoardPieceForAgent(layout, 'b')!;
    expect(layout.altitude).toBe('agent');
    expect(layout.focusedProjectId).toBe('project:Alpha');
    expect(layout.cameraBounds).toMatchObject({ width: 12, height: 12 });
    expect(layout.cameraBounds.x).toBeCloseTo(piece.x - 6, 4);
    expect(layout.cameraBounds.y).toBeCloseTo(piece.y - 6, 4);
  });

  it('gracefully ascends stale Project and Agent deep links to Fleet', () => {
    const state = fleet([agent('a', 'Alpha')]);
    expect(
      selectSpatialBoardLayout(state, {
        altitude: 'project',
        focusedProjectId: 'project:missing',
      }).altitude
    ).toBe('fleet');
    expect(
      selectSpatialBoardLayout(state, {
        altitude: 'agent',
        selectedAgentId: 'missing',
      }).altitude
    ).toBe('fleet');
  });
});
