import { describe, expect, it } from 'vitest';
import {
  DEMO_LANDING_CADENCE_MS,
  DEMO_PROJECTS,
  DEMO_SIMULATION_SEED,
  DemoFleetSimulation,
  demoFleetAgents,
  type DemoFleetFrame,
  type DemoLandingView,
} from '@exawatt/core';
import { buildRoadmapLens, type RoadmapLensView } from '@exawatt/ui-model';
import {
  demoDeliveryRead,
  demoLandedMilestones,
  demoRoadmapDoc,
  demoShellGoalVisuals,
  demoPaneContent,
  demoShellAgents,
  demoShellAgentTypes,
  demoShellInitiatives,
  demoShellFleetAgentById,
} from './model';

describe('demoShellAgentTypes (ENG-028 T1)', () => {
  it('names an authored Type for every base-tier demo Session', () => {
    const types = demoShellAgentTypes();
    const agents = demoShellAgents();
    expect(agents.length).toBeGreaterThan(0);
    for (const agent of agents) {
      expect(types[agent.id], agent.id).toBeTruthy();
    }
    // only fixture-authored Type names appear
    expect(new Set(Object.values(types))).toEqual(
      new Set(['Engineer', 'Researcher', 'Marketer', 'Support'])
    );
  });
});

describe('demoShellInitiatives', () => {
  it('projects one authored Initiative for every base-tier Session', () => {
    const initiatives = demoShellInitiatives();
    const agents = demoShellAgents();
    expect(Object.keys(initiatives)).toHaveLength(agents.length);
    for (const agent of agents) {
      expect(initiatives[agent.id]?.id, agent.id).toBe(agent.initiativeId);
      expect(initiatives[agent.id]?.name, agent.id).toBeTruthy();
    }
  });
});

describe('demoShellGoalVisuals', () => {
  it('authors stable offline identities and reuses them for one Initiative', () => {
    const visuals = demoShellGoalVisuals();
    const agents = demoShellAgents();
    expect(Object.keys(visuals)).toHaveLength(agents.length);
    for (const agent of agents) {
      expect(visuals[agent.id]).toMatchObject({
        identityKey: `demo:${agent.initiativeId}`,
        revision: 1,
        state: 'fallback',
        dataUrl: null,
      });
    }

    expect(
      new Set(Object.values(visuals).map(visual => visual.identityKey)).size
    ).toBe(new Set(agents.map(agent => agent.initiativeId)).size);
  });
});

