import { describe, expect, it } from 'vitest';
import type {
  ExawattAgent,
  ExawattCronJob,
  FleetMetrics,
  FleetState,
} from '@exawatt/core';
import {
  selectActivityFeed,
  selectFleetCommandView,
  selectOperatorQueue,
  selectSortedAgents,
  selectSpatialAgentLayout,
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

  it('creates deterministic spatial layout without Three.js types', () => {
    const first = selectSpatialAgentLayout(state(), {
      selectedAgentId: 'working-1',
    });
    const second = selectSpatialAgentLayout(state(), {
      selectedAgentId: 'working-1',
    });

    expect(first).toEqual(second);
    expect(first.find(item => item.agentId === 'working-1')).toEqual(
      expect.objectContaining({
        selected: true,
        active: true,
      })
    );
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
});
