/**
 * The Demo fleet tick (ENG-027 W14 — DATA only).
 *
 * The Demo Workspace was a still image: the Voltaic fixture rebased to "now"
 * once, nothing moving after `start()`, while the website hero animated. This
 * module makes the fleet WORK on screen without inventing a single Agent:
 * every status change, delegated child, landing and token increment below is
 * a pure function of `(seed, elapsed time)` over the authored fixture.
 *
 * Contract:
 *
 * - `frameAt(0)` IS the fixture. The t=0 frame returns the authored Agents
 *   untouched, so the hero capture, the eval tiers, and every fixture test
 *   keep reading exactly what they read before.
 * - Deterministic. Two simulations with the same seed and the same elapsed
 *   time produce deeply identical frames, however many intermediate frames
 *   were asked for in between. No `Math.random`, no wall clock, no per-frame
 *   dice: every draw is a hash of `(seed, agent id, segment index)`.
 * - Plausible cadences. Each Agent walks a status machine whose dwell times
 *   are drawn from the bounds in `DEMO_TICK_CADENCE_MS` (tens of seconds to
 *   minutes, as real coding Sessions turn), with a stationary start so the
 *   fleet is mid-flight at t=0 rather than firing on a shared clock.
 * - Authored needs-you only. An Agent becomes `blocked` only if a human wrote
 *   its blocker in the fixture; the tick raises and clears those authored
 *   blockers, never rolls new copy. Faults draw from the fixture's own stems.
 * - Delegation follows source truth. Only an Agent whose harness can observe
 *   delegation (`scale.ts`) spawns children, and a child never outlives its
 *   parent's turn — the live transport's "if the team is working, they're
 *   working" rule keeps holding.
 * - Landings are roadmap truth. A landing claims the next OPEN milestone of
 *   the Agent's own roadmap item, moves through the real delivery states
 *   (queued → checking → integrating → landed) and carries a sha derived
 *   from the seed; `roadmaps.ts` renders the flipped milestone through the
 *   same parser the lens uses. Only `live`-readiness coding Projects land.
 * - Launches nothing. The set of Agent ids at every frame equals the fixture's.
 */

import type { AgentStatus } from '../types/agent';
import type { RoadmapMilestone } from '../roadmap/types';
import type {
  DemoBlocker,
  DemoDelegatedRun,
  DemoFleetAgent,
  DemoUsageSpec,
} from './types';
import { DEMO_PROJECTS_BY_KEY } from './projects';
import { demoOpenMilestones } from './roadmaps';
import {
  DEMO_DELEGATION_OBSERVING_HARNESSES,
  DEMO_FAULT_STEMS,
  demoChildTaskStems,
} from './scale';

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

/** One seed for every reload: the fleet always wakes up mid-flight in the
 *  same place and evolves the same way. */
export const DEMO_SIMULATION_SEED = 'voltaic-grid-systems';

/** Dwell bounds per status, in ms. Mostly quiet work; needs-you rows stay up
 *  long enough to be read; faults stay down long enough to be noticed. */
export const DEMO_TICK_CADENCE_MS: Readonly<
  Record<AgentStatus, { readonly min: number; readonly max: number }>
> = {
  working: { min: 25_000, max: 150_000 },
  reviewing: { min: 20_000, max: 80_000 },
  complete: { min: 30_000, max: 180_000 },
  idle: { min: 60_000, max: 300_000 },
  blocked: { min: 90_000, max: 360_000 },
  error: { min: 120_000, max: 480_000 },
};

/** The first transition of any Agent is never at t=0: frame zero must be the
 *  fixture, and a status that flips on the first paint reads as a glitch. */
const FIRST_TRANSITION_FLOOR_MS = 1_000;

/** Attention raised before the switch holds at least this long. The operator
 *  switches to Demo, sees the needs-you queue and the results waiting, and
 *  ⌘J walks it: a request or result that vanished seconds after it was shown
 *  would make that walk lie. New attention raised by the tick is not held. */
