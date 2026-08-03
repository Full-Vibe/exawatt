import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetManager } from '../state/fleet-manager';
import { TypedEmitter, type CoreEventMap } from '../events/emitter';
import { createAgent, INITIAL_AGENT_METRICS } from '../types/agent';
import type { ExawattAgent, AgentActivity, AgentMetrics } from '../types/agent';
import type { OCClient } from '../oc/client';
import type { OCMethods } from '../oc/methods';

const hoisted = vi.hoisted(() => ({
  mockFetchAgents: vi.fn<() => Promise<ExawattAgent[]>>(),
  latestChatAdapter: null as {
    emit<E extends 'chat:message' | 'chat:tool'>(
      event: E,
      payload: CoreEventMap[E]
    ): void;
  } | null,
}));

vi.mock('../adapters/fleet-adapter', () => {
  class MockFleetAdapter {
    fetchAgents = hoisted.mockFetchAgents;
  }

  return { FleetAdapter: MockFleetAdapter };
});

vi.mock('../adapters/chat-adapter', () => {
  class MockChatAdapter {
    private handlers: {
      'chat:message': Array<(data: CoreEventMap['chat:message']) => void>;
      'chat:tool': Array<(data: CoreEventMap['chat:tool']) => void>;
    } = {
      'chat:message': [],
      'chat:tool': [],
    };

    constructor() {
      hoisted.latestChatAdapter = this;
    }

    on<E extends 'chat:message' | 'chat:tool'>(
      event: E,
      handler: (data: CoreEventMap[E]) => void
    ): void {
      this.handlers[event].push(handler as never);
    }

    emit<E extends 'chat:message' | 'chat:tool'>(
      event: E,
      payload: CoreEventMap[E]
    ): void {
      for (const handler of this.handlers[event]) {
        handler(payload as never);
      }
    }

    destroy(): void {}
  }

  return { ChatAdapter: MockChatAdapter };
});

class MockClient extends TypedEmitter<CoreEventMap> {
  onOCEvent(_eventName: string, _handler: (payload: unknown) => void): void {}

  offOCEvent(_eventName: string, _handler: (payload: unknown) => void): void {}
}

function makeMetrics(overrides: Partial<AgentMetrics> = {}): AgentMetrics {
  return {
    ...INITIAL_AGENT_METRICS,
    ...overrides,
    costHistory: overrides.costHistory ?? [],
  };
}

function makeAgent(
  overrides: Partial<ExawattAgent> & { id: string }
): ExawattAgent {
  const { id, metrics, ...rest } = overrides;
  return createAgent({
    id,
    name: overrides.name ?? id,
    goal: '',
    project: overrides.project ?? '',
    sessionKey: overrides.sessionKey ?? id,
    status: overrides.status ?? 'idle',
    metrics: makeMetrics(metrics),
    ...rest,
  });
}

function makeConnectedManager() {
  const manager = new FleetManager();
  const client = new MockClient();
  const methods = {
    cronList: vi.fn().mockResolvedValue({ jobs: [] }),
    cronAdd: vi.fn(),
    cronRun: vi.fn(),
    cronUpdate: vi.fn(),
    cronRemove: vi.fn(),
    cronRuns: vi.fn(),
  } as unknown as OCMethods;

  manager.connect(client as unknown as OCClient, methods);

  return { manager, client, methods };
}

