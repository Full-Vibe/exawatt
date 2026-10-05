/**
 * The Demo fleet tick (ENG-027 W14): contract tests.
 *
 * These assert the properties a demo cannot be allowed to lose — the fixture
 * at t=0, determinism in `(seed, elapsed)`, cadence bounds, authored-only
 * needs-you, source-honest delegation, landings on real open milestones, and
 * that nothing is ever launched — never today's appearance. Every test drives
 * the simulation clock directly; none waits.
 */
import { describe, expect, it } from 'vitest';
import { parseRoadmap } from '../roadmap/parse';
import { DEMO_PROJECTS_BY_KEY } from '../demo/projects';
import {
  DEMO_ROADMAP_MARKDOWN,
  demoOpenMilestones,
  demoProjectRoadmap,
  demoRoadmapMarkdownWithLandings,
} from '../demo/roadmaps';
import { DEMO_DELEGATION_OBSERVING_HARNESSES, demoFleetAgents } from '../demo/scale';
import {
  DEMO_LANDING_CADENCE_MS,
  DEMO_SIMULATION_SEED,
  DEMO_TICK_CADENCE_MS,
  INITIAL_ATTENTION_HOLD_MS,
  DemoFleetSimulation,
  demoLandingStateAt,
  type DemoFleetFrame,
} from '../demo/simulation';
import type { DemoFleetAgent } from '../demo/types';

