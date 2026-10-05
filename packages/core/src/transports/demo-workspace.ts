/**
 * DemoWorkspaceTransport — the Demo Workspace's fleet source (ENG-027 W2, alive
 * since W14).
 *
 * Feeds the SAME FleetManager / FleetState the live LocalSessionsTransport
 * feeds, from the authored Voltaic fixtures (ENG-027 W3/W4). The Fleet
 * altitude, Team altitude, and every ui-model selector consume demo truth
 * through exactly the contracts the live path uses — no demo-only shape.
 *
 * Honesty boundaries (ENG-027):
 * - No fabricated conversation. Nothing here streams, types, or simulates an
 *   agent thinking: Session panes still render authored transcripts and
 *   fixture-derived work logs. What DOES move (W14) is the fleet's work
 *   state: statuses, delegated children, landings and token totals advance
 *   on a seeded, deterministic tick (`demo/simulation.ts`) that is a pure
 *   function of the seed and the elapsed time, so a reload lands on the same
 *   fleet and two machines show the same demo. (The retired
 *   `MockFleetTransport` simulation engine is eval-only and must never run
 *   beside this source on a product surface.)
 * - Launches nothing. The tick never adds an Agent; every id at every frame
 *   is a fixture id, and no verb here can reach a process.
 * - No spend invention. `estimatedCost`/`costRate` stay 0 exactly as the
 *   live local transport reports them — dollars derived from list price are
 *   a confident lie (`model-weights.ts`); the Consumption surface owns the
 *   demo Workspace's spend story via its own corpus.
 * - Codex agents never carry delegation; preview desks stay preview. Both
 *   are properties of the fixtures, enforced by their tests — this transport
 *   maps, it does not edit.
 */

import {
  withAttentionRead,
  markAttentionUnread,
  type SessionAttentionCommands,
  type SessionAttentionSignal,
} from '../session-attention';
import type { PtyAttention } from '../desktop-bridge/pty';
import type { FleetManager } from '../state/fleet-manager';
import type {
  AgentActivity,
  AgentDelegation,
  ExawattAgent,
} from '../types/agent';
import { INITIAL_AGENT_METRICS } from '../types/agent';
import type { ProjectCatalogEntry } from '../types/project';
import type { DemoFleetAgent, DemoFleetTier } from '../demo/types';
import { DEMO_PROJECTS, DEMO_PROJECTS_BY_KEY } from '../demo/projects';
import { demoAgentBurn } from '../demo/burn';
import { demoFleetAgents } from '../demo/scale';
import {
  DemoFleetSimulation,
  type DemoFleetFrame,
} from '../demo/simulation';

/** How often the Demo fleet is advanced on a product surface. Coarse on
 *  purpose: the tick carries state changes, never ambient motion, so it is
 *  the same under reduced motion. */
const DEMO_TICK_INTERVAL_MS = 1_000;

export interface DemoWorkspaceTransportOptions {
  /** `base` = the 27 hand-authored Agents; `scale` = the full honest fleet. */
  tier?: DemoFleetTier;
  /** The clock at t=0: the frozen fixture is rebased here and the tick's
   *  elapsed time is measured from it. */
  nowMs?: number;
  /** Seed for the deterministic tick. One constant by default, so every
   *  reload lands on the same fleet. */
  seed?: string;
  /** Wall clock the tick reads. Tests inject one and drive it. */
  clock?: () => number;
  /** Tick period; `0` disables the timer so a caller drives `tick()`. */
  tickMs?: number;
}

/** The demo Workspace's Project catalog, in the live catalog shape. */
export function demoWorkspaceProjectCatalog(): ProjectCatalogEntry[] {
  return DEMO_PROJECTS.map(project => ({
    id: project.key,
    label: project.name,
    color: project.color,
  }));
}

function delegationFor(agent: DemoFleetAgent): AgentDelegation | undefined {
  // Presence IS the signal (ENG-023): an empty team reads as absent, exactly
  // as the live transport reports it.
  if (agent.delegated.length === 0) return undefined;
  return {
    children: agent.delegated.map(run => ({
      id: run.agentId,
      agentType: run.agentType,
      description: run.task,
      startedAt: run.startedAtMs,
    })),
  };
}

/**
 * The recorded activity backlog: each Agent's latest fact, as the feed event
 * the live path would have recorded when it happened. Fixture truth at t=0;
 * the tick re-maps an Agent only when one of these facts changed.
 */
