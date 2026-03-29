import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetAdapter } from '../adapters/fleet-adapter';
import type { OCClient } from '../oc/client';
import type { OCMethods } from '../oc/methods';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

class MockOCClient {
  private ocHandlers = new Map<string, ((p: unknown) => void)[]>();

  onOCEvent(name: string, handler: (p: unknown) => void) {
    if (!this.ocHandlers.has(name)) this.ocHandlers.set(name, []);
    this.ocHandlers.get(name)!.push(handler);
  }

  offOCEvent(_name: string, _handler: (p: unknown) => void) {}

  simulateEvent(name: string, payload: unknown) {
    for (const h of this.ocHandlers.get(name) ?? []) h(payload);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdapter(overrides?: {
  sessionsList?: ReturnType<typeof vi.fn>;
  cronList?: ReturnType<typeof vi.fn>;
}) {
  const client = new MockOCClient();
  const mockMethods = {
    sessionsList:
      overrides?.sessionsList ??
      vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'main',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60000,
          },
        ],
      }),
    cronList: overrides?.cronList ?? vi.fn().mockResolvedValue({ jobs: [] }),
  };
  const adapter = new FleetAdapter(
    client as unknown as OCClient,
    mockMethods as unknown as OCMethods
  );
  return { client, mockMethods, adapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FleetAdapter', () => {
  describe('fetchAgents()', () => {
    it('calls sessionsList and cronList', async () => {
      const { mockMethods, adapter } = makeAdapter();
      await adapter.fetchAgents();
      expect(mockMethods.sessionsList).toHaveBeenCalledOnce();
      expect(mockMethods.cronList).toHaveBeenCalledOnce();
    });

    it('maps sessions to ExawattAgent[]', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('main');
      expect(agents[0].sessionKey).toBe('main');
    });

    it('sessions with matching cron jobs get cronJobId set', async () => {
      const cronList = vi.fn().mockResolvedValue({
        jobs: [
          {
            id: 'cron-1',
            name: 'My Job',
            schedule: '* * * * *',
            prompt: 'Do stuff',
            sessionKey: 'main',
            enabled: true,
          },
        ],
      });
      const { adapter } = makeAdapter({ cronList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].cronJobId).toBe('cron-1');
      expect(agents[0].goal).toBe('Do stuff');
    });

    it('sessions without matching cron jobs have no cronJobId', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents[0].cronJobId).toBeUndefined();
    });

    it('handles cronList failure gracefully (empty jobs array)', async () => {
      const cronList = vi.fn().mockRejectedValue(new Error('Network error'));
      const { adapter } = makeAdapter({ cronList });
      const agents = await adapter.fetchAgents();
      expect(agents).toHaveLength(1);
      expect(agents[0].cronJobId).toBeUndefined();
    });

    it('cron jobs without sessionKey are not matched to sessions', async () => {
      const cronList = vi.fn().mockResolvedValue({
        jobs: [
          {
            id: 'cron-2',
            name: 'Unattached',
            schedule: '0 * * * *',
            prompt: 'Some prompt',
            enabled: true,
            // no sessionKey
          },
        ],
      });
      const { adapter } = makeAdapter({ cronList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].cronJobId).toBeUndefined();
    });

    it('returns empty array when no sessions', async () => {
      const sessionsList = vi.fn().mockResolvedValue({ sessions: [] });
      const { adapter } = makeAdapter({ sessionsList });
      const agents = await adapter.fetchAgents();
      expect(agents).toHaveLength(0);
    });
  });

  describe('status derivation', () => {
    it('recent activity + online → working', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'main',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60_000, // 1 min ago
          },
        ],
      });
      const { adapter } = makeAdapter({ sessionsList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].status).toBe('working');
    });

    it('old activity (>5min) → idle', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'main',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 10 * 60_000, // 10 min ago
          },
        ],
      });
      const { adapter } = makeAdapter({ sessionsList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].status).toBe('idle');
    });

    it('cron job status=error → error', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'main',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60_000,
          },
        ],
      });
      const cronList = vi.fn().mockResolvedValue({
        jobs: [
          {
            id: 'cron-1',
            name: 'Job',
            schedule: '* * * * *',
            prompt: 'Do stuff',
            sessionKey: 'main',
            enabled: true,
            status: 'error',
          },
        ],
      });
      const { adapter } = makeAdapter({ sessionsList, cronList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].status).toBe('error');
    });

    it('offline + recent activity → idle (not working)', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'agent1',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60_000, // recent
          },
        ],
      });
      const { client, adapter } = makeAdapter({ sessionsList });
      // Mark the session as offline (agentId matches session.key here)
      client.simulateEvent('presence', {
        agentId: 'agent1',
        online: false,
        sessionCount: 0,
      });
      const agents = await adapter.fetchAgents();
      expect(agents[0].status).toBe('idle');
    });
  });

  describe('presence events', () => {
    it('subscribes to presence event on construction', () => {
      const client = new MockOCClient();
      const onOCEventSpy = vi.spyOn(client, 'onOCEvent');
      const mockMethods = {
        sessionsList: vi.fn().mockResolvedValue({ sessions: [] }),
        cronList: vi.fn().mockResolvedValue({ jobs: [] }),
      };
      new FleetAdapter(
        client as unknown as OCClient,
        mockMethods as unknown as OCMethods
      );
      const names = onOCEventSpy.mock.calls.map(c => c[0]);
      expect(names).toContain('presence');
    });

    it('presence event online=false causes idle status on next fetchAgents', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'agent1',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60_000,
          },
        ],
      });
      const { client, adapter } = makeAdapter({ sessionsList });

      // Before offline event: recent activity + default online=true → working
      const agentsBefore = await adapter.fetchAgents();
      expect(agentsBefore[0].status).toBe('working');

      // Fire offline presence event matching session.key ('agent1')
      client.simulateEvent('presence', {
        agentId: 'agent1',
        online: false,
        sessionCount: 0,
      });

      // After offline: even with recent activity, not online → idle
      const agentsAfter = await adapter.fetchAgents();
      expect(agentsAfter[0].status).toBe('idle');
    });

    it('presence online=true restores working status', async () => {
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'agent1',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt: Date.now() - 60_000,
          },
        ],
      });
      const { client, adapter } = makeAdapter({ sessionsList });

      // Go offline then back online
      client.simulateEvent('presence', {
        agentId: 'agent1',
        online: false,
        sessionCount: 0,
      });
      client.simulateEvent('presence', {
        agentId: 'agent1',
        online: true,
        sessionCount: 1,
      });

      const agents = await adapter.fetchAgents();
      expect(agents[0].status).toBe('working');
    });
  });

  describe('createAgent()', () => {
    it('creates an agent with the given goal', async () => {
      const { adapter } = makeAdapter();
      const agent = await adapter.createAgent('Build a feature', 'my-session');
      expect(agent.id).toBe('my-session');
      expect(agent.goal).toBe('Build a feature');
      expect(agent.sessionKey).toBe('my-session');
      expect(agent.status).toBe('idle');
    });

    it('auto-generates sessionKey when not provided', async () => {
      const { adapter } = makeAdapter();
      const agent = await adapter.createAgent('Do something');
      expect(agent.id).toMatch(/^session-\d+$/);
      expect(agent.sessionKey).toBe(agent.id);
    });

    it('name matches id/sessionKey', async () => {
      const { adapter } = makeAdapter();
      const agent = await adapter.createAgent('Task', 'custom-key');
      expect(agent.name).toBe('custom-key');
    });
  });

  describe('_sessionToAgent field mapping', () => {
    it('id and sessionKey both equal session.key', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents[0].id).toBe('main');
      expect(agents[0].sessionKey).toBe('main');
    });

    it('lastActivityAt comes from session.lastActiveAt', async () => {
      const lastActiveAt = Date.now() - 60_000;
      const sessionsList = vi.fn().mockResolvedValue({
        sessions: [
          {
            key: 'main',
            agentId: 'agent1',
            createdAt: 1000,
            lastActiveAt,
          },
        ],
      });
      const { adapter } = makeAdapter({ sessionsList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].lastActivityAt).toBe(lastActiveAt);
    });

    it('createdAt comes from session.createdAt', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents[0].createdAt).toBe(1000);
    });

    it('metrics.startedAt equals session.createdAt', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents[0].metrics.startedAt).toBe(1000);
    });

    it('goal comes from cron job prompt when available', async () => {
      const cronList = vi.fn().mockResolvedValue({
        jobs: [
          {
            id: 'cron-1',
            name: 'Job',
            schedule: '* * * * *',
            prompt: 'My prompt',
            sessionKey: 'main',
            enabled: true,
          },
        ],
      });
      const { adapter } = makeAdapter({ cronList });
      const agents = await adapter.fetchAgents();
      expect(agents[0].goal).toBe('My prompt');
    });

    it('goal is empty string when no cron job', async () => {
      const { adapter } = makeAdapter();
      const agents = await adapter.fetchAgents();
      expect(agents[0].goal).toBe('');
    });
  });
});
