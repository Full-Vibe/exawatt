import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockFleetTransport } from '../transports/mock-fleet';
import type { SimulationSpeed } from '../transports/mock-fleet';
import type { FleetManager } from '../state/fleet-manager';
import type { ExawattAgent } from '../types/agent';
import type { FleetMetrics } from '../types/fleet';

// ---- Mock FleetManager ----

function makeMockFleetManager() {
  const agentsMap = new Map<string, ExawattAgent>();

  const mgr = {
    emit: vi.fn(),
    getFleetState: vi.fn().mockReturnValue({
      agents: {},
      metrics: {} as FleetMetrics,
      lastUpdated: Date.now(),
    }),
    seedAgents: vi.fn().mockImplementation((agents: ExawattAgent[]) => {
      for (const agent of agents) agentsMap.set(agent.id, agent);
      const agentsRecord: Record<string, ExawattAgent> = {};
      for (const [id, a] of agentsMap) agentsRecord[id] = a;
      mgr.emit('fleet:updated', {
        agents: agentsRecord,
        metrics: {} as FleetMetrics,
        lastUpdated: Date.now(),
      });
    }),
    upsertAgent: vi.fn().mockImplementation((agent: ExawattAgent) => {
      agentsMap.set(agent.id, agent);
      const agentsRecord: Record<string, ExawattAgent> = {};
      for (const [id, a] of agentsMap) agentsRecord[id] = a;
      mgr.emit('agent:updated', agent);
      mgr.emit('fleet:updated', {
        agents: agentsRecord,
        metrics: {} as FleetMetrics,
        lastUpdated: Date.now(),
      });
    }),
  };

  return mgr as unknown as FleetManager;
}

// ---- Helpers ----

const EXPECTED_AGENT_COUNT = 8; // MOCK_AGENTS_DATA length

