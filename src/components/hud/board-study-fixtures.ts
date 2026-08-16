import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';

/**
 * Deterministic fleets for the Fleet board study (ENG-004).
 *
 * The board's hard cases are geometric — packing, overlap, mark legibility at
 * small unit sizes, constellation fan-out — and none of them need live data or
 * a running desktop app to reproduce. Naming each shape here means a screenshot
 * of "the crowded case" is a URL rather than a setup ritual.
 */
export type BoardStudyFixtureId =
  | 'voltaic'
  | 'fanout'
  | 'crowded'
  | 'sparse'
  | 'stopped';

export interface BoardStudyFixture {
  id: BoardStudyFixtureId;
  title: string;
  /** What this shape is for — the reason it earns a slot in the study. */
  note: string;
}

export const BOARD_STUDY_FIXTURES: BoardStudyFixture[] = [
  {
    id: 'voltaic',
    title: 'Mixed fleet',
    note: 'Ten Projects, mixed statuses, some delegating. The everyday board.',
  },
  {
    id: 'fanout',
    title: 'Fan-out',
    note: 'One Project, parents with 0 · 1 · 4 · 5 · 17 children. Every delegation state at once.',
  },
  {
    id: 'crowded',
    title: 'Crowded',
    note: 'Every Agent delegating in a full Project — the densest packing the board must survive.',
  },
  {
    id: 'sparse',
    title: 'Sparse',
    note: 'A few Agents, no delegation. Checks that a quiet board did not pay for a busy one.',
  },
  {
    id: 'stopped',
    title: 'Stopped and settled',
    note: 'Stopped Agents and finished work, where nothing should be moving.',
  },
];

const STATUSES: ExawattAgent['status'][] = [
  'working',
  'blocked',
  'reviewing',
  'idle',
  'complete',
  'error',
];

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
  status: ExawattAgent['status'],
  options: { children?: number; stopped?: boolean; goal?: string } = {}
): ExawattAgent {
  const children = options.children ?? 0;
  return {
    id,
    name: id,
    status,
    goal: options.goal ?? `Advancing ${project}`,
    project,
    sessionKey: id,
    ...(options.stopped ? { sessionState: 'stopped' as const } : {}),
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      turnCount: 3,
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
              agentType: index % 2 === 0 ? 'Explore' : 'general-purpose',
              description: `Assignment ${index + 1}`,
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

export function boardStudyFleet(id: BoardStudyFixtureId): FleetState {
  switch (id) {
    case 'fanout':
      return fleet([
        agent('none', 'Fanout', 'working'),
        agent('one', 'Fanout', 'working', { children: 1 }),
        agent('four', 'Fanout', 'working', { children: 4 }),
        agent('five', 'Fanout', 'reviewing', { children: 5 }),
        agent('seventeen', 'Fanout', 'working', { children: 17 }),
      ]);
    case 'crowded':
      return fleet(
        Array.from({ length: 18 }, (_, index) =>
          agent(`crowd-${index}`, 'Crowded', STATUSES[index % STATUSES.length]!, {
            children: 3 + (index % 3),
          })
        )
      );
    case 'sparse':
      return fleet([
        agent('alpha', 'Quiet', 'working'),
        agent('beta', 'Quiet', 'idle'),
        agent('gamma', 'Quiet', 'complete'),
      ]);
    case 'stopped':
      return fleet([
        ...Array.from({ length: 6 }, (_, index) =>
          agent(`done-${index}`, 'Settled', 'complete', { stopped: index % 2 === 0 })
        ),
        agent('idle-one', 'Settled', 'idle', { stopped: true }),
        agent('parent', 'Settled', 'complete', { children: 3, stopped: true }),
      ]);
    case 'voltaic':
    default: {
      const projects = [
        'dispatch-engine',
        'edge-gateway',
        'grid-api',
        'market-intel',
        'partner-portal',
        'platform-infra',
        'support-ops',
        'telemetry-ingest',
        'voltaic-home',
        'demand-gen',
      ];
      const agents: ExawattAgent[] = [];
      projects.forEach((project, projectIndex) => {
        const population = 6 + ((projectIndex * 5) % 18);
        for (let index = 0; index < population; index += 1) {
          const seed = projectIndex * 31 + index * 7;
          agents.push(
            agent(
              `${project}-${index}`,
              project,
              STATUSES[seed % STATUSES.length]!,
              {
                children: seed % 11 === 0 ? 2 + (seed % 3) : 0,
                stopped: seed % 17 === 0,
              }
            )
          );
        }
      });
      return fleet(agents);
    }
  }
}
