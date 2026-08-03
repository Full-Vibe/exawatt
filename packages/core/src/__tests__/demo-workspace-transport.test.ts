import { describe, expect, it } from 'vitest';
import { FleetManager } from '../state/fleet-manager';
import {
  DemoWorkspaceTransport,
  demoWorkspaceAgent,
  demoWorkspaceProjectCatalog,
} from '../transports/demo-workspace';
import { DEMO_BASE_AGENTS } from '../demo/agents';
import { DEMO_PROJECTS } from '../demo/projects';
import { demoFleetAgents, demoDelegatedRunCount } from '../demo/scale';

describe('DemoWorkspaceTransport (ENG-027 W2)', () => {
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
    expect(
      demoWorkspaceAgent(withChildren).delegation?.children.length
    ).toBe(withChildren.delegated.length);
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
});
