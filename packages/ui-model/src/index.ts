import type {
  AgentActivity,
  AgentStatus,
  ExawattAgent,
  ExawattCronJob,
  FleetMetrics,
  FleetState,
} from '@exawatt/core';

export type FleetSurfaceMode = 'dom' | 'spatial';

export type FleetCommandErrorCode =
  | 'agent_not_found'
  | 'source_unavailable'
  | 'command_rejected'
  | 'unknown';

export interface FleetCommandError {
  code: FleetCommandErrorCode;
  message: string;
  recoverable: boolean;
}

export type CommandResult<T = void> =
  | { ok: true; value: T }
  | { ok: false; error: FleetCommandError };

export interface FleetCommandActions {
  selectAgent: (agentId: string | null) => CommandResult;
  openAgentFocus: (agentId: string) => CommandResult;
  sendMessage: (agentId: string, text: string) => Promise<CommandResult>;
  resolveBlocker: (
    agentId: string,
    response: string
  ) => Promise<CommandResult>;
  abortAgent: (agentId: string) => Promise<CommandResult>;
  runHeartbeat: (jobId: string) => Promise<CommandResult>;
  connectSource: () => Promise<CommandResult>;
}

export interface FleetAgentView {
  id: string;
  name: string;
  status: AgentStatus;
  goal: string;
  project: string;
  sessionKey: string;
  lastActivityAt: number;
  cost: number;
  costRate: number;
  tokenRate: number;
  turnCount: number;
  activityCount: number;
  hasHeartbeat: boolean;
  cronJobId?: string;
  blockerTitle?: string;
  blockerDescription?: string;
  needsOperator: boolean;
  active: boolean;
  statusRank: number;
}

export interface OperatorQueueItem {
  id: string;
  agentId: string;
  agentName: string;
  title: string;
  description: string;
  type: string;
  createdAt: number;
  lastActivityAt: number;
  suggestedResponses: string[];
  priority: number;
}

export interface ActivityFeedItem {
  id: string;
  agentId: string;
  agentName: string;
  type: AgentActivity['type'];
  content: string;
  timestamp: number;
  tone: 'neutral' | 'active' | 'warning' | 'success';
}

export interface HeartbeatSummary {
  id: string;
  name: string;
  enabled: boolean;
  status: ExawattCronJob['status'];
  schedule: string;
  prompt: string;
  agentId?: string;
  lastRun?: number;
  nextRun?: number;
}

export interface SpatialAgentNode {
  id: string;
  agentId: string;
  label: string;
  status: AgentStatus;
  x: number;
  y: number;
  z: number;
  radius: number;
  emphasis: number;
  color: string;
  ring: number;
  orbitIndex: number;
  selected: boolean;
  needsOperator: boolean;
  active: boolean;
  costRate: number;
}

export interface SpatialLayoutOptions {
  selectedAgentId?: string | null;
  radiusStep?: number;
  verticalStep?: number;
}

export interface FleetCommandViewOptions extends SpatialLayoutOptions {
  activityLimit?: number;
  blockerLimit?: number;
  heartbeatJobs?: ExawattCronJob[];
  selectedAgentId?: string | null;
}

export interface FleetCommandViewModel {
  agents: FleetAgentView[];
  metrics: FleetMetrics;
  operatorQueue: OperatorQueueItem[];
  activityFeed: ActivityFeedItem[];
  heartbeats: HeartbeatSummary[];
  spatialNodes: SpatialAgentNode[];
  selectedAgentId: string | null;
  nextBlockedAgentId: string | null;
  activeAgentCount: number;
  blockedAgentCount: number;
  lastUpdated: number;
}

export const STATUS_PRIORITY: Record<AgentStatus, number> = {
  blocked: 0,
  error: 0,
  reviewing: 1,
  working: 2,
  complete: 3,
  idle: 4,
};

export const STATUS_COLORS: Record<AgentStatus, string> = {
  blocked: '#f87171',
  error: '#fb7185',
  reviewing: '#fbbf24',
  working: '#2dd4bf',
  complete: '#86efac',
  idle: '#71717a',
};

const ACTIVITY_TONES: Record<AgentActivity['type'], ActivityFeedItem['tone']> = {
  status_change: 'neutral',
  chat_message: 'active',
  tool_use: 'active',
  blocker_created: 'warning',
  blocker_resolved: 'success',
};

function getAgents(state: FleetState): ExawattAgent[] {
  return Object.values(state.agents);
}

function sortAgents(a: ExawattAgent, b: ExawattAgent): number {
  const priorityDelta = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
  if (priorityDelta !== 0) return priorityDelta;
  if (b.lastActivityAt !== a.lastActivityAt) {
    return b.lastActivityAt - a.lastActivityAt;
  }
  return a.name.localeCompare(b.name);
}

function toAgentView(agent: ExawattAgent): FleetAgentView {
  const needsOperator = agent.status === 'blocked';
  const active = agent.status === 'working' || agent.status === 'reviewing';

  return {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    goal: agent.goal,
    project: agent.project,
    sessionKey: agent.sessionKey,
    lastActivityAt: agent.lastActivityAt,
    cost: agent.metrics.estimatedCost,
    costRate: agent.metrics.costRate,
    tokenRate: agent.metrics.tokenRate,
    turnCount: agent.metrics.turnCount,
    activityCount: agent.activities?.length ?? 0,
    hasHeartbeat: Boolean(agent.cronJobId),
    cronJobId: agent.cronJobId,
    blockerTitle: agent.blockerInfo?.title,
    blockerDescription: agent.blockerInfo?.description,
    needsOperator,
    active,
    statusRank: STATUS_PRIORITY[agent.status],
  };
}