export const INITIAL_ATTENTION_HOLD_MS = 45_000;

/** Delivery queue cadence of one landing, in ms after it is queued. Shorter
 *  than a real floor (minutes) so a landing is visible inside one demo beat,
 *  long enough that each state is seen. */
export const DEMO_LANDING_CADENCE_MS = {
  checking: 8_000,
  integrating: 36_000,
  landed: 44_000,
} as const;

/** Probability that a working turn ending in a result also lands (per
 *  landable Agent). Tuned with the fleet's working population so landings
 *  arrive roughly every 45 s and the fourteen open coding milestones last a
 *  ten-minute demo. */
const LANDING_PROBABILITY = 0.1;

/** Delegated child spawn odds per working turn of a delegation-observing
 *  parent; a slice of those fan out two. */
const CHILD_SPAWN_PROBABILITY = 0.5;
const SECOND_CHILD_PROBABILITY = 0.15;
const CHILD_DWELL_MS = { min: 30_000, max: 150_000 } as const;
/** A child that would have under this long to run is not spawned. */
const CHILD_MIN_RUN_MS = 15_000;

/* ------------------------------------------------------------------ */
/* deterministic pseudo-randomness                                     */
/* ------------------------------------------------------------------ */

/** FNV-1a over the joined key, folded to [0, 1). Stable across hosts. */
function unit(...parts: Array<string | number>): number {
  const text = parts.join(':');
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function hex(length: number, ...parts: Array<string | number>): string {
  let out = '';
  let salt = 0;
  while (out.length < length) {
    out += Math.floor(unit(...parts, salt) * 0xffff_ffff)
      .toString(16)
      .padStart(8, '0');
    salt += 1;
  }
  return out.slice(0, length);
}

function between(
  range: { readonly min: number; readonly max: number },
  u: number
): number {
  return Math.round(range.min + u * (range.max - range.min));
}

/* ------------------------------------------------------------------ */
/* status machine                                                      */
/* ------------------------------------------------------------------ */

/**
 * The next status after `current`. Agents with an authored blocker cycle
 * through needs-you often (the attention story must stay populated); every
 * other Agent never blocks, because no human wrote its question.
 */
function nextStatus(
  current: AgentStatus,
  u: number,
  authoredBlocker: boolean
): AgentStatus {
  switch (current) {
    case 'working':
      if (authoredBlocker) {
        return u < 0.45 ? 'blocked' : u < 0.8 ? 'complete' : 'reviewing';
      }
      return u < 0.55
        ? 'complete'
        : u < 0.75
          ? 'reviewing'
          : u < 0.95
            ? 'idle'
            : 'error';
    case 'reviewing':
      return u < 0.7 ? 'complete' : 'working';
    case 'complete':
      return u < 0.65 ? 'working' : 'idle';
    case 'idle':
    case 'blocked':
    case 'error':
      return 'working';
  }
}

/* ------------------------------------------------------------------ */
/* per-agent plan                                                      */
/* ------------------------------------------------------------------ */

interface Segment {
  index: number;
  status: AgentStatus;
  /** Elapsed ms at which this segment begins (segment 0 begins at 0). */
  startMs: number;
  /** Elapsed ms at which the next segment begins. */
  endMs: number;
  /** Assistant turns credited when this segment ends. */
  turns: number;
  /** Ends a working turn with a result on a landable Agent: may land. */
  landingCandidate: boolean;
}

interface ChildRun {
  run: DemoDelegatedRun;
  spawnMs: number;
  finishMs: number;
}

interface AgentPlan {
  agent: DemoFleetAgent;
  authoredBlocker: DemoBlocker | undefined;
  canDelegate: boolean;
  landable: boolean;
  perTurn: DemoUsageSpec;
  segments: Segment[];
  children: ChildRun[];
  /** Index of the segment the last frame read; segments only move forward. */
  cursor: number;
}

export interface DemoLanding {
  id: string;
  agentId: string;
  projectKey: string;
  roadmapItemId: string;
  milestoneId: string | null;
  milestoneTitle: string;
  /** Seven hex characters, derived from the seed. */
  sha: string;
  /** Elapsed ms at which the landing entered the queue. */
  queuedAtMs: number;
}

export type DemoLandingState =
  | 'queued'
  | 'checking'
  | 'integrating'
  | 'landed';

/** A landing as a surface reads it at one elapsed time. */
export interface DemoLandingView extends DemoLanding {
  state: DemoLandingState;
  /** 1-based place among landings still in the queue; null once landed. */
  queuePosition: number | null;
  /** Absolute ms (the simulation clock) the landing was queued. */
  queuedAt: number;
  /** Absolute ms the landing integrated; null until `landed`. */
  landedAt: number | null;
}

/** The delivery state of one landing at an elapsed time. */
export function demoLandingStateAt(
  landing: DemoLanding,
  elapsedMs: number
): DemoLandingState {
  const age = elapsedMs - landing.queuedAtMs;
  if (age >= DEMO_LANDING_CADENCE_MS.landed) return 'landed';
  if (age >= DEMO_LANDING_CADENCE_MS.integrating) return 'integrating';
  if (age >= DEMO_LANDING_CADENCE_MS.checking) return 'checking';
  return 'queued';
}

export interface DemoFleetFrame {
  /** Elapsed ms since the simulation started. */
  elapsedMs: number;
  /** The simulation clock at this frame: `startedAtMs + elapsedMs`. */
  nowMs: number;
  /** Every fixture Agent at this instant — same ids, same order. */
  agents: DemoFleetAgent[];
  /** Every landing queued so far, oldest first, with its state now. */
  landings: DemoLandingView[];
  /** Fleet-wide status transitions since t=0. */
  transitions: number;
}

export interface DemoFleetSimulationOptions {
  seed?: string;
  /** The absolute clock at t=0 — the `nowMs` the agents were rebased to. */
  startedAtMs: number;
}

function perTurnUsage(agent: DemoFleetAgent): DemoUsageSpec {
  const turns = Math.max(1, agent.turns);
  return {
    input: agent.usage.input / turns,
    cacheRead: agent.usage.cacheRead / turns,
    cacheWrite: agent.usage.cacheWrite / turns,
    output: agent.usage.output / turns,
    reasoning: (agent.usage.reasoning ?? 0) / turns,
    webSearches: 0,
  };
}

function isLandable(agent: DemoFleetAgent): boolean {
  if (!agent.roadmapItemId) return false;
  const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey);
  return project?.readiness === 'live';
}

