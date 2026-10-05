import { describe, expect, it, vi } from 'vitest';
import { FleetManager } from '../state/fleet-manager';
import {
  DemoWorkspaceTransport,
  demoWorkspaceAgent,
  demoWorkspaceProjectCatalog,
} from '../transports/demo-workspace';
import { DEMO_BASE_AGENTS } from '../demo/agents';
import { DEMO_PROJECTS } from '../demo/projects';
import { demoFleetAgents, demoDelegatedRunCount } from '../demo/scale';
import { DemoFleetSimulation } from '../demo/simulation';

describe('DemoWorkspaceTransport (ENG-027 W2)', () => {
  it('marks a working Session unread without fabricating a source request or result', () => {
    const manager = new FleetManager();
    const transport = new DemoWorkspaceTransport({ tier: 'base' });
    transport.initialize(manager);
    transport.start();
    const working = Object.values(manager.getFleetState().agents).find(
      agent => agent.status === 'working' && !agent.attention
    )!;
    transport.markUnread(working.id);
    expect(manager.getAgent(working.id)).toMatchObject({
      status: 'working',
      attention: { kind: 'reminder', unread: true },
    });
    transport.focus(working.id);
    expect(manager.getAgent(working.id)).toMatchObject({
      status: 'working',
      attention: { unread: false },
    });
    transport.stop();
  });

  it('keeps source-owned read receipts across consumers without resolving requests', () => {
    const manager = new FleetManager();
    const transport = new DemoWorkspaceTransport({ tier: 'base' });
    transport.initialize(manager);
    transport.start();
    const request = Object.values(manager.getFleetState().agents).find(
      agent => agent.attention?.kind === 'blocked'
    )!;
    const result = Object.values(manager.getFleetState().agents).find(
      agent => agent.attention?.kind === 'turn-end'
    )!;
    const updated = vi.fn();
    manager.on('fleet:updated', updated);
    transport.focus(request.id);
    expect(manager.getAgent(request.id)?.status).toBe(request.status);
    expect(manager.getAgent(request.id)?.attention).toMatchObject({
      unread: false,
      kind: 'blocked',
    });
    transport.focus(request.id);
    expect(updated).toHaveBeenCalledTimes(1);
    transport.markUnread(request.id);
    transport.focus(null);
    expect(manager.getAgent(request.id)?.attention?.unread).toBe(true);
    transport.focus(result.id);
    expect(manager.getAgent(result.id)?.attention).toMatchObject({
      unread: false,
      kind: 'turn-end',
    });
    expect(manager.getAgent(result.id)?.status).toBe(result.status);
    transport.stop();
    updated.mockClear();
    transport.focus(request.id);
    transport.markUnread(result.id);
    expect(updated).not.toHaveBeenCalled();
  });

  it('populates the FleetManager with the full scale tier', () => {
    const manager = new FleetManager();
    const transport = new DemoWorkspaceTransport({ nowMs: Date.now() });
    transport.initialize(manager);
    transport.start();

    const state = manager.getFleetState();
    const agents = Object.values(state.agents);
    expect(agents.length).toBe(demoFleetAgents('scale').length);
    // the honest board-entity claim: agents plus delegated runs ≈ 209
    const boardEntities =
      agents.length +
      agents.reduce((n, a) => n + (a.delegation?.children.length ?? 0), 0);
    expect(boardEntities).toBe(
      demoFleetAgents('scale').length + demoDelegatedRunCount('scale')
    );
    transport.stop();
  });

  it('stop() removes every demo agent so no demo entity leaks into another tenant', () => {
    const manager = new FleetManager();
    const transport = new DemoWorkspaceTransport({ tier: 'base' });
    transport.initialize(manager);
    transport.start();
    expect(Object.keys(manager.getFleetState().agents).length).toBe(
      DEMO_BASE_AGENTS.length
    );
    transport.stop();
    expect(Object.keys(manager.getFleetState().agents).length).toBe(0);
  });

  it('rebases timestamps to the provided now', () => {
    const nowMs = Date.now();
    const manager = new FleetManager();
    const transport = new DemoWorkspaceTransport({ tier: 'base', nowMs });
    transport.initialize(manager);
    transport.start();
    for (const agent of Object.values(manager.getFleetState().agents)) {
      expect(agent.lastActivityAt).toBeLessThanOrEqual(nowMs);
      // the base fleet is recent work: nothing reads older than ~30 days
      expect(nowMs - agent.createdAt).toBeLessThan(35 * 24 * 3600_000);
    }
    transport.stop();
  });

  it('maps fixture fields into the live ExawattAgent contract', () => {
    const source = demoFleetAgents('base')[0];
    const agent = demoWorkspaceAgent(source);
    expect(agent.id).toBe(source.id);
    expect(agent.goal).toBe(source.contextLabel);
    expect(agent.projectId).toBe(source.projectKey);
    expect(agent.status).toBe(source.status);
    expect(agent.sessionState).toBe('live');
    // no invented spend: dollars stay 0 exactly like the live local path
    expect(agent.metrics.estimatedCost).toBe(0);
    expect(agent.metrics.costRate).toBe(0);
    expect(agent.metrics.turnCount).toBe(source.turns);
  });

  it('delegation is present only when children exist (absence, never empty)', () => {
    const withChildren = DEMO_BASE_AGENTS.find(a => a.delegated.length > 0)!;
    const withoutChildren = DEMO_BASE_AGENTS.find(
      a => a.delegated.length === 0
    )!;
    expect(demoWorkspaceAgent(withChildren).delegation?.children.length).toBe(
      withChildren.delegated.length
    );
    expect('delegation' in demoWorkspaceAgent(withoutChildren)).toBe(false);
  });

  it('blockers survive the mapping with their type and copy', () => {
    const blocked = DEMO_BASE_AGENTS.find(a => a.blocker)!;
    const mapped = demoWorkspaceAgent(blocked);
    expect(mapped.blockerInfo?.type).toBe(blocked.blocker!.type);
    expect(mapped.blockerInfo?.title).toBe(blocked.blocker!.title);
  });

  it('exposes the demo Project catalog in the live catalog shape', () => {
    const catalog = demoWorkspaceProjectCatalog();
    expect(catalog.length).toBe(DEMO_PROJECTS.length);
    expect(catalog[0]).toEqual({
      id: DEMO_PROJECTS[0].key,
      label: DEMO_PROJECTS[0].name,
      color: DEMO_PROJECTS[0].color,
    });
  });

  describe('the tick (ENG-027 W14)', () => {
    const START = Date.parse('2026-10-07T16:00:00.000Z');

    /** A transport whose clock the test drives; no timer, no waiting. */
    function driven(tier: 'base' | 'scale' = 'scale') {
      const clock = { now: START };
      const manager = new FleetManager();
      const transport = new DemoWorkspaceTransport({
        tier,
        nowMs: START,
        clock: () => clock.now,
        tickMs: 0,
      });
      transport.initialize(manager);
      transport.start();
      return { clock, manager, transport };
    }

    it('starts on frame zero and reflects the simulation frame after each tick', () => {
      const { clock, manager, transport } = driven();
      const expected = new DemoFleetSimulation(
        demoFleetAgents('scale', { nowMs: START }),
        { startedAtMs: START }
      );
      expect(transport.frame()?.elapsedMs).toBe(0);
      for (const elapsed of [2_000, 45_000, 180_000, 420_000]) {
        clock.now = START + elapsed;
        const frame = transport.tick();
        const truth = expected.frameAt(elapsed);
        expect(frame?.elapsedMs).toBe(elapsed);
        for (const agent of truth.agents) {
          const live = manager.getAgent(agent.id)!;
          expect(live.status).toBe(agent.status);
          expect(live.lastActivityAt).toBe(agent.lastActivityAtMs);
          expect(live.metrics.turnCount).toBe(agent.turns);
          expect((live.delegation?.children ?? []).map(c => c.id)).toEqual(
            agent.delegated.map(run => run.agentId)
          );
        }
        expect(frame?.landings).toEqual(truth.landings);
      }
      // the fleet is the same set of Agents the whole way: nothing launched
      expect(Object.keys(manager.getFleetState().agents).length).toBe(
        demoFleetAgents('scale').length
      );
      transport.stop();
    });

    it('re-maps only Agents whose facts moved, so read receipts survive the tick', () => {
      const { clock, manager, transport } = driven();
      const updated = vi.fn();
      // a request the operator already read
      const request = Object.values(manager.getFleetState().agents).find(
        agent => agent.attention?.kind === 'blocked'
      )!;
      transport.focus(request.id);
      expect(manager.getAgent(request.id)?.attention?.unread).toBe(false);
      manager.on('fleet:updated', updated);
      clock.now = START + 2_000;
      transport.tick();
      // blocked rows dwell for minutes: this one did not move, and was not re-mapped
      expect(manager.getAgent(request.id)?.status).toBe('blocked');
      expect(manager.getAgent(request.id)?.attention?.unread).toBe(false);
      const moved = transport.frame()!.transitions;
      expect(moved).toBeGreaterThan(0);
      expect(updated.mock.calls.length).toBeLessThanOrEqual(moved);
      transport.stop();
    });

    it('raises a NEW result or request unread, and clears a superseded one', () => {
      const { clock, manager, transport } = driven();
      const sim = new DemoFleetSimulation(
        demoFleetAgents('scale', { nowMs: START }),
        { startedAtMs: START }
      );
      // find the first moment some Agent becomes `complete` from another state
      let newlyComplete: string | null = null;
      let at = 0;
      const before = new Map(sim.frameAt(0).agents.map(a => [a.id, a.status]));
      for (let t = 1_000; t <= 600_000 && !newlyComplete; t += 1_000) {
        for (const agent of sim.frameAt(t).agents) {
          if (agent.status === 'complete' && before.get(agent.id) !== 'complete') {
            newlyComplete = agent.id;
            at = t;
            break;
          }
        }
      }
      expect(newlyComplete).not.toBeNull();
      clock.now = START + at;
      transport.tick();
      expect(manager.getAgent(newlyComplete!)?.attention).toMatchObject({
        kind: 'turn-end',
        unread: true,
      });
      transport.focus(newlyComplete!);
      expect(manager.getAgent(newlyComplete!)?.attention?.unread).toBe(false);
      // later the same Agent moves on: the read result is cleared, not kept
      let later = at;
      for (let t = at + 1_000; t <= at + 600_000; t += 1_000) {
        if (sim.frameAt(t).agents.find(a => a.id === newlyComplete)!.status !== 'complete') {
          later = t;
          break;
        }
      }
      expect(later).toBeGreaterThan(at);
      clock.now = START + later;
      transport.tick();
      expect(manager.getAgent(newlyComplete!)?.status).not.toBe('complete');
      expect(manager.getAgent(newlyComplete!)?.attention ?? null).toBeNull();
      transport.stop();
    });

    it('publishes a frame to listeners only when something moved, and stops cleanly', () => {
      const { clock, manager, transport } = driven('base');
      const frames = vi.fn();
      const off = transport.onFrame(frames);
      clock.now = START + 200;
      transport.tick();
      expect(frames).not.toHaveBeenCalled();
      clock.now = START + 240_000;
      transport.tick();
      expect(frames).toHaveBeenCalledTimes(1);
      off();
      clock.now = START + 480_000;
      transport.tick();
      expect(frames).toHaveBeenCalledTimes(1);
      transport.stop();
      expect(transport.frame()).toBeNull();
      expect(transport.tick()).toBeNull();
      expect(Object.keys(manager.getFleetState().agents).length).toBe(0);
    });

    it('lands on the same seed after a reset: stop + start replays the fixture', () => {
      const { clock, manager, transport } = driven('base');
      clock.now = START + 300_000;
      transport.tick();
      const moved = Object.values(manager.getFleetState().agents).map(a => a.status);
      transport.stop();
      transport.start();
      const reset = Object.values(manager.getFleetState().agents).map(a => a.status);
      expect(reset).toEqual(demoFleetAgents('base').map(a => a.status));
      expect(reset).not.toEqual(moved);
      transport.stop();
    });
  });
});
