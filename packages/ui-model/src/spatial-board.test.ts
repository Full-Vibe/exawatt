import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  selectSpatialBandAgentIds,
  selectSpatialBoardLayout,
  selectSpatialDirectionalAgentId,
  selectSpatialScopeActivity,
  spatialBoardPieceForAgent,
  spatialBoardZoneForAgent,
  type SpatialBoardRect,
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

  it('renders a known zero-Agent Project and preserves its zone when an Agent starts', () => {
    const projects = [{ id: '/code/alpha', label: 'Alpha' }];
    const empty = selectSpatialBoardLayout(fleet([]), { projects });
    expect(empty.zones).toEqual([
      expect.objectContaining({
        id: 'project:/code/alpha',
        label: 'Alpha',
        agentCount: 0,
        visible: true,
      }),
    ]);
    expect(empty.pieces).toEqual([]);

    const started = agent('a', 'Alpha', 'working');
    started.projectId = '/code/alpha';
    const active = selectSpatialBoardLayout(fleet([started]), {
      projects,
      previousLayout: empty,
    });
    expect(active.zones).toHaveLength(1);
    expect(active.zones[0]).toMatchObject({
      id: 'project:/code/alpha',
      agentCount: 1,
      rect: empty.zones[0]!.rect,
    });
    expect(active.pieces).toHaveLength(1);
  });

  it('keeps or hides empty Projects according to semantic Project visibility', () => {
    const projects = [{ id: '/code/alpha', label: 'Alpha' }];
    const visible = selectSpatialBoardLayout(fleet([]), {
      projects,
      visibleAgentIds: new Set(),
      visibleProjectIds: new Set(['project:/code/alpha']),
    });
    expect(visible.zones[0]!.visible).toBe(true);
    const hidden = selectSpatialBoardLayout(fleet([]), {
      projects,
      visibleAgentIds: new Set(),
      visibleProjectIds: new Set(),
    });
    expect(hidden.zones[0]!.visible).toBe(false);
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
      expect(layout.bounds.height).toBeLessThanOrEqual(60);
      for (const zone of layout.zones) {
        expect(Number.isFinite(zone.rect.x)).toBe(true);
        expect(Number.isFinite(zone.rect.y)).toBe(true);
        expect(zone.rect.width).toBe(zone.radius * 2);
        expect(zone.rect.height).toBe(zone.radius * 2);
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
    const center = (
      id: string,
      layout: ReturnType<typeof selectSpatialBoardLayout>
    ) => {
      const zone = spatialBoardZoneForAgent(layout, id)!;
      return {
        x: zone.rect.x + zone.radius,
        y: zone.rect.y + zone.radius,
      };
    };
    // Population growth may resize the circular boundary; its stable address
    // is the center/slot, not a frozen footprint.
    expect(center('b', next)).toEqual(center('b', initial));
    expect(center('c', next)).toEqual(center('c', initial));
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

  it('keeps the 173-Agent review fleet individual inside circular Projects', () => {
    const counts = [44, 37, 31, 25, 20, 16];
    const agents = counts.flatMap((count, project) =>
      Array.from({ length: count }, (_, member) =>
        agent(
          `review-${project}-${member}`,
          `Review ${project}`,
          member % 7 === 0 ? 'blocked' : member % 3 === 0 ? 'working' : 'idle'
        )
      )
    );
    const layout = selectSpatialBoardLayout(fleet(agents));
    expect(layout.version).toBe(2);
    expect(layout.stats.sourceAgentCount).toBe(173);
    expect(layout.pieces).toHaveLength(173);
    expect(layout.pieces.every(piece => piece.kind === 'agent')).toBe(true);
    for (const zone of layout.zones) {
      expect(zone.rect.width).toBe(zone.radius * 2);
      expect(zone.rect.height).toBe(zone.radius * 2);
      const centerX = zone.rect.x + zone.radius;
      const centerY = zone.rect.y + zone.radius;
      for (const piece of layout.pieces.filter(
        item => item.projectId === zone.id
      )) {
        expect(Math.hypot(piece.x - centerX, piece.y - centerY)).toBeLessThan(
          zone.radius
        );
      }
    }
  });

  it('uses durable goals and latest source activity for in-world identity', () => {
    const working = agent('a', 'Alpha', 'working');
    working.name = 'opaque-harness-title';
    working.goal = 'Repair callback ownership';
    working.activities = [
      {
        id: 'old',
        timestamp: 10,
        type: 'tool_use',
        content: 'reading the route table',
      },
      {
        id: 'new',
        timestamp: 20,
        type: 'chat_message',
        content: 'tracing the redirect chain',
      },
    ];
    const layout = selectSpatialBoardLayout(fleet([working]), {
      altitude: 'project',
      focusedProjectId: 'project:Alpha',
    });
    expect(layout.pieces[0]).toMatchObject({
      label: 'Repair callback ownership',
      summary: 'opaque-harness-title',
      activity: 'tracing the redirect chain',
    });
  });

  it('keeps neighboring Projects and a fixed-world minimap during semantic focus', () => {
    const state = fleet([
      agent('a1', 'Alpha'),
      agent('a2', 'Alpha'),
      agent('b1', 'Beta'),
      agent('b2', 'Beta'),
    ]);
    const overview = selectSpatialBoardLayout(state);
    const focused = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: 'project:Alpha',
      previousLayout: overview,
    });
    expect(focused.zones).toHaveLength(overview.zones.length);
    expect(focused.minimap.bounds).toEqual(overview.minimap.bounds);
    const overviewBeta = overview.zones.find(
      zone => zone.id === 'project:Beta'
    )!;
    const focusedBeta = focused.zones.find(zone => zone.id === 'project:Beta')!;
    expect(focusedBeta.rect).toEqual(overviewBeta.rect);
    expect(focusedBeta.minimapRect).toEqual(overviewBeta.minimapRect);
    expect(
      focused.pieces.some(piece => piece.projectId === 'project:Beta')
    ).toBe(true);
    expect(
      focused.pieces
        .filter(piece => piece.projectId === 'project:Beta')
        .every(piece => piece.kind === 'aggregate')
    ).toBe(true);
    expect(focused.cameraBounds).toEqual(
      focused.zones.find(zone => zone.id === 'project:Alpha')!.rect
    );
  });

  it('sizes an aggregated giant Project to density content, not one slot per Agent', () => {
    // ENG-004 V3.1: a 3,000+-Agent Project drilled at project altitude used to
    // emit a footprint thousands of units tall (rows for pieces that were
    // never rendered), so the camera fit framed an empty sliver.
    const state = projectFleet(1, 3_334);
    const layout = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: 'project:Project 000',
    });
    expect(layout.zones).toHaveLength(1);
    const rect = layout.zones[0]!.rect;
    expect(rect.height).toBeLessThan(60);
    expect(rect.width).toBeLessThan(120);
    // Still aggregated: no per-Agent pieces at this population.
    expect(layout.pieces.every(piece => piece.kind === 'aggregate')).toBe(true);
    // A Project inside the individual budget keeps the slot-grid sizing.
    const smallState = projectFleet(1, 12);
    const smallLayout = selectSpatialBoardLayout(smallState, {
      altitude: 'project',
      focusedProjectId: 'project:Project 000',
    });
    expect(smallLayout.pieces.every(piece => piece.kind === 'agent')).toBe(
      true
    );
  });

  it('keeps an aggregated focused Project at its Fleet address', () => {
    const state = fleet([
      agent('a', 'Alpha'),
      ...Array.from({ length: 121 }, (_, index) => agent(`b${index}`, 'Beta')),
    ]);
    const overview = selectSpatialBoardLayout(state);
    const focused = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
      previousLayout: overview,
    });
    const overviewBeta = overview.zones.find(
      zone => zone.id === 'project:Beta'
    )!;
    const focusedBeta = focused.zones.find(zone => zone.id === 'project:Beta')!;
    const center = (rect: SpatialBoardRect) => ({
      x: rect.x + rect.width / 2,
      y: rect.y + rect.height / 2,
    });

    expect(center(focusedBeta.rect)).toEqual(center(overviewBeta.rect));
    expect(focusedBeta.slotIndex).toBe(overviewBeta.slotIndex);
    expect(focusedBeta.rect).not.toEqual(focusedBeta.minimapRect);
    expect(focused.cameraBounds).toEqual(focusedBeta.rect);
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