describe('demoShellFleetAgentById (closing fix: Fleet-board jumps)', () => {
  it('resolves EVERY board agent — scale tier included — to an honest pane', () => {
    const board = demoFleetAgents('scale');
    const scaleTier = board.filter(agent => agent.tier === 'scale');
    expect(scaleTier.length).toBeGreaterThan(100);
    for (const agent of board) {
      const resolved = demoShellFleetAgentById(agent.id);
      expect(resolved, agent.id).toBeDefined();
      // A scale-tier Session has no authored transcript: its pane is the
      // honest readable work log, never a silent fallback to the hero.
      if (agent.tier === 'scale') {
        const content = demoPaneContent(resolved!);
        expect(content.kind).toBe('log');
        if (content.kind === 'log') {
          expect(content.lines.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('returns undefined for an unknown id (only THEN may the default hero show)', () => {
    expect(demoShellFleetAgentById('vgs-not-a-real-agent')).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Demo landings in the roadmap lens (ENG-027 W14 → ENG-017 S16)        */
/* ------------------------------------------------------------------ */

const SIM_START_MS = 1_800_000_000_000;

function simulation(seed = DEMO_SIMULATION_SEED): DemoFleetSimulation {
  return new DemoFleetSimulation(
    demoFleetAgents('scale', { nowMs: SIM_START_MS }),
    { seed, startedAtMs: SIM_START_MS }
  );
}

/** The first landing the seed queues, found by asking for a far frame. */
function firstLanding(sim: DemoFleetSimulation): DemoLandingView {
  const first = sim.frameAt(30 * 60_000).landings[0];
  if (!first) throw new Error('the seed queued no landing in thirty minutes');
  return first;
}

function dirOf(projectKey: string): string {
  const project = DEMO_PROJECTS.find(p => p.key === projectKey);
  if (!project) throw new Error(`unknown demo project ${projectKey}`);
  return project.dir;
}

/** The lens over one Project's roadmap at a frame, fed exactly as the Demo
 *  shell feeds it: the landed milestones in the text, the queue beside it. */
function lensAt(frame: DemoFleetFrame, projectKey: string): RoadmapLensView {
  const doc = demoRoadmapDoc(projectKey, demoLandedMilestones(frame.landings));
  if (!doc) throw new Error(`no demo roadmap for ${projectKey}`);
  return buildRoadmapLens({
    read: { status: 'ok', doc, mtimeMs: 0 },
    landings: demoDeliveryRead(dirOf(projectKey), frame),
  });
}

function itemOf(view: RoadmapLensView, declaredId: string) {
  const item = [
    view.now,
    view.next,
    view.later,
    view.backlog,
    view.shipped,
    view.parked,
  ]
    .flat()
    .find(candidate => candidate.declaredId === declaredId);
  if (!item) throw new Error(`${declaredId} is not in the lens`);
  return item;
}

/** A hand-built landing view for frames that need a specific queue shape. */
function landingView(
  over: Pick<DemoLandingView, 'id' | 'projectKey' | 'roadmapItemId' | 'state'> &
    Partial<DemoLandingView>
): DemoLandingView {
  const queuedAtMs = over.queuedAtMs ?? 0;
  return {
    agentId: 'nobody',
    milestoneId: null,
    milestoneTitle: 'A milestone',
    sha: 'abcdef0',
    queuedAtMs,
    queuePosition: null,
    queuedAt: SIM_START_MS + queuedAtMs,
    landedAt:
      over.state === 'landed'
        ? SIM_START_MS + queuedAtMs + DEMO_LANDING_CADENCE_MS.landed
        : null,
    ...over,
  };
}

function frameOf(
  landings: DemoLandingView[],
  elapsedMs: number
): DemoFleetFrame {
  return {
    elapsedMs,
    nowMs: SIM_START_MS + elapsedMs,
    agents: [],
    landings,
    transitions: 0,
  };
}

describe("demoDeliveryRead: the tick's landings as the lens's queue (ENG-027 W14)", () => {
  it('projects each Demo state to the lens state the live reader would, on the simulation clock', () => {
    const sim = simulation();
    const first = firstLanding(sim);
    const offsets = [
      0,
      DEMO_LANDING_CADENCE_MS.checking,
      DEMO_LANDING_CADENCE_MS.integrating,
      DEMO_LANDING_CADENCE_MS.landed,
    ];
    const states = new Set<string>();
    for (const offset of offsets) {
      const frame = sim.frameAt(first.queuedAtMs + offset);
      const now = frame.landings.find(l => l.id === first.id)!;
      states.add(now.state);
      const view = lensAt(frame, first.projectKey);
      const item = itemOf(view, first.roadmapItemId);
      // the same word the Demo frame uses, through the live lens's own rules
      expect(item.landing?.state).toBe(now.state);
      expect(item.landing?.ticketNumber).toBe(1);
      expect(item.landing?.subject).toContain(first.roadmapItemId);
      const inFlight = frame.landings.filter(
        l => l.projectKey === first.projectKey && l.state !== 'landed'
      );
      expect(view.landings).not.toBeNull();
      expect(view.landings!.unmatched).toBe(0);
      expect(view.landings!.checking).toBe(0);
      expect(view.landings!.inQueue).toBe(inFlight.length);
      if (now.state === 'landed') {
        expect(item.landing?.shortSha).toBe(first.sha);
        expect(item.landing?.position).toBeNull();
        expect(item.landing?.at).toBe(now.landedAt);
        expect(view.landings!.lastLanded?.shortSha).toBe(first.sha);
      } else {
        // the oldest in-flight landing of its Project is the head
        expect(item.landing?.position).toBe(1);
        expect(item.landing?.shortSha).toBeNull();
        expect(view.landings!.head).toMatchObject({
          ticketNumber: 1,
          declaredId: first.roadmapItemId,
          state: now.state,
        });
      }
    }
    // the cadence walked every state the Demo can be in
    expect([...states].sort()).toEqual(
      ['checking', 'integrating', 'landed', 'queued'].sort()
    );
  });

  it("reads each Project as its own repository: positions and the header count that Project's queue", () => {
    const frame = frameOf(
      [
        landingView({
          id: 'landing-1',
          projectKey: 'dispatch-engine',
          roadmapItemId: 'DSP-31',
          state: 'landed',
          sha: '1111111',
          queuedAtMs: 1_000,
        }),
        landingView({
          id: 'landing-2',
          projectKey: 'voltaic-home',
          roadmapItemId: 'HOME-24',
          state: 'checking',
          queuedAtMs: 50_000,
        }),
        landingView({
          id: 'landing-3',
          projectKey: 'dispatch-engine',
          roadmapItemId: 'DSP-32',
          state: 'queued',
          queuedAtMs: 55_000,
        }),
        landingView({
          id: 'landing-4',
          projectKey: 'dispatch-engine',
          roadmapItemId: 'DSP-33',
          state: 'queued',
          queuedAtMs: 56_000,
        }),
      ],
      60_000
    );

    const dispatch = lensAt(frame, 'dispatch-engine');
    expect(itemOf(dispatch, 'DSP-31').landing).toMatchObject({
      state: 'landed',
      shortSha: '1111111',
      position: null,
    });
    // fleet-wide these are 2nd and 3rd; in this Project's queue, 1st and 2nd
    expect(itemOf(dispatch, 'DSP-32').landing).toMatchObject({
      state: 'queued',
      position: 1,
      ticketNumber: 3,
    });
    expect(itemOf(dispatch, 'DSP-33').landing).toMatchObject({
      state: 'queued',
      position: 2,
      ticketNumber: 4,
    });
    expect(dispatch.landings).toMatchObject({
      inQueue: 2,
      checking: 0,
      unmatched: 0,
      head: { ticketNumber: 3, declaredId: 'DSP-32', state: 'queued' },
      lastLanded: { shortSha: '1111111' },
    });

    const home = lensAt(frame, 'voltaic-home');
    expect(itemOf(home, 'HOME-24').landing).toMatchObject({
      state: 'checking',
      position: 1,
      ticketNumber: 2,
    });
    expect(home.landings).toMatchObject({
      inQueue: 1,
      head: { ticketNumber: 2, declaredId: 'HOME-24', state: 'checking' },
      lastLanded: null,
    });

    // a Project whose queue has seen nothing shows the lens as before
    expect(demoDeliveryRead(dirOf('grid-api'), frame)).toBeNull();
    expect(lensAt(frame, 'grid-api').landings).toBeNull();
  });

  it('is null without a frame, at frame zero, and for an unknown Project, so the lens claims nothing', () => {
    const sim = simulation();
    const zero = sim.frameAt(0);
    for (const project of DEMO_PROJECTS) {
      expect(demoDeliveryRead(project.dir, null)).toBeNull();
      expect(demoDeliveryRead(project.dir, zero)).toBeNull();
    }
    expect(
      demoDeliveryRead('/nowhere/voltaic', sim.frameAt(10 * 60_000))
    ).toBeNull();
  });

  it('is a pure function of the seed and the elapsed time, however the clock was sampled', () => {
    const direct = simulation();
    const sampled = simulation();
    const t =
      firstLanding(direct).queuedAtMs +
      DEMO_LANDING_CADENCE_MS.checking +
      1_000;
    sampled.frameAt(Math.floor(t / 3));
    sampled.frameAt(Math.floor(t / 2));
    const a = direct.frameAt(t);
    const b = sampled.frameAt(t);
    let compared = 0;
    for (const project of DEMO_PROJECTS) {
      const readA = demoDeliveryRead(project.dir, a);
      expect(readA).toEqual(demoDeliveryRead(project.dir, b));
      if (readA) compared += 1;
    }
    expect(compared).toBeGreaterThan(0);
    // a different seed is a different queue
    const other = simulation('another-seed').frameAt(t);
    expect(DEMO_PROJECTS.map(p => demoDeliveryRead(p.dir, other))).not.toEqual(
      DEMO_PROJECTS.map(p => demoDeliveryRead(p.dir, a))
    );
  });

  it("carries the Agent's authored branch or none, and every ticket names an item of its own Project", () => {
    const sim = simulation();
    const frame = sim.frameAt(30 * 60_000);
    expect(frame.landings.length).toBeGreaterThan(1);
    const byId = new Map(frame.agents.map(agent => [agent.id, agent]));
    let unbranched = 0;
    for (const project of DEMO_PROJECTS) {
      const read = demoDeliveryRead(project.dir, frame);
      if (!read) continue;
      expect(read.status).toBe('ok');
      if (read.status !== 'ok') continue;
      for (const ticket of read.tickets) {
        const landing = frame.landings.find(l => l.id === ticket.id)!;
        expect(landing.projectKey).toBe(project.key);
        expect(ticket.branch).toBe(
          byId.get(landing.agentId)?.gitBranch ?? null
        );
        if (ticket.branch === null) unbranched += 1;
      }
      // the lens finds every ticket's item in this Project's roadmap
      expect(lensAt(frame, project.key).landings?.unmatched).toBe(0);
    }
    // the fixture has unbranched landable Agents; their landings stay unbranched
    expect(unbranched).toBeGreaterThan(0);
  });
});
