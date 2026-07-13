import { describe, expect, it } from 'vitest';
import type {
  ExawattAgent,
  ExawattCronJob,
  FleetMetrics,
  FleetState,
} from '@exawatt/core';
import {
  filterFleetState,
  resolveTransmission,
  selectActivityFeed,
  selectAttentionSchedule,
  selectFleetCommandView,
  selectFleetSpatialScene,
  selectOperatorQueue,
  selectSortedAgents,
  selectSpatialAgentTiles,
  selectShortGoalLabel,
  selectSpatialAttention,
  selectSpatialProjectZones,
} from './index';

const metrics: FleetMetrics = {
  activeCount: 2,
  blockedCount: 1,
  idleCount: 1,
  totalCost: 12,
  totalTokens: 2000,
  totalCostRate: 4,
  costByProject: { demo: 12 },
};

function agent(partial: Partial<ExawattAgent> & { id: string }): ExawattAgent {
  const { id, ...rest } = partial;

  return {
    id,
    name: partial.name ?? id,
    status: partial.status ?? 'idle',
    goal: partial.goal ?? 'Test goal',
    project: partial.project ?? 'demo',
    sessionKey: partial.sessionKey ?? id,
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: partial.metrics?.estimatedCost ?? 0,
      turnCount: partial.metrics?.turnCount ?? 0,
      startedAt: null,
      duration: 0,
      costRate: partial.metrics?.costRate ?? 0,
      tokenRate: partial.metrics?.tokenRate ?? 0,
      costHistory: [],
    },
    lastActivityAt: partial.lastActivityAt ?? 0,
    createdAt: partial.createdAt ?? 0,
    ...rest,
  };
}

function state(): FleetState {
  const agents = [
    agent({
      id: 'idle-1',
      name: 'Idle',
      status: 'idle',
      lastActivityAt: 10,
    }),
    agent({
      id: 'working-1',
      name: 'Working',
      status: 'working',
      lastActivityAt: 40,
      activities: [
        {
          id: 'a1',
          timestamp: 100,
          type: 'tool_use',
          content: 'Ran tests',
        },
      ],
    }),
    agent({
      id: 'blocked-1',
      name: 'Blocked',
      status: 'blocked',
      lastActivityAt: 30,
      blockerInfo: {
        type: 'approval_required',
        title: 'Approve deploy',
        description: 'Needs release approval.',
        suggestedResponses: ['Approved'],
        createdAt: 20,
      },
      activities: [
        {
          id: 'a2',
          timestamp: 110,
          type: 'blocker_created',
          content: 'Deployment approval needed',
        },
      ],
    }),
  ];

  return {
    agents: Object.fromEntries(agents.map(item => [item.id, item])),
    metrics,
    lastUpdated: 120,
  };
}

// Multi-project fixture for the spatial war-table selectors.
// Alpha: working + idle (calm). Beta: 2 blocked + 1 reviewing (high pressure);
// 'beta-blocked-old' has the oldest blocker -> deterministic hero.
function multiState(): FleetState {
  const agents = [
    agent({
      id: 'alpha-working',
      name: 'AW',
      project: 'Alpha',
      status: 'working',
      lastActivityAt: 40,
    }),
    agent({
      id: 'alpha-idle',
      name: 'AI',
      project: 'Alpha',
      status: 'idle',
      lastActivityAt: 10,
    }),
    agent({
      id: 'beta-blocked-old',
      name: 'BBO',
      project: 'Beta',
      status: 'blocked',
      lastActivityAt: 30,
      blockerInfo: {
        type: 'credentials_needed',
        title: 'API keys required',
        description: 'Need live keys to proceed.',
        suggestedResponses: ['Provide keys'],
        createdAt: 10,
      },
    }),
    agent({
      id: 'beta-blocked-new',
      name: 'BBN',
      project: 'Beta',
      status: 'blocked',
      lastActivityAt: 35,
      blockerInfo: {
        type: 'input_needed',
        title: 'Which provider?',
        description: 'Pick a provider.',
        suggestedResponses: ['A'],
        createdAt: 50,
      },
    }),
    agent({
      id: 'beta-reviewing',
      name: 'BR',
      project: 'Beta',
      status: 'reviewing',
      lastActivityAt: 20,
    }),
  ];

  return {
    agents: Object.fromEntries(agents.map(item => [item.id, item])),
    metrics,
    lastUpdated: 200,
  };
}