export class DemoFleetSimulation {
  private readonly seed: string;
  private readonly startedAtMs: number;
  private readonly fixture: readonly DemoFleetAgent[];
  private plans: AgentPlan[] = [];
  private landings: DemoLanding[] = [];
  private claimed = new Set<string>();
  /** Landing candidates at or before this elapsed time are resolved. */
  private resolvedUntilMs = 0;
  private lastElapsedMs = -1;

  constructor(
    agents: readonly DemoFleetAgent[],
    options: DemoFleetSimulationOptions
  ) {
    this.seed = options.seed ?? DEMO_SIMULATION_SEED;
    this.startedAtMs = options.startedAtMs;
    this.fixture = agents;
    this.reset();
  }

  private reset(): void {
    // Stratified stationary start: each Agent's first transition falls in
    // its own slice of its dwell, in a seed-shuffled order, so the fleet's
    // first flips are spread evenly from the first second on instead of
    // depending on 173 independent draws lining up.
    const order = this.fixture
      .map(agent => agent.id)
      .sort((a, b) => unit(this.seed, a, 'rank') - unit(this.seed, b, 'rank'));
    const rank = new Map(order.map((id, index) => [id, index]));
    this.plans = this.fixture.map(agent =>
      this.planFor(agent, rank.get(agent.id)!, this.fixture.length)
    );
    this.landings = [];
    this.claimed = new Set();
    this.resolvedUntilMs = 0;
    this.lastElapsedMs = -1;
  }

