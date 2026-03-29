import { describe, it, expect } from 'vitest';
import {
  createAgent,
  INITIAL_AGENT_METRICS,
  type ExawattAgent,
  type AgentStatus,
  type BlockerType,
  type Goal,
  type FleetState,
  type FleetMetrics,
} from '../types/index';

describe('ExawattAgent', () => {
  it('createAgent produces valid agent with defaults', () => {
    const agent = createAgent({ id: 'test-1', name: 'TestAgent' });
    expect(agent.id).toBe('test-1');
    expect(agent.name).toBe('TestAgent');
    expect(agent.status).toBe('idle');
    expect(agent.goal).toBe('');
    expect(agent.project).toBe('');
    expect(agent.sessionKey).toBe('');
    expect(agent.metrics.tokensIn).toBe(0);
    expect(agent.metrics.costHistory).toEqual([]);
    expect(agent.createdAt).toBeGreaterThan(0);
    expect(agent.lastActivityAt).toBeGreaterThan(0);
  });

  it('createAgent allows overriding defaults', () => {
    const agent = createAgent({
      id: 'a',
      name: 'B',
      status: 'working' as AgentStatus,
      goal: 'Do X',
      project: 'ProjectA',
    });
    expect(agent.status).toBe('working');
    expect(agent.goal).toBe('Do X');
    expect(agent.project).toBe('ProjectA');
  });

  it('createAgent preserves all required fields', () => {
    const agent = createAgent({
      id: 'agent-123',
      name: 'MyAgent',
      sessionKey: 'session-abc',
    });
    expect(agent.id).toBe('agent-123');
    expect(agent.name).toBe('MyAgent');
    expect(agent.sessionKey).toBe('session-abc');
    expect(agent.metrics).toBeDefined();
    expect(agent.createdAt).toBeGreaterThan(0);
  });

  it('createAgent with blocker info', () => {
    const agent = createAgent({
      id: 'blocked-agent',
      name: 'BlockedAgent',
      status: 'blocked' as AgentStatus,
      blockerInfo: {
        type: 'input_needed' as BlockerType,
        title: 'Need clarification',
        description: 'Please provide more details',
        createdAt: Date.now(),
      },
    });
    expect(agent.status).toBe('blocked');
    expect(agent.blockerInfo?.type).toBe('input_needed');
    expect(agent.blockerInfo?.title).toBe('Need clarification');
  });

  it('createAgent with activities', () => {
    const now = Date.now();
    const agent = createAgent({
      id: 'active-agent',
      name: 'ActiveAgent',
      activities: [
        {
          id: 'act-1',
          timestamp: now,
          type: 'status_change',
          content: 'Status changed to working',
        },
      ],
    });
    expect(agent.activities).toHaveLength(1);
    expect(agent.activities?.[0].type).toBe('status_change');
  });
});

describe('INITIAL_AGENT_METRICS', () => {
  it('has zero values', () => {
    expect(INITIAL_AGENT_METRICS.tokensIn).toBe(0);
    expect(INITIAL_AGENT_METRICS.tokensOut).toBe(0);
    expect(INITIAL_AGENT_METRICS.estimatedCost).toBe(0);
    expect(INITIAL_AGENT_METRICS.turnCount).toBe(0);
    expect(INITIAL_AGENT_METRICS.costRate).toBe(0);
    expect(INITIAL_AGENT_METRICS.tokenRate).toBe(0);
  });

  it('has null startedAt', () => {
    expect(INITIAL_AGENT_METRICS.startedAt).toBeNull();
  });

  it('has empty cost history', () => {
    expect(INITIAL_AGENT_METRICS.costHistory).toEqual([]);
  });

  it('has zero duration', () => {
    expect(INITIAL_AGENT_METRICS.duration).toBe(0);
  });
});

describe('AgentStatus type', () => {
  it('accepts valid status values', () => {
    const statuses: AgentStatus[] = [
      'working',
      'blocked',
      'idle',
      'reviewing',
      'complete',
      'error',
    ];
    expect(statuses).toHaveLength(6);
  });
});

describe('BlockerType type', () => {
  it('accepts valid blocker types', () => {
    const types: BlockerType[] = [
      'input_needed',
      'approval_required',
      'credentials_needed',
      'error',
      'awaiting_agent',
    ];
    expect(types).toHaveLength(5);
  });
});

describe('Goal type', () => {
  it('creates valid goal', () => {
    const goal: Goal = {
      id: 'goal-1',
      agentId: 'agent-1',
      description: 'Implement feature X',
      status: 'active',
      createdAt: Date.now(),
      milestones: ['Design', 'Implement', 'Test'],
    };
    expect(goal.id).toBe('goal-1');
    expect(goal.agentId).toBe('agent-1');
    expect(goal.status).toBe('active');
    expect(goal.milestones).toHaveLength(3);
  });

  it('goal without milestones is valid', () => {
    const goal: Goal = {
      id: 'goal-2',
      agentId: 'agent-2',
      description: 'Simple task',
      status: 'complete',
      createdAt: Date.now(),
    };
    expect(goal.milestones).toBeUndefined();
  });
});

describe('FleetMetrics type', () => {
  it('creates valid fleet metrics', () => {
    const metrics: FleetMetrics = {
      activeCount: 3,
      blockedCount: 1,
      idleCount: 2,
      totalCost: 42.5,
      totalTokens: 100000,
      totalCostRate: 15.0,
      costByProject: {
        'Project A': 25.0,
        'Project B': 17.5,
      },
    };
    expect(metrics.activeCount).toBe(3);
    expect(metrics.totalCost).toBe(42.5);
    expect(metrics.costByProject['Project A']).toBe(25.0);
  });
});

describe('FleetState type', () => {
  it('creates valid fleet state', () => {
    const agent1 = createAgent({ id: 'a1', name: 'Agent 1' });
    const agent2 = createAgent({ id: 'a2', name: 'Agent 2' });

    const state: FleetState = {
      agents: {
        a1: agent1,
        a2: agent2,
      },
      metrics: {
        activeCount: 1,
        blockedCount: 0,
        idleCount: 1,
        totalCost: 10.0,
        totalTokens: 50000,
        totalCostRate: 5.0,
        costByProject: {},
      },
      lastUpdated: Date.now(),
    };

    expect(Object.keys(state.agents)).toHaveLength(2);
    expect(state.agents.a1.name).toBe('Agent 1');
    expect(state.metrics.activeCount).toBe(1);
  });
});