describe('@exawatt/ui-model', () => {
  it('sorts blocked and risky agents first, then by recency', () => {
    expect(selectSortedAgents(state()).map(item => item.id)).toEqual([
      'blocked-1',
      'working-1',
      'idle-1',
    ]);
  });

  it('builds an operator queue with deterministic priority', () => {
    expect(selectOperatorQueue(state())).toEqual([
      expect.objectContaining({
        agentId: 'blocked-1',
        title: 'Approve deploy',
        priority: 0,
        suggestedResponses: ['Approved'],
      }),
    ]);
  });

  it('orders activity feed newest first with tones', () => {
    expect(selectActivityFeed(state())).toEqual([
      expect.objectContaining({
        id: 'a2',
        tone: 'warning',
      }),
      expect.objectContaining({
        id: 'a1',
        tone: 'active',
      }),
    ]);
  });

  it('places project zones by attention pressure, marking the hero zone', () => {
    const zones = selectSpatialProjectZones(multiState());
    expect(zones.map(z => z.label)).toEqual(['Beta', 'Alpha']); // pressure desc

    const beta = zones.find(z => z.label === 'Beta')!;
    const alpha = zones.find(z => z.label === 'Alpha')!;
    expect(beta.ownsHeroBlocker).toBe(true);
    expect(beta.tier).toBe('hero');
    expect(beta.rimColor).toBe('#f87171'); // only the hero zone is red
    expect(alpha.ownsHeroBlocker).toBe(false);
    expect(alpha.rimColor).not.toBe('#f87171');
    expect(beta.statLine).toMatch(/^3 agents · 2 blocked · \$/);
    expect(beta.width).toBeGreaterThan(0);
    expect(beta.depth).toBeGreaterThan(0);
  });

  it('keeps an empty known Project at fleet and project altitudes', () => {
    const projects = [{ id: '/code/alpha', label: 'Alpha' }];
    const fleetScene = selectFleetSpatialScene(
      { ...multiState(), agents: {} },
      { projects }
    );
    expect(fleetScene.groups).toEqual([
      expect.objectContaining({
        clusterId: 'project:/code/alpha',
        label: 'Alpha',
        agentCount: 0,
        summaryMode: true,
      }),
    ]);
    expect(fleetScene.tiles).toEqual([]);

    const projectScene = selectFleetSpatialScene(
      { ...multiState(), agents: {} },
      {
        projects,
        altitude: 'project',
        focusedProjectId: 'project:/code/alpha',
      }
    );
    expect(projectScene.altitude).toBe('project');
    expect(projectScene.focusedProjectId).toBe('project:/code/alpha');
    expect(projectScene.groups).toHaveLength(1);
    expect(projectScene.tiles).toEqual([]);
  });

  it('lays out agent tiles inside their zone bounds, lifting hero/selected', () => {
    const zones = selectSpatialProjectZones(multiState(), {
      selectedAgentId: 'alpha-working',
    });
    const tiles = selectSpatialAgentTiles(zones, multiState(), {
      selectedAgentId: 'alpha-working',
    });
    const zoneById = new Map(zones.map(z => [z.clusterId, z]));

    for (const tile of tiles) {
      const zone = zoneById.get(tile.clusterId)!;
      // assert the tile FOOTPRINT EDGE stays inside the zone, not just its center
      expect(Math.abs(tile.x - zone.x) + tile.width / 2).toBeLessThanOrEqual(
        zone.width / 2 + 1e-6
      );
      expect(Math.abs(tile.z - zone.z) + tile.depth / 2).toBeLessThanOrEqual(
        zone.depth / 2 + 1e-6
      );
    }

    const hero = tiles.find(t => t.agentId === 'beta-blocked-old')!;
    expect(hero.isHero).toBe(true);
    expect(hero.y).toBeGreaterThanOrEqual(0.5); // heroLift

    const selected = tiles.find(t => t.agentId === 'alpha-working')!;
    expect(selected.selected).toBe(true);
    expect(selected.y).toBeGreaterThanOrEqual(0.35); // selectionLift
  });

  it('elects a single hero blocker (oldest) with grouped secondary attention', () => {
    const scene = selectFleetSpatialScene(multiState());
    const attention = selectSpatialAttention(
      multiState(),
      scene.tiles
    );
    expect(attention.hero?.agentId).toBe('beta-blocked-old');
    expect(attention.secondary.map(s => s.agentId)).toContain('beta-blocked-new');
    expect(attention.overflowCount).toBe(0);
    expect(attention.ambientActiveCount).toBe(2); // working + reviewing
  });

  it('falls back to the next-oldest blocker when the hero is removed', () => {
    const base = multiState();
    delete base.agents['beta-blocked-old'];
    const scene = selectFleetSpatialScene(base);
    expect(scene.attention.hero?.agentId).toBe('beta-blocked-new');
  });

  it('reports no hero when there are no blockers', () => {
    const calm = state();
    delete calm.agents['blocked-1'];
    const scene = selectFleetSpatialScene(calm);
    expect(scene.attention.hero).toBeNull();
    expect(scene.heroLink).toBeNull();
  });

  it('produces a deterministic scene with a hero link to the hero tile', () => {
    const first = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
      selectedAgentId: 'beta-blocked-old',
    });
    const second = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
      selectedAgentId: 'beta-blocked-old',
    });
    expect(first).toEqual(second);

    const heroTile = first.tiles.find(t => t.agentId === 'beta-blocked-old')!;
    expect(first.heroLink).not.toBeNull();
    expect(first.heroLink!.toX).toBe(heroTile.x);
    expect(first.heroLink!.toZ).toBe(heroTile.z);
  });

  it('combines fleet model, spatial model, and heartbeat summaries', () => {
    const jobs: ExawattCronJob[] = [
      {
        id: 'cron-1',
        name: 'Morning check',
        schedule: '0 9 * * *',
        prompt: 'Check status',
        enabled: true,
        status: 'idle',
      },
    ];

    expect(
      selectFleetCommandView(state(), {
        heartbeatJobs: jobs,
        selectedAgentId: 'blocked-1',
      })
    ).toEqual(
      expect.objectContaining({
        nextBlockedAgentId: 'blocked-1',
        activeAgentCount: 1,
        selectedAgentId: 'blocked-1',
        heartbeats: [expect.objectContaining({ id: 'cron-1' })],
      })
    );
  });

  it('elects a stable hero on createdAt + lastActivityAt ties (insertion-order independent)', () => {
    const mk = (): ExawattAgent[] => [
      agent({
        id: 'b-zzz',
        name: 'Z',
        project: 'Tie',
        status: 'blocked',
        lastActivityAt: 99,
        blockerInfo: {
          type: 'input_needed',
          title: 'T',
          description: 'd',
          suggestedResponses: ['x'],
          createdAt: 99,
        },
      }),
      agent({
        id: 'b-aaa',
        name: 'A',
        project: 'Tie',
        status: 'blocked',
        lastActivityAt: 99,
        blockerInfo: {
          type: 'input_needed',
          title: 'T',
          description: 'd',
          suggestedResponses: ['x'],
          createdAt: 99,
        },
      }),
    ];
    const stateOf = (list: ExawattAgent[]): FleetState => ({
      agents: Object.fromEntries(list.map(a => [a.id, a])),
      metrics,
      lastUpdated: 0,
    });
    const heroOf = (list: ExawattAgent[]) =>
      selectOperatorQueue(stateOf(list))[0]!.agentId;
    // lower id wins regardless of insertion order
    expect(heroOf(mk())).toBe('b-aaa');
    expect(heroOf([...mk()].reverse())).toBe('b-aaa');
  });

  it('emits rail placements so the hero glow line cannot drift from the card', () => {
    const scene = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
    });
    expect(scene.attention.hero).not.toBeNull();
    expect(scene.heroLink).not.toBeNull();
    expect(scene.heroLink!.fromX).toBe(scene.attention.hero!.railX);
    expect(scene.heroLink!.fromY).toBe(scene.attention.hero!.railY);
    expect(scene.heroLink!.fromZ).toBe(scene.attention.hero!.railZ);
    for (const item of scene.attention.secondary) {
      expect(typeof item.railX).toBe('number');
      expect(typeof item.railZ).toBe('number');
    }
    expect(scene.attention.overflowLabelPos).toEqual(
      expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) })
    );
    expect(scene.attention.ambientLabelPos).toEqual(
      expect.objectContaining({ x: expect.any(Number), z: expect.any(Number) })
    );
  });

  it('enforces the transmission cap (<=2 surfaces, 1 at rest, never both for the hero)', () => {
    const base = selectFleetSpatialScene(multiState());
    const heroId = base.attention.hero!.agentId; // 'beta-blocked-old'
    const sceneWith = (selectedAgentId: string | null) => ({
      ...base,
      selectedAgentId,
    });
    const count = (p: {
      heroCardGlass: boolean;
      selectedTileGlassAgentId: string | null;
    }) => Number(p.heroCardGlass) + (p.selectedTileGlassAgentId ? 1 : 0);

    const rest = resolveTransmission(sceneWith(null), false);
    expect(rest.heroCardGlass).toBe(true);
    expect(rest.selectedTileGlassAgentId).toBeNull();
    expect(count(rest)).toBe(1); // 1 at rest

    const two = resolveTransmission(sceneWith('alpha-working'), false);
    expect(two.selectedTileGlassAgentId).toBe('alpha-working');
    expect(count(two)).toBe(2); // hero card + distinct selected tile

    const heroSelected = resolveTransmission(sceneWith(heroId), false);
    expect(heroSelected.selectedTileGlassAgentId).toBeNull(); // carve-out
    expect(count(heroSelected)).toBe(1); // never glass on both for the hero

    expect(count(resolveTransmission(sceneWith('alpha-working'), true))).toBe(0);

    const calm = state();
    delete calm.agents['blocked-1'];
    expect(
      count(resolveTransmission(selectFleetSpatialScene(calm), false))
    ).toBe(0);
  });

  it('keeps every tile footprint inside its zone for a large multi-row project', () => {
    const agents = Array.from({ length: 8 }, (_, i) =>
      agent({
        id: `grid-${i}`,
        name: `G${i}`,
        project: 'Grid',
        status: i % 2 ? 'idle' : 'working',
        lastActivityAt: i,
      })
    );
    const big: FleetState = {
      agents: Object.fromEntries(agents.map(a => [a.id, a])),
      metrics,
      lastUpdated: 0,
    };
    const zones = selectSpatialProjectZones(big);
    const tiles = selectSpatialAgentTiles(zones, big);
    const zone = zones.find(z => z.label === 'Grid')!;
    for (const tile of tiles) {
      expect(Math.abs(tile.x - zone.x) + tile.width / 2).toBeLessThanOrEqual(
        zone.width / 2 + 1e-6
      );
      expect(Math.abs(tile.z - zone.z) + tile.depth / 2).toBeLessThanOrEqual(
        zone.depth / 2 + 1e-6
      );
    }
  });

  it('never overlaps tiles within a zone', () => {
    const scene = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
    });
    const byCluster = new Map<string, typeof scene.tiles>();
    for (const t of scene.tiles) {
      const arr = byCluster.get(t.clusterId) ?? [];
      arr.push(t);
      byCluster.set(t.clusterId, arr);
    }
    for (const group of byCluster.values()) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const dx = Math.abs(group[i]!.x - group[j]!.x);
          const dz = Math.abs(group[i]!.z - group[j]!.z);
          expect(dx > 1e-6 || dz > 1e-6).toBe(true); // distinct
          expect(Math.max(dx, dz)).toBeGreaterThanOrEqual(group[i]!.width - 1e-6);
        }
      }
    }
  });

  it('reports overflow beyond hero + secondary', () => {
    const s = multiState();
    s.agents['beta-blocked-3'] = agent({
      id: 'beta-blocked-3',
      name: 'BB3',
      project: 'Beta',
      status: 'blocked',
      lastActivityAt: 60,
      blockerInfo: {
        type: 'input_needed',
        title: 'Q3',
        description: 'd',
        suggestedResponses: ['x'],
        createdAt: 70,
      },
    });
    s.agents['beta-blocked-4'] = agent({
      id: 'beta-blocked-4',
      name: 'BB4',
      project: 'Beta',
      status: 'blocked',
      lastActivityAt: 65,
      blockerInfo: {
        type: 'input_needed',
        title: 'Q4',
        description: 'd',
        suggestedResponses: ['x'],
        createdAt: 80,
      },
    });
    // 4 blockers, blockerLimit 2 => hero + 1 secondary + 2 overflow
    const scene = selectFleetSpatialScene(s, { blockerLimit: 2 });
    expect(scene.attention.secondary).toHaveLength(1);
    expect(scene.attention.overflowCount).toBe(2);
  });

  // ---- V0.2 motion targets (emitted by pure selectors) ----

  it('emits tile motion targets (rest/lift/scale/emphasis) for selected + hero', () => {
    const opts = { selectedAgentId: 'alpha-working' };
    const zones = selectSpatialProjectZones(multiState(), opts);
    const tiles = selectSpatialAgentTiles(zones, multiState(), opts);

    const selected = tiles.find(t => t.agentId === 'alpha-working')!;
    expect(selected.restY).toBe(0);
    expect(selected.targetScale).toBe(1.05); // selectionScale
    expect(selected.liftTarget).toBeGreaterThanOrEqual(0.35); // selectionLift
    expect(selected.liftTarget).toBe(selected.y); // back-compat: y === liftTarget
    expect(selected.emphasisTarget).toBe(selected.emphasis);

    const hero = tiles.find(t => t.agentId === 'beta-blocked-old')!;
    expect(hero.targetScale).toBe(1); // hero is not the selected agent
    expect(hero.liftTarget).toBeGreaterThanOrEqual(0.5); // heroLift

    const calm = tiles.find(t => t.agentId === 'alpha-idle')!;
    expect(calm.restY).toBe(0);
    expect(calm.liftTarget).toBe(0);
    expect(calm.targetScale).toBe(1);
  });

  it('emits zone motion targets (lift, crystal edge, metal frame) with passive recede', () => {
    const none = selectSpatialProjectZones(multiState());
    const betaNone = none.find(z => z.label === 'Beta')!; // hero tier
    const alphaNone = none.find(z => z.label === 'Alpha')!; // calm tier
    expect(betaNone.liftTarget).toBe(0);
    expect(betaNone.edgeEmphasisTarget).toBe(0.8); // hero, not selected
    expect(alphaNone.edgeEmphasisTarget).toBe(0.15); // calm
    expect(betaNone.frameEmissiveTarget).toBeGreaterThan(
      alphaNone.frameEmissiveTarget
    );

    const sel = selectSpatialProjectZones(multiState(), {
      selectedAgentId: 'alpha-working',
    });
    const alphaSel = sel.find(z => z.label === 'Alpha')!;
    const betaSel = sel.find(z => z.label === 'Beta')!;
    expect(alphaSel.selected).toBe(true);
    expect(alphaSel.liftTarget).toBeGreaterThan(0); // zoneLift when selected
    expect(alphaSel.edgeEmphasisTarget).toBe(0.4); // calm + selected
    expect(alphaSel.frameEmissiveTarget).toBeGreaterThan(
      alphaNone.frameEmissiveTarget
    ); // selected zone brightens
    expect(betaSel.frameEmissiveTarget).toBeLessThan(
      betaNone.frameEmissiveTarget
    ); // others passively recede
  });

  // ---- V0.3 zoom-resolution altitudes ----

  it('fleet altitude shows summary clusters and no agent tiles (density, not scale)', () => {
    const scene = selectFleetSpatialScene(multiState(), { altitude: 'fleet' });
    expect(scene.altitude).toBe('fleet');
    expect(scene.tiles).toHaveLength(0);
    expect(scene.groups).toHaveLength(2); // Alpha + Beta both present
    expect(scene.groups.every(z => z.summaryMode)).toBe(true);
    expect(scene.showRail).toBe(true);
    expect(scene.focusedProjectId).toBeNull();
  });

  it('defaults to fleet altitude when none is given (back-compat)', () => {
    expect(selectFleetSpatialScene(multiState())).toEqual(
      selectFleetSpatialScene(multiState(), { altitude: 'fleet' })
    );
  });

  it('project altitude shows only the focused, re-centered zone with its tiles', () => {
    const scene = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Beta',
    });
    expect(scene.altitude).toBe('project');
    expect(scene.groups).toHaveLength(1);
    const zone = scene.groups[0]!;
    expect(zone.clusterId).toBe('project:Beta');
    expect(zone.summaryMode).toBe(false);
    expect(zone.x).toBe(0); // re-centered to fill the view
    expect(zone.z).toBe(0);
    expect(scene.tiles).toHaveLength(3); // Beta's 3 agents
    expect(scene.tiles.every(t => t.clusterId === 'project:Beta')).toBe(true);
    expect(scene.showRail).toBe(true);
    expect(scene.bounds.width).toBeCloseTo(zone.width, 4);
    expect(scene.bounds.depth).toBeCloseTo(zone.depth, 4);
  });

  it('agent altitude focuses the agent zone, lifts the agent, hides the rail', () => {
    const scene = selectFleetSpatialScene(multiState(), {
      altitude: 'agent',
      selectedAgentId: 'beta-reviewing',
    });
    expect(scene.altitude).toBe('agent');
    expect(scene.focusedProjectId).toBe('project:Beta'); // resolved from the agent
    expect(scene.groups).toHaveLength(1);
    expect(scene.showRail).toBe(false);
    expect(scene.heroLink).toBeNull();
    const sel = scene.tiles.find(t => t.agentId === 'beta-reviewing')!;
    expect(sel.selected).toBe(true);
    expect(sel.liftTarget).toBeGreaterThan(0);
  });

  it('ascends to fleet when the altitude focus target is missing', () => {
    const unknownProject = selectFleetSpatialScene(multiState(), {
      altitude: 'project',
      focusedProjectId: 'project:Nope',
    });
    expect(unknownProject.altitude).toBe('fleet');
    expect(unknownProject.focusedProjectId).toBeNull();

    const unknownAgent = selectFleetSpatialScene(multiState(), {
      altitude: 'agent',
      selectedAgentId: 'ghost',
    });
    expect(unknownAgent.altitude).toBe('fleet');
    expect(unknownAgent.tiles).toHaveLength(0);
  });

  it('produces a deterministic scene at project altitude', () => {
    const opts = {
      altitude: 'project' as const,
      focusedProjectId: 'project:Beta',
    };
    expect(selectFleetSpatialScene(multiState(), opts)).toEqual(
      selectFleetSpatialScene(multiState(), opts)
    );
  });

  // ---- V0.4 Attention Scheduling (leverage-aware prioritization) ----

  // A NEWER credentials blocker must outrank an OLDER input_needed blocker —
  // leverage (blocker type) dominates age.
  function leverageState(): FleetState {
    const agents = [
      agent({
        id: 'old-input',
        project: 'P',
        status: 'blocked',
        lastActivityAt: 5,
        blockerInfo: {
          type: 'input_needed',
          title: 'Which provider?',
          description: 'Pick one.',
          suggestedResponses: ['x'],
          createdAt: 0,
        },
      }),
      agent({
        id: 'new-cred',
        project: 'P',
        status: 'blocked',
        lastActivityAt: 9,
        blockerInfo: {
          type: 'credentials_needed',
          title: 'API keys required',
          description: 'Need keys.',
          suggestedResponses: ['x'],
          createdAt: 1_000_000,
        },
      }),
    ];
    return {
      agents: Object.fromEntries(agents.map(a => [a.id, a])),
      metrics,
      lastUpdated: 0,
    };
  }

  it('rounds every emitted coordinate to 4 decimals (determinism invariant)', () => {
    const zones = selectSpatialProjectZones(multiState());
    const alpha = zones.find(z => z.label === 'Alpha')!;
    // Raw center carries float error (1.5899999999999999); round4 pins it, so
    // this assertion fails the moment rounding is removed.
    expect(alpha.x).toBe(1.59);
    const tiles = selectSpatialAgentTiles(zones, multiState());
    for (const z of zones) {
      for (const v of [z.x, z.z, z.width, z.depth, z.frameEmissiveTarget]) {
        expect(v).toBe(Number(v.toFixed(4)));
      }
    }
    for (const t of tiles) {
      for (const v of [t.x, t.z, t.y, t.liftTarget]) {
        expect(v).toBe(Number(v.toFixed(4)));
      }
    }
  });

  it('DOM next-blocker, operator queue, and spatial hero all pick the leverage winner', () => {
    const cmd = selectFleetCommandView(leverageState());
    const scene = selectFleetSpatialScene(leverageState());
    // Not the oldest (old-input createdAt 0); the highest-leverage credentials one.
    expect(cmd.nextBlockedAgentId).toBe('new-cred');
    expect(cmd.operatorQueue[0]!.agentId).toBe('new-cred');
    expect(scene.attention.hero!.agentId).toBe('new-cred');
    expect(cmd.nextBlockedAgentId).toBe(scene.attention.hero!.agentId);
  });

  it('ranks by leverage: a newer credentials blocker outranks an older input one', () => {
    const schedule = selectAttentionSchedule(leverageState());
    expect(schedule.map(i => i.agentId)).toEqual(['new-cred', 'old-input']);
    expect(schedule[0]!.score).toBeGreaterThan(schedule[1]!.score);
    expect(schedule[0]!.blockerType).toBe('credentials_needed');
    expect(schedule[0]!.priority).toBe(0);
  });

  it('scores age (clamped) and in-project fan-out into the reason string', () => {
    const now = 30 * 60000; // old-input created at 0 -> 30m; new-cred far future -> 0m
    const schedule = selectAttentionSchedule(leverageState(), { now });
    const input = schedule.find(i => i.agentId === 'old-input')!;
    expect(input.ageMinutes).toBe(30);
    expect(input.stalledInProject).toBe(2); // both P agents are blocked
    expect(input.reason).toBe('Needs input · 30m waiting · 2 stalled in P');

    const cred = schedule.find(i => i.agentId === 'new-cred')!;
    expect(cred.reason).toMatch(/^Credentials needed · \d+m waiting · 2 stalled in P$/);

    // age clamps at 240m
    const farFuture = selectAttentionSchedule(leverageState(), {
      now: 999 * 60000,
    });
    expect(farFuture.find(i => i.agentId === 'old-input')!.ageMinutes).toBe(240);
  });

  it('is deterministic and age-free when now is omitted', () => {
    const a = selectAttentionSchedule(leverageState());
    const b = selectAttentionSchedule(leverageState());
    expect(a).toEqual(b);
    expect(a.every(i => i.ageMinutes === 0)).toBe(true);
  });

  it('limits the schedule and omits the fan-out clause for a lone blocker', () => {
    expect(selectAttentionSchedule(leverageState(), { limit: 1 })).toHaveLength(1);
    // multi-blocker project keeps the clause
    const beta = selectAttentionSchedule(multiState()).find(
      i => i.agentId === 'beta-blocked-old'
    )!;
    expect(beta.reason).toMatch(/stalled in Beta/);
    // a single stalled agent in its Project drops the clause
    const lone: FleetState = {
      agents: {
        solo: agent({
          id: 'solo',
          project: 'Solo',
          status: 'blocked',
          blockerInfo: {
            type: 'approval_required',
            title: 'Approve',
            description: 'd',
            suggestedResponses: ['x'],
            createdAt: 5,
          },
        }),
      },
      metrics,
      lastUpdated: 0,
    };
    const item = selectAttentionSchedule(lone)[0]!;
    expect(item.stalledInProject).toBe(1);
    expect(item.reason).toBe('Approval required · 0m waiting');
  });

  it('makes the spatial hero the top of the Attention Schedule (leverage, not age)', () => {
    const scene = selectFleetSpatialScene(leverageState());
    expect(scene.attention.hero?.agentId).toBe('new-cred');
    expect(scene.attention.hero?.reason).toContain('Credentials needed');
  });

  // Altitude-scoped hero: the fleet hero lives in P1, but drilling into P2 must
  // lift P2's own hero, and the rail/tile must agree.
  function twoProjectHeroes(): FleetState {
    const agents = [
      agent({
        id: 'p1-cred',
        project: 'P1',
        status: 'blocked',
        lastActivityAt: 5,
        blockerInfo: {
          type: 'credentials_needed',
          title: 'Keys',
          description: 'd',
          suggestedResponses: ['x'],
          createdAt: 0,
        },
      }),
      agent({ id: 'p1-work', project: 'P1', status: 'working', lastActivityAt: 6 }),
      agent({
        id: 'p2-input',
        project: 'P2',
        status: 'blocked',
        lastActivityAt: 7,
        blockerInfo: {
          type: 'input_needed',
          title: 'Which?',
          description: 'd',
          suggestedResponses: ['x'],
          createdAt: 0,
        },
      }),
      agent({ id: 'p2-work', project: 'P2', status: 'working', lastActivityAt: 8 }),
    ];
    return {
      agents: Object.fromEntries(agents.map(a => [a.id, a])),
      metrics,
      lastUpdated: 0,
    };
  }

  it('scopes the hero lift to the focused Project at project altitude', () => {
    const fleet = selectFleetSpatialScene(twoProjectHeroes());
    expect(fleet.attention.hero?.agentId).toBe('p1-cred'); // fleet hero

    const scene = selectFleetSpatialScene(twoProjectHeroes(), {
      altitude: 'project',
      focusedProjectId: 'project:P2',
    });
    expect(scene.attention.hero?.agentId).toBe('p2-input'); // project-scoped hero
    const tile = scene.tiles.find(t => t.agentId === 'p2-input')!;
    expect(tile.isHero).toBe(true);
    expect(tile.liftTarget).toBeGreaterThanOrEqual(0.5); // heroLift, agrees with the rail
    // the fleet hero's tile is not even in this scene
    expect(scene.tiles.some(t => t.agentId === 'p1-cred')).toBe(false);
  });
});