  private planFor(agent: DemoFleetAgent, rank: number, count: number): AgentPlan {
    const canDelegate =
      agent.source === 'claude-code' &&
      DEMO_DELEGATION_OBSERVING_HARNESSES.includes(agent.harness);
    const dwell = between(
      DEMO_TICK_CADENCE_MS[agent.status],
      unit(this.seed, agent.id, 'dwell', 0)
    );
    // The Agent is partway through its first dwell at t=0; how far is its
    // slice of [0, 1) by rank, jittered within the slice. A row the operator
    // is shown as needing them, or as a result to read, holds its ground.
    const phase = (rank + unit(this.seed, agent.id, 'phase0')) / Math.max(1, count);
    const floor =
      agent.status === 'blocked' || agent.status === 'complete'
        ? INITIAL_ATTENTION_HOLD_MS
        : FIRST_TRANSITION_FLOOR_MS;
    const end0 = Math.max(floor, Math.round(dwell * phase));
    const plan: AgentPlan = {
      agent,
      authoredBlocker: agent.blocker,
      canDelegate,
      landable: isLandable(agent),
      perTurn: perTurnUsage(agent),
      segments: [
        {
          index: 0,
          status: agent.status,
          startMs: 0,
          endMs: end0,
          turns: agent.status === 'working' || agent.status === 'reviewing' ? 1 : 0,
          landingCandidate: false,
        },
      ],
      children: agent.delegated.map((run, index) => ({
        run,
        spawnMs: 0,
        // Children never outlive the parent's turn; the fixture's children
        // finish in the back half of segment 0 so they do not all vanish
        // on the first paint.
        finishMs: Math.max(
          FIRST_TRANSITION_FLOOR_MS,
          Math.round(end0 * (0.4 + 0.6 * unit(this.seed, agent.id, 'child0', index)))
        ),
      })),
      cursor: 0,
    };
    return plan;
  }

  /** Extend one plan until its last segment reaches past `untilMs`. */
  private extend(plan: AgentPlan, untilMs: number): void {
    let last = plan.segments[plan.segments.length - 1]!;
    while (last.endMs <= untilMs) {
      const index = last.index + 1;
      const status = nextStatus(
        last.status,
        unit(this.seed, plan.agent.id, 'next', index),
        plan.authoredBlocker !== undefined
      );
      const dwell = between(
        DEMO_TICK_CADENCE_MS[status],
        unit(this.seed, plan.agent.id, 'dwell', index)
      );
      const segment: Segment = {
        index,
        status,
        startMs: last.endMs,
        endMs: last.endMs + dwell,
        turns:
          status === 'working'
            ? 1 + Math.floor(unit(this.seed, plan.agent.id, 'turns', index) * 3)
            : status === 'reviewing'
              ? 1
              : 0,
        landingCandidate: false,
      };
      // A working turn that ends in a result may be a landing; decided when
      // the FOLLOWING segment is known, so mark the previous one here.
      if (
        plan.landable &&
        last.status === 'working' &&
        status === 'complete' &&
        unit(this.seed, plan.agent.id, 'land', last.index) < LANDING_PROBABILITY
      ) {
        last.landingCandidate = true;
      }
      if (status === 'working' && plan.canDelegate) {
        this.spawnChildren(plan, segment);
      }
      plan.segments.push(segment);
      last = segment;
    }
  }