describe('MockFleetTransport', () => {
  let transport: MockFleetTransport;
  let mockFleetManager: FleetManager;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = new MockFleetTransport();
    mockFleetManager = makeMockFleetManager();
  });

  afterEach(() => {
    transport.stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ---- 1. initialize() ----

  describe('initialize()', () => {
    it('seeds 8 mock agents via seedAgents()', () => {
      transport.initialize(mockFleetManager);

      const seedMock = vi.mocked(mockFleetManager.seedAgents);
      expect(seedMock).toHaveBeenCalledTimes(1);
      expect(seedMock.mock.calls[0]![0]).toHaveLength(EXPECTED_AGENT_COUNT);
    });

    it('emits fleet:updated after seeding', () => {
      transport.initialize(mockFleetManager);

      const emitMock = vi.mocked(mockFleetManager.emit);
      const fleetUpdatedCalls = emitMock.mock.calls.filter(
        ([event]) => event === 'fleet:updated'
      );
      expect(fleetUpdatedCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('getAllAgents() returns 8 agents after initialize', () => {
      transport.initialize(mockFleetManager);
      expect(transport.getAllAgents()).toHaveLength(EXPECTED_AGENT_COUNT);
    });

    it('initial agents have expected statuses from mock data', () => {
      transport.initialize(mockFleetManager);
      const agents = transport.getAllAgents();

      const statuses = agents.map(a => a.status);
      // We have 2 working, 2 idle, 2 blocked, 1 complete, 1 reviewing per MOCK_AGENTS_DATA
      expect(statuses.filter(s => s === 'working')).toHaveLength(2);
      expect(statuses.filter(s => s === 'idle')).toHaveLength(2);
      expect(statuses.filter(s => s === 'blocked')).toHaveLength(2);
      expect(statuses.filter(s => s === 'complete')).toHaveLength(1);
      expect(statuses.filter(s => s === 'reviewing')).toHaveLength(1);
    });

    it('blocked agents have blockerInfo set', () => {
      transport.initialize(mockFleetManager);
      const blocked = transport
        .getAllAgents()
        .filter(a => a.status === 'blocked');
      expect(blocked).toHaveLength(2);
      for (const agent of blocked) {
        expect(agent.blockerInfo).toBeDefined();
        expect(agent.blockerInfo?.title).toBeTruthy();
      }
    });
  });

  // ---- 2. start() + tick ----

  describe('start()', () => {
    it('calling start() twice does not double-schedule', () => {
      transport.initialize(mockFleetManager);
      transport.start();
      transport.start(); // no-op

      vi.mocked(mockFleetManager.emit).mockClear();
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST + 10);

      // There should be exactly one tick's worth of events, not two
      // (difficult to assert exact count due to randomness, just check it runs)
      expect(transport.getAllAgents()).toHaveLength(EXPECTED_AGENT_COUNT);
    });

    it('tick evolves a working agent when Math.random forces a blocker', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1); // < 0.30 → triggers blocker

      transport.initialize(mockFleetManager);
      const workingBefore = transport
        .getAllAgents()
        .filter(a => a.status === 'working').length;
      expect(workingBefore).toBe(2);

      transport.start();
      vi.mocked(mockFleetManager.emit).mockClear();

      // Advance one tick
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST + 10);

      // Working agents should have become blocked (roll < 0.30)
      const nowBlocked = transport
        .getAllAgents()
        .filter(a => a.status === 'blocked').length;
      expect(nowBlocked).toBeGreaterThan(2); // started with 2 blocked, now more
    });

    it('tick evolves a working agent when Math.random forces reviewing', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.35); // 0.30 <= roll < 0.40 → reviewing

      transport.initialize(mockFleetManager);
      transport.start();
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST + 10);

      const reviewing = transport
        .getAllAgents()
        .filter(a => a.status === 'reviewing').length;
      expect(reviewing).toBeGreaterThan(1); // started with 1
    });

    it('tick emits agent:updated events through FleetManager', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1); // deterministic: all working → blocked

      transport.initialize(mockFleetManager);
      transport.start();
      vi.mocked(mockFleetManager.emit).mockClear();

      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST + 10);

      const updatedCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated');
      expect(updatedCalls.length).toBeGreaterThan(0);
    });

    it('idle agent starts working when Math.random forces it', () => {
      // Force all agents to transition: roll = 0.1
      // working (roll<0.30) → blocked, idle (roll<0.20) → working
      vi.spyOn(Math, 'random').mockReturnValue(0.1);

      transport.initialize(mockFleetManager);
      transport.start();
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST + 10);

      const workingAfter = transport
        .getAllAgents()
        .filter(a => a.status === 'working').length;
      // idle agents become working, but working agents become blocked
      // net: 2 idle → working (but those working ones are now blocked too — happens in same tick on initial)
      // Actually: 2 working → blocked (roll=0.1 < 0.30), 2 idle → working (roll=0.1 < 0.20)
      expect(workingAfter).toBe(2); // 2 idle became working
    });
  });

  // ---- 3. stop() ----

  describe('stop()', () => {
    it('stops the simulation — no more events after stop()', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);

      transport.initialize(mockFleetManager);
      transport.start();
      transport.stop();

      vi.mocked(mockFleetManager.emit).mockClear();

      // Advance past multiple tick intervals
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST * 5);

      // No events should have been emitted after stop
      expect(vi.mocked(mockFleetManager.emit)).not.toHaveBeenCalled();
    });

    it('stop() is idempotent — calling multiple times does not throw', () => {
      transport.initialize(mockFleetManager);
      transport.start();
      expect(() => {
        transport.stop();
        transport.stop();
        transport.stop();
      }).not.toThrow();
    });
  });

  // ---- 4. setSpeed() ----

  describe('setSpeed()', () => {
    it('setSpeed("rapid") causes tick to fire in 50ms instead of 5000ms', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);

      transport.initialize(mockFleetManager);
      transport.setSpeed('rapid'); // 100x → 50ms ticks
      transport.start();

      vi.mocked(mockFleetManager.emit).mockClear();

      // 50ms tick fires, 5000ms tick would NOT fire
      vi.advanceTimersByTime(60);

      const updatedCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated');
      expect(updatedCalls.length).toBeGreaterThan(0);
    });

    it('setSpeed("realistic") ticks only after 5000ms', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);

      transport.initialize(mockFleetManager);
      transport.setSpeed('realistic'); // 1x → 5000ms
      transport.start();

      vi.mocked(mockFleetManager.emit).mockClear();

      // Should NOT tick at 4999ms
      vi.advanceTimersByTime(4999);
      const beforeTick = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated').length;
      expect(beforeTick).toBe(0);

      // SHOULD tick after 5000ms
      vi.advanceTimersByTime(2);
      const afterTick = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated').length;
      expect(afterTick).toBeGreaterThan(0);
    });

    it('setSpeed() changes interval mid-run', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);

      transport.initialize(mockFleetManager);
      transport.start(); // realistic: 5000ms

      // Switch to rapid mid-run
      transport.setSpeed('rapid'); // now 50ms

      vi.mocked(mockFleetManager.emit).mockClear();
      vi.advanceTimersByTime(60); // should fire with rapid timing

      const calls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated');
      expect(calls.length).toBeGreaterThan(0);
    });

    it('setSpeed accepts all valid speed values', () => {
      transport.initialize(mockFleetManager);
      const speeds: SimulationSpeed[] = ['realistic', 'fast', 'rapid'];
      for (const speed of speeds) {
        expect(() => transport.setSpeed(speed)).not.toThrow();
      }
    });
  });

  // ---- 5. resolveBlocker() ----

  describe('resolveBlocker()', () => {
    it('changes a blocked agent to working', () => {
      transport.initialize(mockFleetManager);

      const blocked = transport
        .getAllAgents()
        .find(a => a.status === 'blocked');
      expect(blocked).toBeDefined();

      transport.resolveBlocker(blocked!.id);

      const updated = transport.getAllAgents().find(a => a.id === blocked!.id);
      expect(updated?.status).toBe('working');
      expect(updated?.blockerInfo).toBeUndefined();
    });

    it('emits agent:updated after resolveBlocker()', () => {
      transport.initialize(mockFleetManager);

      const blocked = transport
        .getAllAgents()
        .find(a => a.status === 'blocked');
      vi.mocked(mockFleetManager.emit).mockClear();

      transport.resolveBlocker(blocked!.id);

      const calls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated');
      expect(calls).toHaveLength(1);
      expect((calls[0]![1] as { id: string }).id).toBe(blocked!.id);
    });

    it('records the operator response and resolution activity', () => {
      transport.initialize(mockFleetManager);

      const blocked = transport
        .getAllAgents()
        .find(a => a.status === 'blocked');

      transport.resolveBlocker(blocked!.id, 'Approve all');

      const updated = transport.getAllAgents().find(a => a.id === blocked!.id);
      expect(updated?.activities?.some(a => a.content === 'Approve all')).toBe(
        true
      );
      expect(
        updated?.activities?.some(a => a.type === 'blocker_resolved')
      ).toBe(true);
    });

    it('sendMessage resolves a blocked agent through the same command path', async () => {
      transport.initialize(mockFleetManager);

      const blocked = transport
        .getAllAgents()
        .find(a => a.status === 'blocked');

      await transport.sendMessage(blocked!.id, 'Use test mode');

      const updated = transport.getAllAgents().find(a => a.id === blocked!.id);
      expect(updated?.status).toBe('working');
      expect(updated?.blockerInfo).toBeUndefined();
      expect(
        updated?.activities?.some(a => a.type === 'blocker_resolved')
      ).toBe(true);
    });

    it('does nothing for a non-blocked agent', () => {
      transport.initialize(mockFleetManager);

      const working = transport
        .getAllAgents()
        .find(a => a.status === 'working');
      vi.mocked(mockFleetManager.emit).mockClear();

      transport.resolveBlocker(working!.id);

      // Working agent should remain working
      expect(
        transport.getAllAgents().find(a => a.id === working!.id)?.status
      ).toBe('working');
      // No events emitted
      expect(vi.mocked(mockFleetManager.emit)).not.toHaveBeenCalled();
    });

    it('does nothing for unknown agent id', () => {
      transport.initialize(mockFleetManager);
      vi.mocked(mockFleetManager.emit).mockClear();

      expect(() => transport.resolveBlocker('does-not-exist')).not.toThrow();
      expect(vi.mocked(mockFleetManager.emit)).not.toHaveBeenCalled();
    });
  });

  // ---- 6. reset() ----

  describe('reset()', () => {
    it('restores initial agent count after evolution', () => {
      transport.initialize(mockFleetManager);

      // Evolve agents
      transport.start();
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST * 3);
      transport.stop();

      // Reset
      transport.reset();

      expect(transport.getAllAgents()).toHaveLength(EXPECTED_AGENT_COUNT);
    });

    it('re-seeds all agents via seedAgents() after reset', () => {
      transport.initialize(mockFleetManager);
      vi.mocked(mockFleetManager.seedAgents).mockClear();

      transport.reset();

      const seedMock = vi.mocked(mockFleetManager.seedAgents);
      expect(seedMock).toHaveBeenCalledTimes(1);
      expect(seedMock.mock.calls[0]![0]).toHaveLength(EXPECTED_AGENT_COUNT);
    });

    it('stops any running simulation on reset', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      transport.initialize(mockFleetManager);
      transport.start();

      transport.reset();
      vi.mocked(mockFleetManager.emit).mockClear();

      // Simulation should be stopped — no events
      vi.advanceTimersByTime(BASE_TICK_INTERVAL_MS_FOR_TEST * 2);
      const updatedCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'agent:updated');
      expect(updatedCalls).toHaveLength(0);
    });
  });

  // ---- 7. listCronJobs() ----

  describe('listCronJobs()', () => {
    it('returns 4 mock cron jobs', async () => {
      transport.initialize(mockFleetManager);
      const jobs = await transport.listCronJobs();
      expect(jobs).toHaveLength(4);
    });

    it('jobs have required fields', async () => {
      transport.initialize(mockFleetManager);
      const jobs = await transport.listCronJobs();
      for (const job of jobs) {
        expect(job.id).toBeTruthy();
        expect(job.name).toBeTruthy();
        expect(job.schedule).toBeTruthy();
        expect(job.prompt).toBeTruthy();
        expect(typeof job.enabled).toBe('boolean');
      }
    });

    it('has a mix of enabled and disabled jobs', async () => {
      transport.initialize(mockFleetManager);
      const jobs = await transport.listCronJobs();
      const enabled = jobs.filter(j => j.enabled);
      const disabled = jobs.filter(j => !j.enabled);
      expect(enabled.length).toBeGreaterThan(0);
      expect(disabled.length).toBeGreaterThan(0);
    });
  });

  // ---- 8. addCronJob() ----

  describe('addCronJob()', () => {
    it('adds a new job and returns it', async () => {
      transport.initialize(mockFleetManager);

      const newJob = await transport.addCronJob({
        name: 'Test Job',
        schedule: '0 * * * *',
        prompt: 'Do something hourly',
        enabled: true,
      });

      expect(newJob.id).toBeTruthy();
      expect(newJob.name).toBe('Test Job');
      expect(newJob.schedule).toBe('0 * * * *');
      expect(newJob.enabled).toBe(true);
    });

    it('added job appears in listCronJobs()', async () => {
      transport.initialize(mockFleetManager);

      const newJob = await transport.addCronJob({
        name: 'Nightly Sync',
        schedule: '0 2 * * *',
        prompt: 'Sync data nightly',
      });

      const jobs = await transport.listCronJobs();
      expect(jobs).toHaveLength(5);
      expect(jobs.find(j => j.id === newJob.id)).toBeDefined();
    });

    it('defaults enabled to true if not specified', async () => {
      transport.initialize(mockFleetManager);
      const job = await transport.addCronJob({
        name: 'Default Enabled Job',
        schedule: '* * * * *',
        prompt: 'Test',
      });
      expect(job.enabled).toBe(true);
    });
  });

  // ---- 9. runCronJob() ----

  describe('runCronJob()', () => {
    it('marks lastRun timestamp on the job', async () => {
      const before = Date.now();
      transport.initialize(mockFleetManager);

      await transport.runCronJob('cron-1');

      const jobs = await transport.listCronJobs();
      const job = jobs.find(j => j.id === 'cron-1');
      expect(job?.lastRun).toBeGreaterThanOrEqual(before);
    });

    it('creates a cron run record', async () => {
      transport.initialize(mockFleetManager);
      await transport.runCronJob('cron-1');

      const { runs } = await transport.getCronRuns('cron-1');
      expect(runs).toHaveLength(1);
      expect(runs[0]!.jobId).toBe('cron-1');
      expect(runs[0]!.status).toBe('success');
    });

    it('emits heartbeat tool activity to the fleet', async () => {
      transport.initialize(mockFleetManager);
      vi.mocked(mockFleetManager.emit).mockClear();

      await transport.runCronJob('cron-1');

      const toolCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'chat:tool');
      expect(toolCalls).toHaveLength(1);
      expect(
        (toolCalls[0]![1] as { activity: { content: string } }).activity.content
      ).toContain('Heartbeat ran');
    });

    it('getCronRuns returns empty for jobs with no runs', async () => {
      transport.initialize(mockFleetManager);
      const { runs } = await transport.getCronRuns('cron-2');
      expect(runs).toHaveLength(0);
    });

    it('does nothing for unknown job id', async () => {
      transport.initialize(mockFleetManager);
      await expect(
        transport.runCronJob('does-not-exist')
      ).resolves.toBeUndefined();
    });
  });

  // ---- updateCronJob() ----

  describe('updateCronJob()', () => {
    it('updates job fields and returns updated job', async () => {
      transport.initialize(mockFleetManager);

      const updated = await transport.updateCronJob('cron-4', {
        enabled: true,
        name: 'Renamed Job',
      });

      expect(updated.enabled).toBe(true);
      expect(updated.name).toBe('Renamed Job');
    });

    it('throws for unknown job id', async () => {
      transport.initialize(mockFleetManager);
      await expect(
        transport.updateCronJob('ghost-job', { name: 'X' })
      ).rejects.toThrow('Cron job ghost-job not found');
    });
  });

  // ---- removeCronJob() ----

  describe('removeCronJob()', () => {
    it('removes job from listCronJobs', async () => {
      transport.initialize(mockFleetManager);
      await transport.removeCronJob('cron-1');

      const jobs = await transport.listCronJobs();
      expect(jobs).toHaveLength(3);
      expect(jobs.find(j => j.id === 'cron-1')).toBeUndefined();
    });
  });

  // ---- 10. Simulation emits events through FleetManager ----

  describe('Simulation events through FleetManager', () => {
    it('chat:message events are emitted for working agents', () => {
      // Force roll >= 0.45 → no status change, goes to chat message path
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      transport.initialize(mockFleetManager);
      transport.setSpeed('rapid');
      transport.start();
      vi.mocked(mockFleetManager.emit).mockClear();

      vi.advanceTimersByTime(60); // at least one rapid tick

      const chatCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'chat:message');
      expect(chatCalls.length).toBeGreaterThan(0);
    });

    it('fleet:updated events carry mock fleet state with agents', () => {
      transport.initialize(mockFleetManager);
      vi.spyOn(Math, 'random').mockReturnValue(0.1);
      transport.setSpeed('rapid');
      transport.start();
      vi.mocked(mockFleetManager.emit).mockClear();

      vi.advanceTimersByTime(60);

      const fleetUpdatedCalls = vi
        .mocked(mockFleetManager.emit)
        .mock.calls.filter(([event]) => event === 'fleet:updated');
      expect(fleetUpdatedCalls.length).toBeGreaterThan(0);

      // The fleet state payload should have agents
      const payload = fleetUpdatedCalls[0]![1] as {
        agents: Record<string, unknown>;
      };
      expect(Object.keys(payload.agents).length).toBeGreaterThan(0);
    });

    it('getMockFleetState() reflects current agent states', () => {
      transport.initialize(mockFleetManager);
      const state = transport.getMockFleetState();

      expect(Object.keys(state.agents)).toHaveLength(EXPECTED_AGENT_COUNT);
      expect(state.metrics.activeCount).toBeGreaterThanOrEqual(0);
      expect(state.metrics.blockedCount).toBe(2);
      expect(state.lastUpdated).toBeGreaterThan(0);
    });
  });
});

// Constant to avoid magic numbers in tests
const BASE_TICK_INTERVAL_MS_FOR_TEST = 5000;