function activitiesFor(agent: DemoFleetAgent): AgentActivity[] {
  const out: AgentActivity[] = agent.delegated.map(run => ({
    id: `${agent.id}-delegate-${run.agentId}`,
    timestamp: run.startedAtMs,
    type: 'tool_use',
    content: run.task,
  }));
  if (agent.blocker) {
    out.push({
      id: `${agent.id}-blocker`,
      timestamp: agent.blocker.createdAtMs,
      type: 'blocker_created',
      content: agent.blocker.title,
    });
  } else if (agent.faultNote) {
    out.push({
      id: `${agent.id}-fault`,
      timestamp: agent.lastActivityAtMs,
      type: 'status_change',
      content: agent.faultNote,
    });
  } else {
    out.push({
      id: `${agent.id}-latest`,
      timestamp: agent.lastActivityAtMs,
      type: 'chat_message',
      content: agent.contextLabel,
    });
  }
  return out;
}

/** Authored source facts mapped once for every altitude. */
export function demoAgentAttention(agent: DemoFleetAgent): PtyAttention | null {
  if (agent.status === 'blocked' && agent.blocker) {
    return {
      kind: 'blocked',
      since: agent.blocker.createdAtMs,
      request: 'blocking',
      requestId: `${agent.id}:blocker`,
      unread: true,
    };
  }
  if (agent.status === 'complete') {
    return {
      kind: 'turn-end',
      since: agent.lastActivityAtMs,
      requestId: `${agent.id}:result`,
      unread: true,
    };
  }
  return null;
}

/** Map one fixture Agent into the live `ExawattAgent` contract. */
export function demoWorkspaceAgent(agent: DemoFleetAgent): ExawattAgent {
  const project = DEMO_PROJECTS_BY_KEY.get(agent.projectKey);
  const delegation = delegationFor(agent);
  // Per-agent burn (ENG-008): the fixture authors full usage, so the mapped
  // Agent carries the raw and normalized totals through core's own E3 math.
  // The live local transport reports neither field — absent, never zero.
  const burn = demoAgentBurn(agent);
  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    // The six-word context label (ENG-016 D33) — the same field the live
    // path fills from the goal summarizer.
    goal: agent.contextLabel,
    projectId: agent.projectKey,
    project: project?.name ?? agent.projectKey,
    sessionKey: agent.id,
    // A failed fixture Session reads as stopped — the same "Open stopped
    // session" affordance the live board shows for a dead process.
    sessionState: agent.status === 'error' ? 'stopped' : 'live',
    activities: activitiesFor(agent),
    attention: demoAgentAttention(agent),
    metrics: {
      ...INITIAL_AGENT_METRICS,
      tokensIn: agent.usage.input,
      tokensOut: agent.usage.output,
      turnCount: agent.turns,
      startedAt: agent.startedAtMs,
      duration: Math.max(0, agent.lastActivityAtMs - agent.startedAtMs),
      rawTokens: burn.rawTokens,
      normalizedTokens: burn.normalizedTokens,
    },
    lastActivityAt: agent.lastActivityAtMs,
    ...(agent.blocker
      ? {
          blockerInfo: {
            type: agent.blocker.type,
            title: agent.blocker.title,
            description: agent.blocker.description,
            suggestedResponses: agent.blocker.suggestedResponses,
            createdAt: agent.blocker.createdAtMs,
          },
        }
      : {}),
    ...(delegation ? { delegation } : {}),
    createdAt: agent.startedAtMs,
  };
}

/** The facts whose change re-maps an Agent into the manager. */
function frameSignature(agent: DemoFleetAgent): string {
  return [
    agent.status,
    agent.lastActivityAtMs,
    agent.turns,
    agent.delegated.map(run => run.agentId).join(','),
    agent.blocker?.createdAtMs ?? '',
    agent.faultNote ?? '',
  ].join('|');
}

/**
 * Carry an operator's read receipt across a tick. A source fact that did not
 * change keeps whatever the operator already did with it (read, or a
 * reminder they set); a NEW request or result arrives unread, exactly as the
 * live path reports it.
 */
function carryAttention(
  existing: SessionAttentionSignal | null | undefined,
  next: SessionAttentionSignal | null | undefined
): SessionAttentionSignal | null {
  if (!next) {
    return existing?.kind === 'reminder' ? existing : null;
  }
  if (
    existing &&
    existing.kind === next.kind &&
    existing.since === next.since &&
    existing.requestId === next.requestId
  ) {
    return existing;
  }
  return next;
}

type FrameListener = (frame: DemoFleetFrame) => void;