describe('selectSpatialDirectionalAgentId', () => {
  it('walks visible Agents by board direction and holds at an edge', () => {
    const layout = selectSpatialBoardLayout(
      fleet([
        agent('a', 'Alpha'),
        agent('b', 'Alpha'),
        agent('c', 'Alpha'),
        agent('d', 'Alpha'),
      ]),
      { altitude: 'project', focusedProjectId: 'project:Alpha' }
    );
    const center = layout.pieces.find(piece => piece.slotIndex === 0)!;
    const right = selectSpatialDirectionalAgentId(
      layout,
      center.agentId,
      'right'
    );
    expect(right).not.toBe(center.agentId);
    expect(
      layout.pieces.find(piece => piece.agentId === right)!.x
    ).toBeGreaterThan(center.x);

    const rightmost = [...layout.pieces].sort((a, b) => b.x - a.x)[0]!;
    expect(
      selectSpatialDirectionalAgentId(layout, rightmost.agentId, 'right')
    ).toBe(rightmost.agentId);
  });

  it('starts from the visible camera center and ignores filtered pieces', () => {
    const state = fleet([
      agent('a', 'Alpha'),
      agent('b', 'Alpha'),
      agent('c', 'Alpha'),
    ]);
    const layout = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: 'project:Alpha',
      visibleAgentIds: new Set(['a', 'b']),
    });
    const selected = selectSpatialDirectionalAgentId(layout, null, 'down');
    expect(selected).not.toBe('c');
  });
});