describe('FleetManager', () => {
  beforeEach(() => {
    hoisted.mockFetchAgents.mockReset();
    hoisted.latestChatAdapter = null;
    vi.useRealTimers();
  });

  it('getAllAgents() returns empty initially', () => {
    const manager = new FleetManager();
    expect(manager.getAllAgents()).toEqual([]);
  });

  it('replaceAgents atomically removes agents absent from a source snapshot', () => {
    const manager = new FleetManager();
    const update = vi.fn();
    manager.on('fleet:updated', update);
    manager.seedAgents([
      makeAgent({ id: 'keep' }),
      makeAgent({ id: 'remove' }),
    ]);
    update.mockClear();

    manager.replaceAgents([makeAgent({ id: 'keep', status: 'working' })]);

    expect(manager.getAllAgents().map(agent => agent.id)).toEqual(['keep']);
    expect(manager.getAgent('keep')?.status).toBe('working');
    expect(manager.getAgent('remove')).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('refresh() populates agents from FleetAdapter', async () => {
    const { manager } = makeConnectedManager();
    const agent = makeAgent({ id: 'agent-1', status: 'working' });
    hoisted.mockFetchAgents.mockResolvedValueOnce([agent]);

    await manager.refresh();

    expect(manager.getAllAgents()).toHaveLength(1);
    expect(manager.getAgent('agent-1')?.status).toBe('working');
  });

  it('getFleetState() computes correct aggregate metrics', async () => {
    const { manager } = makeConnectedManager();

    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({
        id: 'working-1',
        status: 'working',
        project: 'proj-a',
        metrics: makeMetrics({
          estimatedCost: 1.5,
          tokensIn: 100,
          tokensOut: 50,
          costRate: 3,
        }),
      }),
      makeAgent({
        id: 'reviewing-1',
        status: 'reviewing',
        project: 'proj-a',
        metrics: makeMetrics({
          estimatedCost: 0.5,
          tokensIn: 30,
          tokensOut: 20,
          costRate: 2,
        }),
      }),
      makeAgent({
        id: 'blocked-1',
        status: 'blocked',
        project: 'proj-b',
        metrics: makeMetrics({
          estimatedCost: 2,
          tokensIn: 10,
          tokensOut: 5,
          costRate: 0,
        }),
      }),
      makeAgent({
        id: 'idle-1',
        status: 'idle',
        project: 'proj-b',
        metrics: makeMetrics({
          estimatedCost: 1,
          tokensIn: 5,
          tokensOut: 5,
          costRate: 1,
        }),
      }),
      makeAgent({
        id: 'complete-1',
        status: 'complete',
        metrics: makeMetrics({
          estimatedCost: 0.25,
          tokensIn: 2,
          tokensOut: 3,
          costRate: 0,
        }),
      }),
      makeAgent({
        id: 'error-1',
        status: 'error',
        metrics: makeMetrics({
          estimatedCost: 0.75,
          tokensIn: 8,
          tokensOut: 7,
          costRate: 0,
        }),
      }),
    ]);

    await manager.refresh();
    const state = manager.getFleetState();

    expect(state.metrics.activeCount).toBe(2);
    // error folds into blocked: needs-attention semantics (D40)
    expect(state.metrics.blockedCount).toBe(2);
    expect(state.metrics.idleCount).toBe(2);
    expect(state.metrics.totalCost).toBe(6);
    expect(state.metrics.totalTokens).toBe(245);
    expect(state.metrics.totalCostRate).toBe(6);
    expect(state.metrics.costByProject).toEqual({
      'proj-a': 2,
      'proj-b': 3,
    });
  });

  it('getBlockedAgents() filters blocked agents', async () => {
    const { manager } = makeConnectedManager();
    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({ id: 'blocked-1', status: 'blocked' }),
      makeAgent({ id: 'idle-1', status: 'idle' }),
      makeAgent({ id: 'blocked-2', status: 'blocked' }),
    ]);

    await manager.refresh();

    expect(manager.getBlockedAgents().map(agent => agent.id)).toEqual([
      'blocked-1',
      'blocked-2',
    ]);
  });

  it('chat message event updates lastActivityAt and activities array', async () => {
    const { manager } = makeConnectedManager();
    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({ id: 'agent-1', status: 'working' }),
    ]);
    await manager.refresh();

    const activity: AgentActivity = {
      id: 'activity-1',
      timestamp: 123_456,
      type: 'chat_message',
      content: 'hello',
    };

    hoisted.latestChatAdapter?.emit('chat:message', {
      agentId: 'agent-1',
      activity,
    });

    const updated = manager.getAgent('agent-1');
    expect(updated?.lastActivityAt).toBe(123_456);
    expect(updated?.activities).toHaveLength(1);
    expect(updated?.activities?.[0]).toEqual(activity);
  });

  it("chat message when agent is idle changes status to 'working'", async () => {
    const { manager } = makeConnectedManager();
    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({ id: 'agent-1', status: 'idle' }),
    ]);
    await manager.refresh();

    hoisted.latestChatAdapter?.emit('chat:message', {
      agentId: 'agent-1',
      activity: {
        id: 'activity-1',
        timestamp: 123_456,
        type: 'chat_message',
        content: 'agent reply',
      },
    });

    expect(manager.getAgent('agent-1')?.status).toBe('working');
  });

  it("connect() + connection:status='connected' triggers refresh", async () => {
    const { manager, client } = makeConnectedManager();
    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({ id: 'agent-1' }),
    ]);

    client.emit('connection:status', 'connected');

    await vi.waitFor(() => {
      expect(hoisted.mockFetchAgents).toHaveBeenCalledTimes(1);
      expect(manager.getAgent('agent-1')).toBeDefined();
    });
  });

  it('getCostReport() returns correct totals and rate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:10:00.000Z'));

    const now = Date.now();
    const { manager } = makeConnectedManager();
    hoisted.mockFetchAgents.mockResolvedValueOnce([
      makeAgent({
        id: 'agent-1',
        project: 'proj-a',
        metrics: makeMetrics({
          estimatedCost: 4,
          costHistory: [
            { timestamp: now - 60_000, cumulativeCost: 1 },
            { timestamp: now, cumulativeCost: 2 },
          ],
        }),
      }),
      makeAgent({
        id: 'agent-2',
        project: 'proj-a',
        metrics: makeMetrics({
          estimatedCost: 2,
          costHistory: [
            { timestamp: now - 30_000, cumulativeCost: 0.5 },
            { timestamp: now, cumulativeCost: 1 },
          ],
        }),
      }),
      makeAgent({
        id: 'agent-3',
        project: 'proj-b',
        metrics: makeMetrics({
          estimatedCost: 3,
          costHistory: [{ timestamp: now, cumulativeCost: 3 }],
        }),
      }),
    ]);

    await manager.refresh();
    const report = manager.getCostReport();

    expect(report.totalCost).toBe(9);
    expect(report.costRate).toBe(120);
    expect(report.costByAgent).toEqual({
      'agent-1': 4,
      'agent-2': 2,
      'agent-3': 3,
    });
    expect(report.costByProject).toEqual({
      'proj-a': 6,
      'proj-b': 3,
    });
  });
});
