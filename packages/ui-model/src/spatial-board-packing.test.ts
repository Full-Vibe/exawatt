import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  relaxBoardUnits,
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  type RelaxableUnit,
  type SpatialBoardLayout,
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
  children = 0
): ExawattAgent {
  return {
    id,
    name: `Agent ${id}`,
    status: 'working',
    goal: `Work ${id}`,
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
    ...(children > 0
      ? {
          delegation: {
            children: Array.from({ length: children }, (_, index) => ({
              id: `${id}-c${index}`,
              agentType: 'Explore',
              description: null,
              startedAt: 1,
            })),
          },
        }
      : {}),
  };
}

function fleet(agents: ExawattAgent[]): FleetState {
  return {
    agents: Object.fromEntries(agents.map(item => [item.id, item])),
    metrics,
    lastUpdated: 1,
  };
}

/** Every drawn unit as a disc, which is what "does this overlap" means. */
function discs(layout: SpatialBoardLayout) {
  const out: Array<{ id: string; x: number; y: number; r: number }> = [];
  for (const piece of layout.pieces) {
    if (piece.kind !== 'agent' || !piece.visible) continue;
    out.push({ id: piece.id, x: piece.x, y: piece.y, r: piece.size / 2 });
  }
  for (const unit of selectSpatialDelegationUnits(layout)) {
    out.push({ id: unit.id, x: unit.x, y: unit.y, r: unit.size / 2 });
  }
  return out;
}

function worstOverlap(layout: SpatialBoardLayout) {
  const units = discs(layout);
  let worst = { fraction: 0, pair: '' };
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const a = units[i]!;
      const b = units[j]!;
      const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.r + b.r);
      if (gap >= -0.001) continue;
      const fraction = -gap / (Math.min(a.r, b.r) * 2);
      if (fraction > worst.fraction) {
        worst = { fraction, pair: `${a.id} × ${b.id}` };
      }
    }
  }
  return worst;
}

/**
 * The invariant that did not exist (ENG-004, 2026-08-11).
 *
 * A delegated child once shipped at 85% overlap with a NEIGHBOURING Agent —
 * through a full type-check, 2,099 unit tests, `eval:r3f` 100/100, every scale
 * tier, and a screenshot review. Nothing in the suite had ever asked whether
 * two units occupy the same space, because every check was about draw calls,
 * frame budgets, or DOM contracts. Geometry had no oracle. This is it.
 */
describe('board packing', () => {
  const scenarios: Array<[string, FleetState]> = [
    ['no delegation', fleet([agent('a', 'Alpha'), agent('b', 'Alpha')])],
    [
      'one delegating Agent',
      fleet([agent('a', 'Alpha', 3), agent('b', 'Alpha'), agent('c', 'Alpha')]),
    ],
    [
      'every Agent delegating',
      fleet(
        Array.from({ length: 12 }, (_, index) =>
          agent(`a${index}`, 'Alpha', 4)
        )
      ),
    ],
    [
      'overflowing fan-out',
      fleet([agent('a', 'Alpha', 17), agent('b', 'Alpha', 17)]),
    ],
    [
      'many Projects, mixed delegation',
      fleet(
        Array.from({ length: 40 }, (_, index) =>
          agent(`a${index}`, `Project ${index % 7}`, index % 3 === 0 ? 5 : 0)
        )
      ),
    ],
  ];

  for (const [label, state] of scenarios) {
    it(`draws no two units on top of each other — ${label}`, () => {
      const layout = selectSpatialBoardLayout(state);
      const worst = worstOverlap(layout);
      expect(worst, `overlap at fleet: ${worst.pair}`).toMatchObject({
        fraction: 0,
      });
      for (const zone of layout.zones.slice(0, 3)) {
        const focused = selectSpatialBoardLayout(state, {
          altitude: 'project',
          focusedProjectId: zone.id,
        });
        const inner = worstOverlap(focused);
        expect(inner, `overlap in ${zone.id}: ${inner.pair}`).toMatchObject({
          fraction: 0,
        });
      }
    });
  }

  it('keeps a Project circle sized by population, not by delegation', () => {
    // Circle area is how the board says how much is running. If delegation
    // could grow it, a small busy Project would outrank a large quiet one.
    const quiet = selectSpatialBoardLayout(
      fleet(Array.from({ length: 9 }, (_, i) => agent(`a${i}`, 'Alpha')))
    );
    const busy = selectSpatialBoardLayout(
      fleet(Array.from({ length: 9 }, (_, i) => agent(`a${i}`, 'Alpha', 4)))
    );
    expect(busy.zones[0]!.radius).toBeCloseTo(quiet.zones[0]!.radius, 4);
  });

  it('gives two Projects of equal population the same unit size', () => {
    const layout = selectSpatialBoardLayout(
      fleet([
        ...Array.from({ length: 6 }, (_, i) => agent(`x${i}`, 'Alpha', 3)),
        ...Array.from({ length: 6 }, (_, i) => agent(`y${i}`, 'Beta')),
      ])
    );
    const [alpha, beta] = layout.zones;
    expect(alpha!.unitSize).toBeCloseTo(beta!.unitSize, 4);
  });
});

describe('unit relaxation', () => {
  const seed = (): RelaxableUnit[] => [
    { id: 'a', x: 0, y: 0, radius: 1, kind: 'agent' },
    { id: 'b', x: 0.4, y: 0, radius: 1, kind: 'child' },
    { id: 'c', x: -0.4, y: 0.2, radius: 1, kind: 'child' },
  ];

  it('separates overlapping units', () => {
    const units = relaxBoardUnits(seed());
    for (let i = 0; i < units.length; i += 1) {
      for (let j = i + 1; j < units.length; j += 1) {
        const a = units[i]!;
        const b = units[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(
          a.radius + b.radius - 0.001
        );
      }
    }
  });

  it('is deterministic — the layout is pure and its snapshots are compared', () => {
    expect(relaxBoardUnits(seed())).toEqual(relaxBoardUnits(seed()));
  });

  it('does not depend on the order the caller built the list', () => {
    const forward = relaxBoardUnits(seed());
    const reversed = relaxBoardUnits([...seed()].reverse());
    for (const unit of forward) {
      const other = reversed.find(entry => entry.id === unit.id)!;
      expect(other.x).toBeCloseTo(unit.x, 6);
      expect(other.y).toBeCloseTo(unit.y, 6);
    }
  });

  it('moves a child further than an Agent, because an Agent position is its address', () => {
    const units = relaxBoardUnits(seed());
    const moved = (id: string, x: number, y: number) => {
      const unit = units.find(entry => entry.id === id)!;
      return Math.hypot(unit.x - x, unit.y - y);
    };
    expect(moved('a', 0, 0)).toBeLessThan(moved('b', 0.4, 0));
  });

  it('separates exactly coincident units the same way every run', () => {
    const stack = (): RelaxableUnit[] => [
      { id: 'a', x: 5, y: 5, radius: 1, kind: 'child' },
      { id: 'b', x: 5, y: 5, radius: 1, kind: 'child' },
    ];
    const once = relaxBoardUnits(stack());
    expect(relaxBoardUnits(stack())).toEqual(once);
    expect(Math.hypot(once[0]!.x - once[1]!.x, once[0]!.y - once[1]!.y)).toBeGreaterThan(1.9);
  });

  it('leaves a single unit alone', () => {
    const solo: RelaxableUnit[] = [
      { id: 'a', x: 3, y: 4, radius: 1, kind: 'agent' },
    ];
    expect(relaxBoardUnits(solo)).toEqual(solo);
  });
});
