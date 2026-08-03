/**
 * DemoWorkspaceTransport — the Demo Workspace's fleet source (ENG-027 W2).
 *
 * Feeds the SAME FleetManager / FleetState the live LocalSessionsTransport
 * feeds, from the authored Voltaic fixtures (ENG-027 W3/W4). The Fleet
 * altitude, Team altitude, and every ui-model selector consume demo truth
 * through exactly the contracts the live path uses — no demo-only shape.
 *
 * Honesty boundaries (ENG-027):
 * - No fabricated liveness. The fixture is a frozen, deterministic corpus
 *   rebased to "now" once at start; nothing ticks, streams, or simulates an
 *   agent thinking. (The retired `MockFleetTransport` simulation engine is
 *   eval-only and must never run beside this source on a product surface.)
 * - No spend invention. `estimatedCost`/`costRate` stay 0 exactly as the
 *   live local transport reports them — dollars derived from list price are
 *   a confident lie (`model-weights.ts`); the Consumption surface owns the
 *   demo Workspace's spend story via its own corpus.
 * - Codex agents never carry delegation; preview desks stay preview. Both
 *   are properties of the fixtures, enforced by their tests — this transport
 *   maps, it does not edit.
 */

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

export interface DemoWorkspaceTransportOptions {
  /** `base` = the 27 hand-authored Agents; `scale` = the full honest fleet. */
  tier?: DemoFleetTier;
  /** Rebase the frozen fixture clock so the fleet reads as current. */
  nowMs?: number;
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
 * the live path would have recorded when it happened. This is fixture truth
 * replayed once — nothing ticks or streams after `start()`.
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

export class DemoWorkspaceTransport {
  private manager: FleetManager | null = null;
  private readonly tier: DemoFleetTier;
  private readonly nowMs: number;
  private upserted: string[] = [];

  constructor(options: DemoWorkspaceTransportOptions = {}) {
    this.tier = options.tier ?? 'scale';
    this.nowMs = options.nowMs ?? Date.now();
  }

  initialize(manager: FleetManager): void {
    this.manager = manager;
  }

  /** One deterministic upsert pass. Reset = stop + start. */
  start(): void {
    const manager = this.manager;
    if (!manager) return;
    const agents = demoFleetAgents(this.tier, { nowMs: this.nowMs });
    this.upserted = agents.map(agent => agent.id);
    for (const agent of agents) {
      manager.upsertAgent(demoWorkspaceAgent(agent));
    }
  }

  /** Remove every demo Agent so a following transport starts from truth —
   *  demo entities must never linger under another Workspace's identity. */
  stop(): void {
    const manager = this.manager;
    if (!manager) return;
    for (const id of this.upserted.splice(0)) {
      manager.removeAgent(id);
    }
  }
}
