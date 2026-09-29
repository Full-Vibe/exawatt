import { describe, expect, it } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import {
  selectSpatialBoardLayout,
  selectSpatialDelegationUnits,
  type SpatialBoardLayout,
} from '@exawatt/ui-model';
import {
  workStateReading,
  type StatusLightReading,
} from '@/components/status-light';
import { fleetStatusCounts } from '../../fleet-status-counts';
import { delegationStatusPieces } from './delegation-roster';
import { statusMarkSubjects } from './status-mark-subjects';

/**
 * BUG-225: the counts bar and the board are two readouts of one fleet. For
 * every reading, the bar's figure must equal what the board draws: one mark
 * per Agent, one Active light per delegated child, and the children folded
 * into an overflow lobe counted by the lobe's "+N".
 */
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
  status: ExawattAgent['status'],
  extra: Partial<ExawattAgent> = {}
): ExawattAgent {
  return {
    id,
    name: id,
    status,
    goal: `Work for ${id}`,
    project: 'Alpha',
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
    ...extra,
  };
}

function team(size: number) {
  return {
    children: Array.from({ length: size }, (_, index) => ({
      id: `child-${index}`,
      agentType: 'Explore',
      description: null,
      startedAt: 1,
    })),
  };
}

/** What the board draws, counted in the bar's terms. */
function boardCensus(layout: SpatialBoardLayout) {
  const census: Record<StatusLightReading, number> = {
    active: 0,
    'needs-you': 0,
    fault: 0,
    result: 0,
    off: 0,
    unreported: 0,
  };
  const visible = layout.pieces.filter(
    piece => piece.visible && piece.kind === 'agent'
  );
  const solid = visible.filter(piece => piece.sessionState !== 'stopped');
  const units = selectSpatialDelegationUnits(layout);
  for (const piece of [
    ...statusMarkSubjects(solid, visible),
    ...delegationStatusPieces(units),
  ]) {
    census[workStateReading(piece.status)] += 1;
  }
  for (const unit of units) {
    if (unit.kind === 'overflow') census.active += unit.overflowCount;
  }
  return { census, visible: visible.length };
}

describe('the counts bar and the board', () => {
  const agents = [
    agent('working', 'working'),
    agent('reviewing', 'reviewing', { delegation: team(3) }),
    agent('delegating-wide', 'working', { delegation: team(9) }),
    agent('finished', 'complete'),
    agent('finished-and-exited', 'complete', { sessionState: 'stopped' }),
    agent('exited-mid-turn', 'working', { sessionState: 'stopped' }),
    agent('failed', 'error', { sessionState: 'stopped' }),
    agent('asking', 'blocked'),
    agent('resting', 'idle'),
    agent('closed', 'idle', { sessionState: 'stopped' }),
    agent('unheard', null),
  ];
  const layout = selectSpatialBoardLayout({
    agents: Object.fromEntries(agents.map(item => [item.id, item])),
    metrics,
    lastUpdated: 1,
  } satisfies FleetState);

  it('draws every Agent the bar counts, stopped Sessions included', () => {
    const { visible } = boardCensus(layout);
    expect(visible).toBe(agents.length);
  });

  it('agrees on every reading', () => {
    expect(boardCensus(layout).census).toEqual(
      fleetStatusCounts(agents).readings
    );
  });

  it('counts each delegated child as Working, overflow included', () => {
    const counts = fleetStatusCounts(agents);
    expect(counts.delegated).toBe(12);
    // three top-level Agents are working or reviewing, plus one exited mid-turn
    expect(counts.readings.active).toBe(4 + 12);
    expect(
      selectSpatialDelegationUnits(layout).some(unit => unit.kind === 'overflow')
    ).toBe(true);
  });

  it('adds nothing for a source that reports no delegation', () => {
    expect(fleetStatusCounts([agent('quiet', 'working')])).toEqual({
      readings: {
        active: 1,
        'needs-you': 0,
        fault: 0,
        result: 0,
        off: 0,
        unreported: 0,
      },
      delegated: 0,
    });
  });
});

describe('statusMarkSubjects', () => {
  it('marks a piece that is still retiring after it stopped once, as its stopped self', () => {
    const [piece] = selectSpatialBoardLayout({
      agents: { a: agent('a', 'complete', { sessionState: 'stopped' }) },
      metrics,
      lastUpdated: 1,
    }).pieces.filter(item => item.kind === 'agent');
    const departing = {
      ...piece!,
      status: 'working' as const,
      sessionState: 'live' as const,
    };
    const subjects = statusMarkSubjects([departing], [piece!]);
    expect(subjects).toEqual([piece]);
  });
});
