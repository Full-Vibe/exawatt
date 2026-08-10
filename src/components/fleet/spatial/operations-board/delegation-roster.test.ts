import { describe, expect, it } from 'vitest';
import {
  SPATIAL_DELEGATION_UNIT_CEILING,
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  type SpatialBoardDelegationUnit,
} from '@exawatt/ui-model';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  DELEGATION_MOTION,
  delegationSettleMs,
  delegationStatusPieces,
  delegationBodyScale,
  delegationRoster,
  delegationSpawnDelaySeconds,
  easeOutCubic,
  nextDelegationExits,
} from './delegation-roster';

function unit(id: string): SpatialBoardDelegationUnit {
  return {
    id,
    parentPieceId: 'agent:p',
    parentAgentId: 'p',
    parentX: 0,
    parentY: 0,
    projectId: 'project:Alpha',
    kind: 'child',
    childId: id,
    agentType: 'Explore',
    description: null,
    startedAt: null,
    overflowCount: 0,
    x: 1,
    y: 1,
    size: 1,
    tether: { x1: 0, y1: 0, x2: 1, y2: 1 },
  };
}

describe('delegation motion policy', () => {
  it('starts a unit small at its origin and settles it at full size', () => {
    expect(delegationBodyScale(2, easeOutCubic(0))).toBeCloseTo(
      2 * DELEGATION_MOTION.spawnScaleFloor
    );
    expect(delegationBodyScale(2, easeOutCubic(1))).toBeCloseTo(2);
  });

  it('eases out without overshooting, so a spawn never bounces', () => {
    for (let step = 0; step <= 10; step += 1) {
      const value = easeOutCubic(step / 10);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('staggers a cohort but caps the total wait', () => {
    expect(delegationSpawnDelaySeconds(0)).toBe(0);
    expect(delegationSpawnDelaySeconds(1)).toBeCloseTo(
      DELEGATION_MOTION.staggerSeconds
    );
    expect(delegationSpawnDelaySeconds(1_000)).toBe(
      DELEGATION_MOTION.maxStaggerSeconds
    );
  });

  it('lets each unit take its light when IT lands, not when the cohort does', () => {
    // The light is drawn at a unit's resting slot, so it may only appear once
    // that unit has finished travelling — and a lone child should not wait out
    // a stagger it never had.
    expect(delegationSettleMs(0)).toBeCloseTo(
      DELEGATION_MOTION.spawnSeconds * 1000
    );
    expect(delegationSettleMs(1)).toBeGreaterThan(delegationSettleMs(0));
    expect(delegationSettleMs(50)).toBeCloseTo(
      (DELEGATION_MOTION.spawnSeconds + DELEGATION_MOTION.maxStaggerSeconds) *
        1000
    );
  });

  it('never grants a light before the body finishes travelling', () => {
    for (const index of [0, 1, 4, 20]) {
      expect(delegationSettleMs(index)).toBeGreaterThanOrEqual(
        DELEGATION_MOTION.spawnSeconds * 1000
      );
    }
  });

  it('sizes the instance buffer above the board ceiling it must never truncate', () => {
    expect(DELEGATION_MOTION.instanceLimit).toBeGreaterThanOrEqual(
      SPATIAL_DELEGATION_UNIT_CEILING
    );
  });
});

describe('delegation status pieces', () => {
  it('renders a live child as a working unit through the shared D40 layer', () => {
    const [piece] = delegationStatusPieces([unit('a')]);
    expect(piece).toMatchObject({
      id: 'a',
      kind: 'agent',
      status: 'working',
      visible: true,
      labelVisibility: 'hidden',
    });
    // The child is not independently selectable or commandable (D3c).
    expect(piece!.agentId).toBeNull();
    expect(piece!.needsAttention).toBe(false);
  });

  it('places the mark at the unit, at the unit size', () => {
    const child = { ...unit('a'), x: 12, y: -4, size: 1.6 };
    const [piece] = delegationStatusPieces([child]);
    expect(piece).toMatchObject({ x: 12, y: -4, size: 1.6 });
  });

  it('never lights an overflow lobe — one light cannot speak for several Agents', () => {
    const lobe = { ...unit('lobe'), kind: 'overflow' as const, overflowCount: 9 };
    expect(delegationStatusPieces([lobe])).toEqual([]);
    expect(delegationStatusPieces([unit('a'), lobe])).toHaveLength(1);
  });

  it('reports no burn, so the burn lens shows unknown rather than a fake zero', () => {
    expect(delegationStatusPieces([unit('a')])[0]!.burnIntensity).toBeNull();
  });
});

describe('delegation roster', () => {
  it('retains a departed unit so it can retract', () => {
    const result = nextDelegationExits([], [unit('a'), unit('b')], [unit('a')], false);
    expect(result.exits.map(entry => entry.id)).toEqual(['b']);
    expect(result.departed.map(entry => entry.id)).toEqual(['b']);
    expect(result.changed).toBe(true);
  });

  it('reclaims a unit that reappears before the sweep instead of animating it twice', () => {
    const exiting = nextDelegationExits([], [unit('a')], [], false);
    expect(exiting.exits.map(entry => entry.id)).toEqual(['a']);
    const returned = nextDelegationExits(exiting.exits, [], [unit('a')], false);
    expect(returned.exits).toEqual([]);
    expect(returned.changed).toBe(true);
  });

  it('reports no change when nothing left, so state is not churned', () => {
    const current: SpatialBoardDelegationUnit[] = [];
    const result = nextDelegationExits(current, [unit('a')], [unit('a')], false);
    expect(result.changed).toBe(false);
    expect(result.departed).toEqual([]);
    // Unchanged hands back the SAME array, so React state and the render memo
    // both stay put instead of being churned by a fresh copy every layout.
    expect(result.exits).toBe(current);
  });

  it('drops exits entirely under reduced motion — same census, no travel', () => {
    const result = nextDelegationExits([unit('a')], [unit('a')], [], true);
    expect(result.exits).toEqual([]);
    expect(result.departed).toEqual([]);
    expect(result.changed).toBe(true);
  });

  it('marks live units and exiting units distinctly in one roster', () => {
    const roster = delegationRoster([unit('a')], [unit('b')]);
    expect(roster).toEqual([
      { unit: unit('a'), exiting: false },
      { unit: unit('b'), exiting: true },
    ]);
  });
});

/**
 * The buffer ceiling is only meaningful if it actually bounds what the model
 * can emit. This pins the two together against a worst-case fleet.
 */
describe('delegation unit ceiling', () => {
  const metrics: FleetMetrics = {
    activeCount: 0,
    blockedCount: 0,
    idleCount: 0,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  };

  it('bounds the units a maximally delegating fleet can emit', () => {
    const agents: ExawattAgent[] = Array.from({ length: 400 }, (_, index) => ({
      id: `a${index}`,
      name: `Agent ${index}`,
      status: 'working',
      goal: `Work ${index}`,
      project: `Project ${index % 6}`,
      sessionKey: `a${index}`,
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
      delegation: {
        children: Array.from({ length: 12 }, (_, child) => ({
          id: `a${index}-c${child}`,
          agentType: 'Explore',
          description: null,
          startedAt: 1,
        })),
      },
    }));
    const state: FleetState = {
      agents: Object.fromEntries(agents.map(item => [item.id, item])),
      metrics,
      lastUpdated: 1,
    };
    for (const altitude of ['fleet', 'project'] as const) {
      const layout = selectSpatialBoardLayout(state, {
        altitude,
        focusedProjectId: altitude === 'project' ? 'project:Project 0' : null,
      });
      const units = selectSpatialDelegationUnits(layout);
      expect(units.length).toBeLessThanOrEqual(SPATIAL_DELEGATION_UNIT_CEILING);
    }
  });
});