export class DemoWorkspaceTransport implements SessionAttentionCommands {
  private manager: FleetManager | null = null;
  private readonly tier: DemoFleetTier;
  private readonly nowMs: number;
  private readonly seed: string | undefined;
  private readonly clock: () => number;
  private readonly tickMs: number;
  private upserted: string[] = [];
  private simulation: DemoFleetSimulation | null = null;
  private signatures = new Map<string, string>();
  private current: DemoFleetFrame | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly frameListeners = new Set<FrameListener>();

  constructor(options: DemoWorkspaceTransportOptions = {}) {
    this.tier = options.tier ?? 'scale';
    this.nowMs = options.nowMs ?? Date.now();
    this.seed = options.seed;
    this.clock = options.clock ?? Date.now;
    this.tickMs = options.tickMs ?? DEMO_TICK_INTERVAL_MS;
  }

  initialize(manager: FleetManager): void {
    this.manager = manager;
  }

  /** Upsert frame zero (the fixture, rebased) and start the tick.
   *  Reset = stop + start, and lands on the same seed. */
  start(): void {
    const manager = this.manager;
    if (!manager) return;
    const agents = demoFleetAgents(this.tier, { nowMs: this.nowMs });
    this.simulation = new DemoFleetSimulation(agents, {
      seed: this.seed,
      startedAtMs: this.nowMs,
    });
    const frame = this.simulation.frameAt(0);
    this.upserted = frame.agents.map(agent => agent.id);
    this.signatures = new Map();
    for (const agent of frame.agents) {
      this.signatures.set(agent.id, frameSignature(agent));
      manager.upsertAgent(demoWorkspaceAgent(agent));
    }
    this.current = frame;
    if (this.tickMs > 0 && this.timer === null) {
      this.timer = setInterval(() => this.tick(), this.tickMs);
    }
  }

  /**
   * Advance the fleet to the clock's elapsed time. Only Agents whose facts
   * changed are re-mapped; read receipts on unchanged facts survive. Emits
   * the new frame to listeners when anything moved.
   */
  tick(): DemoFleetFrame | null {
    const manager = this.manager;
    const simulation = this.simulation;
    if (!manager || !simulation) return null;
    const elapsedMs = Math.max(0, this.clock() - this.nowMs);
    const frame = simulation.frameAt(elapsedMs);
    let moved = false;
    for (const agent of frame.agents) {
      const signature = frameSignature(agent);
      if (this.signatures.get(agent.id) === signature) continue;
      this.signatures.set(agent.id, signature);
      moved = true;
      const mapped = demoWorkspaceAgent(agent);
      mapped.attention = carryAttention(
        manager.getAgent(agent.id)?.attention,
        mapped.attention
      );
      manager.upsertAgent(mapped);
    }
    const previous = this.current;
    const landingsMoved =
      !previous ||
      previous.landings.length !== frame.landings.length ||
      previous.landings.some(
        (landing, index) => landing.state !== frame.landings[index]?.state
      );
    if (moved || landingsMoved) {
      this.current = frame;
      for (const listener of this.frameListeners) listener(frame);
    }
    return this.current;
  }

  /** The most recent frame the manager reflects; null before `start()`. */
  frame(): DemoFleetFrame | null {
    return this.current;
  }

  /** Observe frames the tick published. Returns the unsubscribe. */
  onFrame(listener: FrameListener): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  focus(id: string | null): void {
    if (id) this.setUnread(id, false);
  }

  markUnread(id: string): void {
    this.setUnread(id, true);
  }

  private setUnread(id: string, unread: boolean): void {
    if (!this.upserted.includes(id)) return;
    const agent = this.manager?.getAgent(id);
    if (!agent || agent.attention?.unread === unread) return;
    if (!unread && !agent.attention) return;
    this.manager?.upsertAgent({
      ...agent,
      attention: unread
        ? markAttentionUnread(
            agent.attention
              ? { ...agent.attention, kind: agent.attention.kind ?? 'bell' }
              : null,
            this.clock()
          )
        : withAttentionRead(
            { ...agent.attention!, kind: agent.attention!.kind ?? 'bell' },
            false
          ),
    });
  }

  /** Stop the tick and remove every demo Agent so a following transport
   *  starts from truth — demo entities must never linger under another
   *  Workspace's identity. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.simulation = null;
    this.current = null;
    this.signatures = new Map();
    const manager = this.manager;
    if (!manager) return;
    for (const id of this.upserted.splice(0)) {
      manager.removeAgent(id);
    }
  }
}
