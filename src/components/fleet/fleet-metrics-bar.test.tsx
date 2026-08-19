import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';

/**
 * ENG-010: the fleet status row is the one surface that turns work states
 * into a headcount, so a coworker nobody has reported on is the easiest place
 * in the product to be counted as one more Agent quietly waiting.
 */
const EMPTY_METRICS: FleetMetrics = {
  activeCount: 0,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

const fleet = vi.hoisted(() => ({
  agents: [] as ExawattAgent[],
}));

vi.mock('@/lib/fleet/fleet-provider', () => ({
  useFleet: () => ({
    agents: fleet.agents,
    metrics: EMPTY_METRICS,
    fleetState: {} as FleetState,
    projects: [],
  }),
  useFleetConnection: () => ({ status: 'connected', isDemo: false }),
}));

const { FleetMetricsBar } = await import('./fleet-metrics-bar');

function agent(id: string, status: ExawattAgent['status']): ExawattAgent {
  return {
    id,
    name: id,
    status,
    goal: '',
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
  };
}

/** The count rendered beside a status word. */
function tally(word: string): string {
  const row = screen.getByText(word).parentElement!;
  return within(row).getByText(/^\d+$/).textContent!;
}

afterEach(cleanup);

describe('the fleet status row', () => {
  it('does not count an unreported Agent as idle', () => {
    fleet.agents = [
      agent('resting', 'idle'),
      agent('unheard', null),
      agent('busy', 'working'),
    ];
    render(<FleetMetricsBar />);
    expect(tally('Idle')).toBe('1');
    expect(tally('Not reported')).toBe('1');
    expect(tally('Working')).toBe('1');
  });

  it('stays silent about a state nobody is in', () => {
    fleet.agents = [agent('resting', 'idle')];
    render(<FleetMetricsBar />);
    expect(tally('Idle')).toBe('1');
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
  });

  it('reads correctly with colour switched off', () => {
    fleet.agents = [agent('resting', 'idle'), agent('unheard', null)];
    const { container } = render(<FleetMetricsBar />);
    // Two rows share the unlit paint. The words are what tell them apart, and
    // the words are text, so a monochrome screen loses nothing.
    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('Not reported')).toBeInTheDocument();
    expect(
      container.querySelector('[data-status-light="unreported"]')
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-status-light="off"]')
    ).toBeInTheDocument();
  });
});