export function selectSortedAgents(state: FleetState): FleetAgentView[] {
  return getAgents(state).sort(sortAgents).map(toAgentView);
}

export function selectOperatorQueue(
  state: FleetState,
  limit = 3
): OperatorQueueItem[] {
  return getAgents(state)
    .filter(agent => agent.status === 'blocked' && agent.blockerInfo)
    .sort((a, b) => {
      const createdDelta =
        (a.blockerInfo?.createdAt ?? 0) - (b.blockerInfo?.createdAt ?? 0);
      if (createdDelta !== 0) return createdDelta;
      return b.lastActivityAt - a.lastActivityAt;
    })
    .slice(0, limit)
    .map((agent, index) => ({
      id: `${agent.id}:blocker`,
      agentId: agent.id,
      agentName: agent.name,
      title: agent.blockerInfo?.title ?? 'Needs operator',
      description: agent.blockerInfo?.description ?? agent.goal,
      type: agent.blockerInfo?.type ?? 'input_needed',
      createdAt: agent.blockerInfo?.createdAt ?? agent.lastActivityAt,
      lastActivityAt: agent.lastActivityAt,
      suggestedResponses: agent.blockerInfo?.suggestedResponses ?? [],
      priority: index,
    }));
}

export function selectActivityFeed(
  state: FleetState,
  limit = 4
): ActivityFeedItem[] {
  return getAgents(state)
    .flatMap(agent =>
      (agent.activities ?? []).map(activity => ({
        id: activity.id,
        agentId: agent.id,
        agentName: agent.name,
        type: activity.type,
        content: activity.content,
        timestamp: activity.timestamp,
        tone: ACTIVITY_TONES[activity.type],
      }))
    )
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function selectHeartbeatSummaries(
  jobs: ExawattCronJob[] = [],
  state?: FleetState
): HeartbeatSummary[] {
  const agentByCronJob = new Map<string, ExawattAgent>();
  if (state) {
    for (const agent of getAgents(state)) {
      if (agent.cronJobId) agentByCronJob.set(agent.cronJobId, agent);
    }
  }

  return [...jobs]
    .sort((a, b) => {
      const enabledDelta = Number(b.enabled) - Number(a.enabled);
      if (enabledDelta !== 0) return enabledDelta;
      return a.name.localeCompare(b.name);
    })
    .map(job => ({
      id: job.id,
      name: job.name,
      enabled: job.enabled,
      status: job.status,
      schedule: job.schedule,
      prompt: job.prompt,
      agentId: agentByCronJob.get(job.id)?.id,
      lastRun: job.lastRun,
      nextRun: job.nextRun,
    }));
}

export function selectSpatialAgentLayout(
  state: FleetState,
  options: SpatialLayoutOptions = {}
): SpatialAgentNode[] {
  const radiusStep = options.radiusStep ?? 2.65;
  const verticalStep = options.verticalStep ?? 0.42;
  const sorted = getAgents(state).sort(sortAgents);

  return sorted.map((agent, index) => {
    const ring = Math.floor(index / 8);
    const itemsInRing = Math.min(8 + ring * 4, Math.max(1, sorted.length));
    const indexInRing = index % itemsInRing;
    const angle = (indexInRing / itemsInRing) * Math.PI * 2 + ring * 0.31;
    const radius = 1.75 + ring * radiusStep;
    const selected = options.selectedAgentId === agent.id;
    const needsOperator = agent.status === 'blocked';
    const active = agent.status === 'working' || agent.status === 'reviewing';
    const emphasis = selected ? 1 : needsOperator ? 0.82 : active ? 0.68 : 0.42;

    return {
      id: `spatial:${agent.id}`,
      agentId: agent.id,
      label: agent.name,
      status: agent.status,
      x: Number((Math.cos(angle) * radius).toFixed(4)),
      y: Number(((STATUS_PRIORITY[agent.status] - 2) * verticalStep).toFixed(4)),
      z: Number((Math.sin(angle) * radius).toFixed(4)),
      radius: Number((0.28 + emphasis * 0.18).toFixed(4)),
      emphasis,
      color: STATUS_COLORS[agent.status],
      ring,
      orbitIndex: indexInRing,
      selected,
      needsOperator,
      active,
      costRate: agent.metrics.costRate,
    };
  });
}

export function selectFleetCommandView(
  state: FleetState,
  options: FleetCommandViewOptions = {}
): FleetCommandViewModel {
  const agents = selectSortedAgents(state);
  const operatorQueue = selectOperatorQueue(state, options.blockerLimit);

  return {
    agents,
    metrics: state.metrics,
    operatorQueue,
    activityFeed: selectActivityFeed(state, options.activityLimit),
    heartbeats: selectHeartbeatSummaries(options.heartbeatJobs, state),
    spatialNodes: selectSpatialAgentLayout(state, options),
    selectedAgentId: options.selectedAgentId ?? null,
    nextBlockedAgentId: operatorQueue[0]?.agentId ?? null,
    activeAgentCount: agents.filter(agent => agent.active).length,
    blockedAgentCount: operatorQueue.length,
    lastUpdated: state.lastUpdated,
  };
}