  private spawnChildren(plan: AgentPlan, segment: Segment): void {
    const roll = unit(this.seed, plan.agent.id, 'spawn', segment.index);
    if (roll >= CHILD_SPAWN_PROBABILITY) return;
    const count = roll < SECOND_CHILD_PROBABILITY ? 2 : 1;
    const project = DEMO_PROJECTS_BY_KEY.get(plan.agent.projectKey);
    if (!project) return;
    const stems = demoChildTaskStems(project.function);
    const duration = segment.endMs - segment.startMs;
    for (let k = 0; k < count; k++) {
      const key = `${plan.agent.id}:${segment.index}:${k}`;
      const spawnMs =
        segment.startMs +
        Math.round(duration * (0.08 + 0.3 * unit(this.seed, key, 'at')));
      const latestFinish = segment.endMs - FIRST_TRANSITION_FLOOR_MS;
      if (latestFinish - spawnMs < CHILD_MIN_RUN_MS) continue;
      const finishMs = Math.min(
        latestFinish,
        spawnMs + between(CHILD_DWELL_MS, unit(this.seed, key, 'dwell'))
      );
      const explore = k === 0;
      plan.children.push({
        spawnMs,
        finishMs,
        run: {
          agentId: `agent-${hex(4, this.seed, key, 'id')}`,
          agentType: explore ? 'Explore' : 'general-purpose',
          model: explore ? 'claude-sonnet-5' : 'claude-opus-5',
          task: `${explore ? stems.explore : stems.general}: ${plan.agent.name}`,
          startedAtMs: this.startedAtMs + spawnMs,
          usage: {
            input: jitter(unit(this.seed, key, 'in'), explore ? 34_000 : 28_000),
            cacheRead: jitter(unit(this.seed, key, 'cr'), explore ? 1_200_000 : 940_000),
            cacheWrite: jitter(unit(this.seed, key, 'cw'), explore ? 130_000 : 110_000),
            output: jitter(unit(this.seed, key, 'out'), explore ? 46_000 : 41_000),
          },
        },
      });
    }
  }

  /** Resolve every landing candidate in `(resolvedUntilMs, untilMs]`, in
   *  global (time, agent id) order, so the claim sequence is independent of
   *  how many frames were asked for on the way. */
  private resolveLandings(untilMs: number): void {
    const candidates: Array<{ endMs: number; plan: AgentPlan; segment: Segment }> = [];
    for (const plan of this.plans) {
      if (!plan.landable) continue;
      for (const segment of plan.segments) {
        if (
          segment.landingCandidate &&
          segment.endMs > this.resolvedUntilMs &&
          segment.endMs <= untilMs
        ) {
          candidates.push({ endMs: segment.endMs, plan, segment });
        }
      }
    }
    candidates.sort(
      (a, b) => a.endMs - b.endMs || (a.plan.agent.id < b.plan.agent.id ? -1 : 1)
    );
    for (const { endMs, plan } of candidates) {
      const itemId = plan.agent.roadmapItemId!;
      const open = demoOpenMilestones(plan.agent.projectKey, itemId).find(
        milestone => !this.claimed.has(milestoneKey(plan.agent.projectKey, itemId, milestone))
      );
      if (!open) continue;
      this.claimed.add(milestoneKey(plan.agent.projectKey, itemId, open));
      const ordinal = this.landings.length + 1;
      this.landings.push({
        id: `landing-${ordinal}`,
        agentId: plan.agent.id,
        projectKey: plan.agent.projectKey,
        roadmapItemId: itemId,
        milestoneId: open.id,
        milestoneTitle: open.title,
        sha: hex(7, this.seed, 'sha', plan.agent.id, endMs),
        queuedAtMs: endMs,
      });
    }
    this.resolvedUntilMs = untilMs;
  }

  private segmentAt(plan: AgentPlan, elapsedMs: number): Segment {
    let i = plan.cursor;
    while (plan.segments[i]!.endMs <= elapsedMs) i += 1;
    plan.cursor = i;
    return plan.segments[i]!;
  }