/**
 * Delegation topology on pieces (ENG-023 D3b): labels only, capped for the
 * satellite draw, and absent when the source reports nothing — presence is
 * the signal, so unreported and zero read identically.
 */
describe('piece delegation', () => {
  const child = (id: string, description: string | null = null) => ({
    id,
    agentType: 'Explore',
    description,
    startedAt: 1,
  });

  it('projects live children onto the agent piece, capped at the satellite budget', () => {
    const delegating = {
      ...agent('a', 'Alpha', 'working'),
      delegation: {
        children: [
          child('c1', 'Map the release gates'),
          child('c2'),
          child('c3'),
          child('c4'),
          child('c5'),
          child('c6'),
        ],
      },
    };
    const layout = selectSpatialBoardLayout(fleet([delegating]));
    const piece = layout.pieces.find(item => item.agentId === 'a');
    expect(piece?.delegation?.count).toBe(6);
    // the satellite list is capped; the count carries the census
    expect(piece?.delegation?.children).toHaveLength(5);
    expect(piece?.delegation?.children[0]).toEqual({
      id: 'c1',
      agentType: 'Explore',
      description: 'Map the release gates',
    });
  });

  it('omits delegation entirely for unreporting agents', () => {
    const layout = selectSpatialBoardLayout(fleet([agent('a', 'Alpha')]));
    const piece = layout.pieces.find(item => item.agentId === 'a');
    expect(piece).toBeDefined();
    expect(piece).not.toHaveProperty('delegation');
  });
});

