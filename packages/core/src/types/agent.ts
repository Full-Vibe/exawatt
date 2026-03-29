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

export interface ExawattAgent {
  id: string;
  name: string;
  status: AgentStatus;
  goal: string;
  project: string;
  sessionKey: string; // OC session key (internal)
  cronJobId?: string; // OC cron job ID if scheduled
  metrics: AgentMetrics;
  lastActivityAt: number; // unix ms
  blockerInfo?: AgentBlocker;
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