const START_MS = Date.parse('2026-10-07T16:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;

function fixture(tier: 'base' | 'scale' = 'scale'): DemoFleetAgent[] {
  return demoFleetAgents(tier, { nowMs: START_MS });
}

function simulation(seed = DEMO_SIMULATION_SEED, tier: 'base' | 'scale' = 'scale') {
  return new DemoFleetSimulation(fixture(tier), { seed, startedAtMs: START_MS });
}

/** Sample the fleet every `stepMs` and return every frame. */
function sweep(
  sim: DemoFleetSimulation,
  untilMs: number,
  stepMs: number
): DemoFleetFrame[] {
  const frames: DemoFleetFrame[] = [];
  for (let t = 0; t <= untilMs; t += stepMs) frames.push(sim.frameAt(t));
  return frames;
}

describe('frame zero is the fixture', () => {
  it('returns the authored Agents untouched at t=0', () => {
    const agents = fixture();
    const frame = new DemoFleetSimulation(agents, { startedAtMs: START_MS }).frameAt(0);
    expect(frame.agents).toEqual(agents);
    expect(frame.landings).toEqual([]);
    expect(frame.transitions).toBe(0);
    expect(frame.nowMs).toBe(START_MS);
  });

  it('never adds or removes an Agent — Demo launches nothing', () => {
    const ids = fixture().map(agent => agent.id);
    for (const frame of sweep(simulation(), 20 * MINUTE, 30 * SECOND)) {
      expect(frame.agents.map(agent => agent.id)).toEqual(ids);
    }
  });
});

describe('determinism in (seed, elapsed time)', () => {
  it('two independent simulations agree frame for frame', () => {
    const a = simulation();
    const b = simulation();
    for (const t of [0, 1500, 20 * SECOND, 90 * SECOND, 6 * MINUTE, 15 * MINUTE]) {
      expect(a.frameAt(t)).toEqual(b.frameAt(t));
    }
  });

  it('the frame at t does not depend on which frames were asked for first', () => {
    const stepped = simulation();
    for (let t = 0; t <= 8 * MINUTE; t += 7 * SECOND) stepped.frameAt(t);
    const direct = simulation();
    expect(stepped.frameAt(8 * MINUTE)).toEqual(direct.frameAt(8 * MINUTE));
    // and going back in time is answered from the fixture, not from memory
    expect(stepped.frameAt(90 * SECOND)).toEqual(simulation().frameAt(90 * SECOND));
  });

  it('a different seed is a different demo', () => {
    const t = 5 * MINUTE;
    expect(simulation('other-seed').frameAt(t).agents).not.toEqual(
      simulation().frameAt(t).agents
    );
  });
});

describe('cadence', () => {
  it('shows movement within two seconds of the switch, with the default seed', () => {
    const frame = simulation().frameAt(2 * SECOND);
    expect(frame.transitions).toBeGreaterThanOrEqual(1);
  });

  it('keeps every dwell inside the declared bounds and never flips at t=0', () => {
    const sim = simulation();
    const frames = sweep(sim, 12 * MINUTE, SECOND);
    const byAgent = new Map<string, Array<{ status: string; at: number }>>();
    for (const frame of frames) {
      for (const agent of frame.agents) {
        const runs = byAgent.get(agent.id) ?? [];
        const last = runs[runs.length - 1];
        if (!last || last.status !== agent.status) {
          runs.push({ status: agent.status, at: frame.elapsedMs });
        }
        byAgent.set(agent.id, runs);
      }
    }
    const first = fixture();
    for (const agent of first) {
      const runs = byAgent.get(agent.id)!;
      expect(runs[0]!.status).toBe(agent.status);
      expect(runs[0]!.at).toBe(0);
      // interior dwells (not the stationary first, not the unfinished last)
      for (let i = 1; i < runs.length - 1; i++) {
        const dwell = runs[i + 1]!.at - runs[i]!.at;
        const bounds = DEMO_TICK_CADENCE_MS[runs[i]!.status as keyof typeof DEMO_TICK_CADENCE_MS];
        expect(dwell).toBeGreaterThanOrEqual(bounds.min);
        expect(dwell).toBeLessThanOrEqual(bounds.max);
      }
      if (runs.length > 1) expect(runs[1]!.at).toBeGreaterThanOrEqual(SECOND);
    }
  });

  it('moves the fleet at a rate a person can see and a board can follow', () => {
    const sim = simulation();
    const transitions = sim.frameAt(5 * MINUTE).transitions;
    const perSecond = transitions / (5 * 60);
    expect(perSecond).toBeGreaterThan(0.5);
    expect(perSecond).toBeLessThan(6);
  });

  it('keeps every status on screen over a demo window', () => {
    const seen = new Set<string>();
    for (const frame of sweep(simulation(), 6 * MINUTE, 15 * SECOND)) {
      for (const agent of frame.agents) seen.add(agent.status);
    }
    expect([...seen].sort()).toEqual(
      ['blocked', 'complete', 'error', 'idle', 'reviewing', 'working'].sort()
    );
  });
});

describe('authored truth survives the tick', () => {
  it('only an Agent with an authored blocker is ever blocked, always carrying it', () => {
    const authored = new Map(fixture().map(agent => [agent.id, agent.blocker]));
    for (const frame of sweep(simulation(), 15 * MINUTE, 10 * SECOND)) {
      for (const agent of frame.agents) {
        if (agent.status === 'blocked') {
          const written = authored.get(agent.id);
          expect(written).toBeDefined();
          expect(agent.blocker?.title).toBe(written!.title);
          expect(agent.blocker?.createdAtMs).toBeLessThanOrEqual(frame.nowMs);
        } else {
          expect(agent.blocker).toBeUndefined();
        }
        if (agent.status === 'error') expect(agent.faultNote).toBeTruthy();
        else expect(agent.faultNote).toBeUndefined();
      }
    }
  });

  it('holds every request and result shown at the switch until the operator could act', () => {
    const sim = simulation();
    const shown = fixture().filter(
      agent => agent.status === 'blocked' || agent.status === 'complete'
    );
    expect(shown.length).toBeGreaterThan(20);
    const held = sim.frameAt(INITIAL_ATTENTION_HOLD_MS - SECOND);
    for (const agent of shown) {
      const now = held.agents.find(candidate => candidate.id === agent.id)!;
      expect(now.status).toBe(agent.status);
      expect(now.blocker?.createdAtMs).toBe(agent.blocker?.createdAtMs);
      expect(now.lastActivityAtMs).toBe(agent.lastActivityAtMs);
    }
  });

  it('needs-you rows stay populated across the whole demo window', () => {
    for (const frame of sweep(simulation(), 10 * MINUTE, 30 * SECOND)) {
      const blocked = frame.agents.filter(agent => agent.status === 'blocked');
      expect(blocked.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('children spawn and finish, only under a harness that observes delegation', () => {
    const start = fixture();
    const canDelegate = new Set(
      start
        .filter(
          agent =>
            agent.source === 'claude-code' &&
            DEMO_DELEGATION_OBSERVING_HARNESSES.includes(agent.harness)
        )
        .map(agent => agent.id)
    );
    const initial = new Map(
      start.map(agent => [agent.id, new Set(agent.delegated.map(run => run.agentId))])
    );
    let spawned = 0;
    let finished = 0;
    const live = new Map<string, Set<string>>();
    for (const frame of sweep(simulation(), 12 * MINUTE, 5 * SECOND)) {
      for (const agent of frame.agents) {
        const ids = new Set(agent.delegated.map(run => run.agentId));
        if (ids.size > 0) {
          expect(canDelegate.has(agent.id)).toBe(true);
          expect(agent.source).toBe('claude-code');
          // a child never outlives the parent's turn
          expect(['working', 'reviewing']).toContain(agent.status);
          for (const run of agent.delegated) {
            expect(run.startedAtMs).toBeLessThanOrEqual(frame.nowMs);
            expect(run.task.length).toBeGreaterThan(0);
          }
        }
        const before = live.get(agent.id) ?? initial.get(agent.id)!;
        for (const id of ids) if (!before.has(id)) spawned += 1;
        for (const id of before) if (!ids.has(id)) finished += 1;
        live.set(agent.id, ids);
      }
    }
    expect(spawned).toBeGreaterThan(0);
    expect(finished).toBeGreaterThan(0);
  });

  it('consumption advances with turns and never runs backwards', () => {
    const sim = simulation();
    const previous = new Map(
      fixture().map(agent => [agent.id, { turns: agent.turns, output: agent.usage.output }])
    );
    let advanced = 0;
    for (const frame of sweep(sim, 10 * MINUTE, 20 * SECOND)) {
      for (const agent of frame.agents) {
        const last = previous.get(agent.id)!;
        expect(agent.turns).toBeGreaterThanOrEqual(last.turns);
        expect(agent.usage.output).toBeGreaterThanOrEqual(last.output);
        if (agent.turns > last.turns) {
          advanced += 1;
          expect(agent.usage.output).toBeGreaterThan(last.output);
        }
        previous.set(agent.id, { turns: agent.turns, output: agent.usage.output });
      }
    }
    expect(advanced).toBeGreaterThan(0);
  });

  it('timestamps stay coherent: nothing acts in the future, children after parent start', () => {
    for (const frame of sweep(simulation(), 10 * MINUTE, 30 * SECOND)) {
      for (const agent of frame.agents) {
        expect(agent.lastActivityAtMs).toBeLessThanOrEqual(frame.nowMs);
        expect(agent.lastActivityAtMs).toBeGreaterThanOrEqual(agent.startedAtMs);
        for (const run of agent.delegated) {
          expect(run.startedAtMs).toBeGreaterThanOrEqual(agent.startedAtMs);
        }
      }
    }
  });
});

describe('landings', () => {
  it('arrive inside one demo beat and land on the real open milestone of the Agent’s item', () => {
    const sim = simulation();
    const early = sim.frameAt(90 * SECOND);
    expect(early.landings.length).toBeGreaterThanOrEqual(1);
    const frame = sim.frameAt(10 * MINUTE);
    expect(frame.landings.some(landing => landing.state === 'landed')).toBe(true);
    const agents = new Map(fixture().map(agent => [agent.id, agent]));
    const claimed = new Set<string>();
    for (const landing of frame.landings) {
      const agent = agents.get(landing.agentId)!;
      expect(agent.roadmapItemId).toBe(landing.roadmapItemId);
      expect(agent.projectKey).toBe(landing.projectKey);
      // only live-readiness coding Projects land code
      expect(DEMO_PROJECTS_BY_KEY.get(landing.projectKey)?.readiness).toBe('live');
      const open = demoOpenMilestones(landing.projectKey, landing.roadmapItemId);
      expect(open.map(m => m.id ?? m.title)).toContain(
        landing.milestoneId ?? landing.milestoneTitle
      );
      const key = `${landing.projectKey}:${landing.roadmapItemId}:${landing.milestoneId ?? landing.milestoneTitle}`;
      expect(claimed.has(key)).toBe(false);
      claimed.add(key);
      expect(landing.sha).toMatch(/^[0-9a-f]{7}$/);
      expect(landing.queuedAt).toBe(START_MS + landing.queuedAtMs);
    }
    // queued oldest first, positions dense from 1 for the ones still in flight
    const inFlight = frame.landings.filter(landing => landing.state !== 'landed');
    expect(inFlight.map(landing => landing.queuePosition)).toEqual(
      inFlight.map((_, index) => index + 1)
    );
  });

  it('move through the delivery states in order and never backwards', () => {
    const sim = simulation();
    const order = ['queued', 'checking', 'integrating', 'landed'];
    const lastState = new Map<string, number>();
    for (const frame of sweep(sim, 10 * MINUTE, 2 * SECOND)) {
      for (const landing of frame.landings) {
        const rank = order.indexOf(landing.state);
        expect(rank).toBeGreaterThanOrEqual(lastState.get(landing.id) ?? 0);
        lastState.set(landing.id, rank);
        expect(demoLandingStateAt(landing, frame.elapsedMs)).toBe(landing.state);
        if (landing.state === 'landed') {
          expect(landing.landedAt).toBe(landing.queuedAt + DEMO_LANDING_CADENCE_MS.landed);
        } else {
          expect(landing.landedAt).toBeNull();
        }
      }
    }
    expect([...lastState.values()]).toContain(order.length - 1);
  });

  it('write into the Project roadmap as a convention-conformant landed milestone', () => {
    const frame = simulation().frameAt(10 * MINUTE);
    const landed = frame.landings.filter(landing => landing.state === 'landed');
    expect(landed.length).toBeGreaterThan(0);
    const byProject = new Map<string, typeof landed>();
    for (const landing of landed) {
      byProject.set(landing.projectKey, [...(byProject.get(landing.projectKey) ?? []), landing]);
    }
    for (const [projectKey, landings] of byProject) {
      const markdown = demoRoadmapMarkdownWithLandings(
        projectKey,
        landings.map(landing => ({
          roadmapItemId: landing.roadmapItemId,
          milestoneId: landing.milestoneId,
          milestoneTitle: landing.milestoneTitle,
          landedAtMs: landing.landedAt!,
          sha: landing.sha,
        }))
      );
      expect(markdown).not.toBe(DEMO_ROADMAP_MARKDOWN[projectKey]);
      const project = DEMO_PROJECTS_BY_KEY.get(projectKey)!;
      const doc = parseRoadmap(markdown, { projectDir: project.dir, file: 'ROADMAP.md', now: () => 0 });
      expect(doc.diagnostics.filter(d => d.level === 'warn')).toEqual([]);
      const before = demoProjectRoadmap(projectKey);
      for (const landing of landings) {
        const item = doc.items.find(i => i.declaredId === landing.roadmapItemId)!;
        const milestone = item.milestones.find(
          m => (landing.milestoneId ? m.id === landing.milestoneId : m.title.startsWith(landing.milestoneTitle))
        )!;
        expect(milestone.done).toBe(true);
        expect(milestone.title).toContain(landing.sha);
        const was = before.items
          .find(i => i.declaredId === landing.roadmapItemId)!
          .milestones.filter(m => m.done).length;
        expect(item.milestones.filter(m => m.done).length).toBeGreaterThan(was);
      }
      // every other item is byte-identical to the fixture
      for (const item of before.items) {
        if (landings.some(l => l.roadmapItemId === item.declaredId)) continue;
        expect(doc.items.find(i => i.id === item.id)?.milestones).toEqual(item.milestones);
      }
    }
  });

  it('leave the roadmap untouched when nothing landed', () => {
    for (const key of Object.keys(DEMO_ROADMAP_MARKDOWN)) {
      expect(demoRoadmapMarkdownWithLandings(key, [])).toBe(DEMO_ROADMAP_MARKDOWN[key]);
    }
  });
});

describe('the base tier ticks too', () => {
  it('moves the 27 authored Agents on the same contract', () => {
    const sim = simulation(DEMO_SIMULATION_SEED, 'base');
    const frame = sim.frameAt(4 * MINUTE);
    expect(frame.agents.length).toBe(fixture('base').length);
    expect(frame.transitions).toBeGreaterThan(0);
  });
});