// ---- V0.5 fleet-scale readiness ----

describe('@exawatt/ui-model fleet-scale (V0.5)', () => {
  function manyProjectState(projectCount: number): FleetState {
    const agents: ExawattAgent[] = [];
    for (let p = 0; p < projectCount; p++) {
      agents.push(
        agent({
          id: `p${p}-a`,
          name: `A${p}`,
          project: `Proj ${String(p).padStart(2, '0')}`,
          status: p % 2 === 0 ? 'idle' : 'working',
          lastActivityAt: p,
        })
      );
    }
    return {
      agents: Object.fromEntries(agents.map(a => [a.id, a])),
      metrics,
      lastUpdated: 1,
    };
  }

  it('aggregates Projects beyond maxZones into one "+N quieter projects" cluster', () => {
    const zones = selectSpatialProjectZones(manyProjectState(4), {
      aggregateOverflow: true,
      maxZones: 2,
    });
    expect(zones).toHaveLength(3); // 2 full + 1 aggregate
    const agg = zones[zones.length - 1]!;
    expect(agg.isAggregate).toBe(true);
    expect(agg.label).toBe('+2 quieter projects');
    expect(agg.agentCount).toBe(2); // summed
    expect(agg.activeCount + agg.idleCount).toBe(2);
    expect(zones.slice(0, 2).every(z => !z.isAggregate)).toBe(true);
  });

  it('does not aggregate when Projects fit within maxZones', () => {
    const zones = selectSpatialProjectZones(manyProjectState(4), {
      aggregateOverflow: true,
      maxZones: 10,
    });
    expect(zones).toHaveLength(4);
    expect(zones.some(z => z.isAggregate)).toBe(false);
  });

  it('fleet altitude folds overflow Projects (density stays readable at scale)', () => {
    const scene = selectFleetSpatialScene(manyProjectState(30), {
      altitude: 'fleet',
      maxZones: 24,
    });
    expect(scene.groups).toHaveLength(25); // 24 + aggregate
    const agg = scene.groups.find(z => z.isAggregate)!;
    expect(agg).toBeDefined();
    expect(agg.label).toBe('+6 quieter projects');
    expect(scene.tiles).toHaveLength(0);
  });

  it('filterFleetState narrows by query and status; empty is identity', () => {
    const state: FleetState = {
      agents: Object.fromEntries(
        [
          agent({ id: 'a', name: 'Alpha', project: 'Polish', status: 'working' }),
          agent({ id: 'b', name: 'Beta', project: 'Parity', status: 'blocked' }),
          agent({ id: 'c', name: 'Gamma', project: 'Polish', status: 'idle' }),
        ].map(a => [a.id, a])
      ),
      metrics,
      lastUpdated: 1,
    };
    // identity when no filter (same reference, no behavior change)
    expect(filterFleetState(state, {})).toBe(state);
    // query matches name / project (case-insensitive)
    expect(Object.keys(filterFleetState(state, { query: 'polish' }).agents).sort()).toEqual(['a', 'c']);
    expect(Object.keys(filterFleetState(state, { query: 'beta' }).agents)).toEqual(['b']);
    // status narrows
    expect(Object.keys(filterFleetState(state, { statuses: ['blocked'] }).agents)).toEqual(['b']);
    // query + status combine (AND)
    expect(
      Object.keys(filterFleetState(state, { query: 'polish', statuses: ['idle'] }).agents)
    ).toEqual(['c']);
    // deterministic
    expect(filterFleetState(state, { query: 'a' })).toEqual(
      filterFleetState(state, { query: 'a' })
    );
  });

  it('produces a deterministic scene for a large many-Project fleet', () => {
    const big = manyProjectState(40);
    expect(selectFleetSpatialScene(big, { altitude: 'fleet' })).toEqual(
      selectFleetSpatialScene(big, { altitude: 'fleet' })
    );
  });

  it('keeps a single overflow Project drillable at exactly maxZones+1 (no wasteful fold)', () => {
    const justOver = selectSpatialProjectZones(manyProjectState(3), {
      aggregateOverflow: true,
      maxZones: 2,
    });
    expect(justOver).toHaveLength(3);
    expect(justOver.some(z => z.isAggregate)).toBe(false);

    const twoOver = selectSpatialProjectZones(manyProjectState(4), {
      aggregateOverflow: true,
      maxZones: 2,
    });
    expect(twoOver).toHaveLength(3);
    expect(twoOver[twoOver.length - 1]!.isAggregate).toBe(true);
    expect(twoOver[twoOver.length - 1]!.label).toBe('+2 quieter projects');
  });

  it('ascends to fleet when a stale URL deep-links the synthetic aggregate cluster', () => {
    const scene = selectFleetSpatialScene(manyProjectState(30), {
      altitude: 'project',
      focusedProjectId: 'aggregate:quieter',
      maxZones: 24,
    });
    expect(scene.altitude).toBe('fleet');
    expect(scene.focusedProjectId).toBeNull();
    expect(scene.tiles).toHaveLength(0);
  });

  it('holds the transmission cap (<=2, 1 at rest) at instanced project scale', () => {
    const agents: ExawattAgent[] = [];
    for (let i = 0; i < 50; i++) {
      agents.push(
        agent({
          id: `big-${i}`,
          name: `B${i}`,
          project: 'Big',
          status: i === 0 ? 'blocked' : 'working',
          lastActivityAt: i,
          blockerInfo:
            i === 0
              ? {
                  type: 'credentials_needed',
                  title: 'Keys',
                  description: 'Need keys.',
                  suggestedResponses: ['x'],
                  createdAt: 1,
                }
              : undefined,
        })
      );
    }
    const big: FleetState = {
      agents: Object.fromEntries(agents.map(a => [a.id, a])),
      metrics,
      lastUpdated: 1,
    };
    const scene = selectFleetSpatialScene(big, {
      altitude: 'project',
      focusedProjectId: 'project:Big',
      selectedAgentId: 'big-1',
    });
    expect(scene.tiles.length).toBeGreaterThanOrEqual(48); // instanced path
    expect(scene.attention.hero!.agentId).toBe('big-0');
    const plan = resolveTransmission(scene, false);
    expect(plan.heroCardGlass).toBe(true);
    expect(plan.selectedTileGlassAgentId).toBe('big-1'); // distinct from hero
    const surfaces =
      Number(plan.heroCardGlass) + (plan.selectedTileGlassAgentId ? 1 : 0);
    expect(surfaces).toBe(2);

    const restScene = selectFleetSpatialScene(big, {
      altitude: 'project',
      focusedProjectId: 'project:Big',
    });
    const restPlan = resolveTransmission(restScene, false);
    expect(restPlan.heroCardGlass).toBe(true); // 1 at rest
    expect(restPlan.selectedTileGlassAgentId).toBeNull();
  });
});