/** Band-hit selection (ENG-004 V3.2): drag rect in layout space → Agents. */
describe('selectSpatialBandAgentIds', () => {
  it('captures visible agent pieces whose centers fall inside the band', () => {
    const layout = selectSpatialBoardLayout(
      fleet([agent('a', 'Alpha'), agent('b', 'Alpha'), agent('c', 'Beta')])
    );
    const pieceA = spatialBoardPieceForAgent(layout, 'a')!;
    const band = {
      x: pieceA.x - 1,
      y: pieceA.y - 1,
      width: 2,
      height: 2,
    };
    expect(selectSpatialBandAgentIds(layout, band)).toEqual(['a']);
  });

  it('normalizes a band dragged up-left (negative width/height)', () => {
    const layout = selectSpatialBoardLayout(fleet([agent('a', 'Alpha')]));
    const piece = spatialBoardPieceForAgent(layout, 'a')!;
    const band = {
      x: piece.x + 1,
      y: piece.y + 1,
      width: -2,
      height: -2,
    };
    expect(selectSpatialBandAgentIds(layout, band)).toEqual(['a']);
  });

  it('captures a dot-rendered zone whole when the band intersects it, aggregated Agents included', () => {
    // One dense Project: agents aggregate into dots with no per-agent piece.
    const state = projectFleet(1, 40);
    const layout = selectSpatialBoardLayout(state, {
      maxFleetPiecesPerZone: 12,
    });
    expect(layout.pieces.every(piece => piece.kind === 'aggregate')).toBe(true);
    const zone = layout.zones[0]!;
    // Clipping the circular boundary is enough — at fleet density the zone
    // is the unit, while an empty bounding-box corner is not part of it.
    const edge = {
      x: zone.rect.x - 2,
      y: zone.rect.y + zone.radius - 2,
      width: 4,
      height: 4,
    };
    expect(selectSpatialBandAgentIds(layout, edge)).toHaveLength(40);
    const emptyCorner = {
      x: zone.rect.x - 1,
      y: zone.rect.y - 1,
      width: 2,
      height: 2,
    };
    expect(selectSpatialBandAgentIds(layout, emptyCorner)).toHaveLength(0);
    // A band that misses the zone captures nothing.
    const outside = {
      x: zone.rect.x + zone.rect.width + 5,
      y: zone.rect.y,
      width: 4,
      height: 4,
    };
    expect(selectSpatialBandAgentIds(layout, outside)).toHaveLength(0);
  });

  it('keeps filtered-out Agents out of zone captures and lets pieces own their zone', () => {
    const state = projectFleet(1, 40);
    const layout = selectSpatialBoardLayout(state, {
      maxFleetPiecesPerZone: 12,
    });
    const zone = layout.zones[0]!;
    const visible = new Set(zone.agentIds.slice(0, 5));
    const fullBand = {
      x: zone.rect.x - 1,
      y: zone.rect.y - 1,
      width: zone.rect.width + 2,
      height: zone.rect.height + 2,
    };
    expect(selectSpatialBandAgentIds(layout, fullBand, visible)).toHaveLength(
      5
    );
    // Focused Project altitude renders individual pieces, so the piece rule
    // owns the zone: a small band inside it grabs only what it covers.
    const focused = selectSpatialBoardLayout(state, {
      altitude: 'project',
      focusedProjectId: zone.id,
    });
    const somePiece = focused.pieces.find(piece => piece.kind === 'agent')!;
    const tightBand = {
      x: somePiece.x - 0.5,
      y: somePiece.y - 0.5,
      width: 1,
      height: 1,
    };
    const tight = selectSpatialBandAgentIds(focused, tightBand);
    expect(tight.length).toBeGreaterThan(0);
    expect(tight.length).toBeLessThan(40);
  });
});

/** Fleet-altitude scope activity (ENG-004 V3.2). */
describe('selectSpatialScopeActivity', () => {
  const withBurn = (
    base: ExawattAgent,
    rawTokens: number,
    normalizedTokens: number
  ): ExawattAgent => ({
    ...base,
    metrics: { ...base.metrics, rawTokens, normalizedTokens },
  });

  it('buckets statuses per the D40 projection over the whole fleet', () => {
    const summary = selectSpatialScopeActivity(
      fleet([
        agent('a', 'Alpha', 'working'),
        agent('b', 'Alpha', 'reviewing'),
        agent('c', 'Beta', 'blocked'),
        agent('d', 'Beta', 'error'),
        agent('e', 'Beta', 'idle'),
        agent('f', 'Beta', 'complete'),
      ])
    );
    expect(summary).toMatchObject({
      agentCount: 6,
      working: 2,
      blocked: 2,
      idle: 2,
      burn: null,
    });
  });

  it('scopes to a selection and totals its reported burn, unreported stays absent', () => {
    const state = fleet([
      withBurn(agent('a', 'Alpha', 'working'), 1000, 800),
      withBurn(agent('b', 'Alpha', 'idle'), 500, 400),
      agent('c', 'Beta', 'blocked'),
    ]);
    const scoped = selectSpatialScopeActivity(state, new Set(['a', 'c']));
    expect(scoped.agentCount).toBe(2);
    expect(scoped.working).toBe(1);
    expect(scoped.blocked).toBe(1);
    expect(scoped.burn).toEqual({
      rawTokens: 1000,
      normalizedTokens: 800,
      reportedCount: 1,
      unreportedCount: 1,
    });
    // Nothing in scope reports → burn is null, never zero.
    expect(selectSpatialScopeActivity(state, new Set(['c'])).burn).toBeNull();
  });
});
