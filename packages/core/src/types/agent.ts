/**
 * Exawatt Agent Types
 * Core data model for agents — independent of OpenClaw types
 */

import type { AgentSourceAdapterId } from '../agent-sources';
import type { AgentSourcePlacement } from '../agent-projection';
import type { SourceConnectionState } from '../sources/connected-source';

/**
 * D40's WORK vocabulary: the six things a coworker can be doing.
 *
 * Every member is a claim about work, so the union deliberately has no member
 * for "nobody said". Unknown is the ABSENCE of a work state, not one more of
 * them, and a source that reported nothing must not be given a word from this
 * list. `AgentWorkState` is where that absence lives.
 *
 * The runtime vocabulary below is the source of this union, so adding a state
 * is one edit that then fails to compile at every consumer.
 */
export const AGENT_STATUSES = [
  'working',
  'blocked',
  'idle',
  'reviewing',
  'complete',
  'error',
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * A work state, or the source's silence about it (ENG-010).
 *
 * `null` means the projection kernel found no evidence of any work state.
 * That is not idle. Idle is a coworker that is quietly waiting, which is
 * something a source has to actually report; `null` is Exawatt having been
 * told nothing, and every surface must render it as nothing rather than as
 * the quietest available claim. The kernel returns it, the main process
 * carries it, and this is the type that lets the renderer keep it instead of
 * coercing it into a lie.
 */
export type AgentWorkState = AgentStatus | null;

/**
 * Compile-time proof that a branch covered every work state, including the
 * absence of one. A new member of `AGENT_STATUSES` stops being assignable to
 * `never` here, so every switch that buckets work states has to be visited
 * before the union can widen.
 */
export function exhaustiveWorkState(status: never): never {
  throw new Error(`unhandled work state: ${String(status)}`);
}

/** Optional Session-backed runtime state. Provider-native Agents may omit it;
 * local terminal Agents use it to preserve stopped-but-owned Sessions. */
export type AgentSessionState = 'live' | 'stopped';

export type BlockerType =
  | 'input_needed'
  | 'approval_required'
  | 'credentials_needed'
  | 'error'
  | 'awaiting_agent';

export interface AgentBlocker {
  type: BlockerType;
  title: string;
  description: string;
  suggestedResponses?: string[];
  createdAt: number; // unix ms
}

export interface CostSnapshot {
  timestamp: number; // unix ms
  cumulativeCost: number; // USD
}

export interface AgentMetrics {
  tokensIn: number;
  tokensOut: number;
  estimatedCost: number; // total USD spent
  turnCount: number;
  startedAt: number | null; // unix ms
  duration: number; // ms since startedAt
  costRate: number; // $/hr rolling avg over last 10 min
  tokenRate: number; // tokens/min rolling avg
  costHistory: CostSnapshot[];
  /**
   * Consumption attribution (ENG-008): raw token total across every unit
   * (input, output, cache read, cache write), inclusive of delegated runs.
   * ABSENT when the source reports no usage breakdown — never zero, per the
   * consumption honesty rule. The live local transport leaves it unset today.
   */
  rawTokens?: number;
  /**
   * Model-size-weighted token total — the E3 compute proxy from
   * `consumption/model-weights.ts` — inclusive of delegated runs. Absent,
   * never zero, when unreported.
   */
  normalizedTokens?: number;
}

export interface AgentActivity {
  id: string;
  timestamp: number; // unix ms
  type:
    | 'status_change'
    | 'chat_message'
    | 'tool_use'
    | 'blocker_created'
    | 'blocker_resolved';
  content: string;
  metadata?: Record<string, unknown>;
}

/** One delegated child reported by the Session's harness (ENG-023 D3). */
export interface AgentDelegatedChild {
  id: string;
  /** the source's own agent kind ("Explore", "general-purpose", …) */
  agentType: string | null;
  /** operator-legible spawn label; null when the source reported none */
  description?: string | null;
  startedAt: number;
}

/**
 * Harness-reported delegation (ENG-023 D3). Absent means the source does not
 * report delegation — which every surface must render as absent, never as an
 * empty list meaning zero.
 */
export interface AgentDelegation {
  children: AgentDelegatedChild[];
}

/**
 * Where a coworker runs, and how current Exawatt's view of it is (ENG-010 C2).
 *
 * Absent means Local and directly observed: a terminal Agent on this machine
 * has no connection to lose, so it needs no freshness lens. Read
 * `agent.presence?.placement ?? 'local'` rather than branching on remoteness.
 *
 * Three signals stay independent here on purpose. `placement` is an
 * infrastructure fact, `connection` is observation freshness, and
 * `ExawattAgent.status` remains the D40 work state. A surface must never let
 * one borrow the other's colour, and nothing in this object may be read as a
 * claim that remote work stopped, paused, or ended.
 */
export interface AgentPresence {
  placement: AgentSourcePlacement;
  /** `Local` | `Remote` | `Exawatt Cloud`. Quiet secondary metadata. */
  placementLabel: string;
  connection: SourceConnectionState;
  /** `Live` | `Reconnecting` | `Stale` | `Unavailable`. */
  connectionLabel: string;
  /** True while Exawatt must not present its cached view as current. */
  stalePresentation: boolean;
  /** The configured Agent Source this coworker was projected from. */
  source: {
    id: string;
    displayName: string;
    adapterId: AgentSourceAdapterId;
  };
}

export interface ExawattAgent {
  id: string;
  name: string;
  /**
   * The work state, or `null` when the source has evidenced none (ENG-010).
   *
   * Read it through `workStateReading` in the status-light protocol rather
   * than defaulting it: `status ?? 'idle'` is the specific lie this type
   * exists to make unwritable.
   */
  status: AgentWorkState;
  goal: string;
  /** Source-owned stable Project identity. `project` remains the display label. */
  projectId?: string;
  project: string;
  sessionKey: string; // source-owned runtime or durable Session reference
  sessionState?: AgentSessionState;
  cronJobId?: string; // OC cron job ID if scheduled
  metrics: AgentMetrics;
  lastActivityAt: number; // unix ms
  blockerInfo?: AgentBlocker;
  /** harness-reported delegated children; absent when unreported (ENG-023) */
  delegation?: AgentDelegation | null;
  createdAt: number; // unix ms
  activities?: AgentActivity[];
  /** placement + observation freshness; absent means Local (ENG-010 C2) */
  presence?: AgentPresence;
}

/**
 * Factory: Initial metrics state
 */
export const INITIAL_AGENT_METRICS: AgentMetrics = {
  tokensIn: 0,
  tokensOut: 0,
  estimatedCost: 0,
  turnCount: 0,
  startedAt: null,
  duration: 0,
  costRate: 0,
  tokenRate: 0,
  costHistory: [],
};

/**
 * Factory: Create an agent with defaults
 */
export function createAgent(
  partial: Partial<ExawattAgent> & { id: string; name: string }
): ExawattAgent {
  return {
    // Exawatt is the source for an Agent it just created, and it knows this
    // one has not been given work yet. That is evidence, so `idle` is a
    // report here rather than a default standing in for one.
    status: 'idle',
    goal: '',
    project: '',
    sessionKey: '',
    metrics: { ...INITIAL_AGENT_METRICS },
    lastActivityAt: Date.now(),
    createdAt: Date.now(),
    ...partial,
  };
}