describe('selectShortGoalLabel', () => {
  it('summarizes demo goals into clean 2-4 word labels', () => {
    expect(
      selectShortGoalLabel(
        'Research competitor pricing, compile report with recommendations'
      )
    ).toBe('Research competitor pricing');
    expect(
      selectShortGoalLabel(
        'Improve onboarding flow and add analytics tracking to key conversion steps'
      )
    ).toBe('Improve onboarding flow');
    expect(
      selectShortGoalLabel('Set up CI/CD pipeline for the new microservice')
    ).toBe('Set CI/CD pipeline');
    expect(
      selectShortGoalLabel('Migrate database schema to support multi-tenancy')
    ).toBe('Migrate database schema');
    expect(
      selectShortGoalLabel(
        'Performance optimization sprint: reduce bundle size by 40%'
      )
    ).toBe('Performance optimization sprint');
  });

  it('is pure/deterministic, caps word count, title-cases, handles empty', () => {
    const goal = 'build marketing landing page with A/B test variants';
    expect(selectShortGoalLabel(goal)).toBe(selectShortGoalLabel(goal));
    expect(selectShortGoalLabel(goal)).toBe('Build marketing landing page');
    expect(selectShortGoalLabel(goal).split(' ').length).toBeLessThanOrEqual(4);
    expect(selectShortGoalLabel('audit module', 2)).toBe('Audit module');
    expect(selectShortGoalLabel('')).toBe('');
    expect(selectShortGoalLabel('   ')).toBe('');
  });

  it('labels agent tiles by goal summary, not the (possibly codename) name', () => {
    const a = agent({
      id: 'x',
      name: 'Gamma',
      project: 'P',
      goal: 'Research competitor pricing, compile report',
      status: 'working',
    });
    const s: FleetState = { agents: { x: a }, metrics, lastUpdated: 1 };
    const zones = selectSpatialProjectZones(s);
    const tiles = selectSpatialAgentTiles(zones, s);
    expect(tiles[0]!.label).toBe('Research competitor pricing');
    expect(tiles[0]!.label).not.toBe('Gamma');
  });
});
