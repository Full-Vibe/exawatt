/**
 * Exawatt Agent Types
 * Core data model for agents — independent of OpenClaw types
 */

export type AgentStatus =
  | 'working'
  | 'blocked'
  | 'idle'
  | 'reviewing'
  | 'complete'
  | 'error';

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

export interface ExawattAgent {
  id: string;
  name: string;
  status: AgentStatus;
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