  private agentAt(plan: AgentPlan, elapsedMs: number, transitions: { count: number }): DemoFleetAgent {
    const segment = this.segmentAt(plan, elapsedMs);
    transitions.count += segment.index;
    const { agent } = plan;
    if (segment.index === 0 && plan.children.every(child => child.finishMs > elapsedMs)) {
      return agent;
    }

    let extraTurns = 0;
    for (let i = 0; i < segment.index; i++) extraTurns += plan.segments[i]!.turns;

    const delegated: DemoDelegatedRun[] = [];
    let lastEventMs = segment.index === 0 ? -1 : segment.startMs;
    for (const child of plan.children) {
      if (child.spawnMs <= elapsedMs && elapsedMs < child.finishMs) {
        delegated.push(child.run);
      }
      if (child.spawnMs > 0 && child.spawnMs <= elapsedMs) {
        lastEventMs = Math.max(lastEventMs, child.spawnMs);
      }
      if (child.finishMs <= elapsedMs) {
        lastEventMs = Math.max(lastEventMs, child.finishMs);
      }
    }
    const lastActivityAtMs =
      lastEventMs < 0
        ? agent.lastActivityAtMs
        : Math.max(agent.lastActivityAtMs, this.startedAtMs + lastEventMs);

    const next: DemoFleetAgent = {
      ...agent,
      status: segment.status,
      lastActivityAtMs,
      turns: agent.turns + extraTurns,
      usage:
        extraTurns === 0
          ? agent.usage
          : {
              ...agent.usage,
              input: Math.round(agent.usage.input + plan.perTurn.input * extraTurns),
              cacheRead: Math.round(agent.usage.cacheRead + plan.perTurn.cacheRead * extraTurns),
              cacheWrite: Math.round(agent.usage.cacheWrite + plan.perTurn.cacheWrite * extraTurns),
              output: Math.round(agent.usage.output + plan.perTurn.output * extraTurns),
              ...(agent.usage.reasoning !== undefined
                ? { reasoning: Math.round(agent.usage.reasoning + (plan.perTurn.reasoning ?? 0) * extraTurns) }
                : {}),
            },
      delegated,
    };
    delete next.blocker;
    delete next.faultNote;
    if (segment.status === 'blocked' && plan.authoredBlocker) {
      next.blocker =
        segment.index === 0
          ? plan.authoredBlocker
          : { ...plan.authoredBlocker, createdAtMs: this.startedAtMs + segment.startMs };
    }
    if (segment.status === 'error') {
      next.faultNote =
        segment.index === 0 && agent.faultNote
          ? agent.faultNote
          : DEMO_FAULT_STEMS[
              Math.floor(unit(this.seed, agent.id, 'fault', segment.index) * DEMO_FAULT_STEMS.length)
            ];
    }
    return next;
  }

  /** The whole fleet at `elapsedMs` since start. Pure in `elapsedMs`. */
  frameAt(elapsedMs: number): DemoFleetFrame {
    const t = Math.max(0, Math.floor(elapsedMs));
    // Frames are normally asked for in order; an earlier time rebuilds from
    // the fixture so the answer never depends on what was asked before.
    if (t < this.lastElapsedMs) this.reset();
    this.lastElapsedMs = t;
    for (const plan of this.plans) this.extend(plan, t);
    this.resolveLandings(t);

    const transitions = { count: 0 };
    const agents =
      t === 0
        ? [...this.fixture]
        : this.plans.map(plan => this.agentAt(plan, t, transitions));
    if (t === 0) transitions.count = 0;

    let position = 0;
    const landings: DemoLandingView[] = this.landings.map(landing => {
      const state = demoLandingStateAt(landing, t);
      if (state !== 'landed') position += 1;
      return {
        ...landing,
        state,
        queuePosition: state === 'landed' ? null : position,
        queuedAt: this.startedAtMs + landing.queuedAtMs,
        landedAt:
          state === 'landed'
            ? this.startedAtMs + landing.queuedAtMs + DEMO_LANDING_CADENCE_MS.landed
            : null,
      };
    });

    return {
      elapsedMs: t,
      nowMs: this.startedAtMs + t,
      agents,
      landings,
      transitions: transitions.count,
    };
  }
}

function jitter(u: number, base: number): number {
  return Math.round(base * (0.55 + u * 0.9));
}

function milestoneKey(
  projectKey: string,
  itemId: string,
  milestone: RoadmapMilestone
): string {
  return `${projectKey}:${itemId}:${milestone.id ?? milestone.title}`;
}
