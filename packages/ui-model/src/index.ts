import {
  resolveContextGroups,
  type AgentActivity,
  type AgentStatus,
  type BlockerType,
  type ContextGroup,
  type ContextGroupKind,
  type ExawattAgent,
  type ExawattCronJob,
  type FleetMetrics,
  type FleetState,
} from '@exawatt/core';

export * from './spatial-board';
export * from './roadmap-lens';
export * from './roadmap-strip';
export * from './roadmap-attention';

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

/**
 * An Attention Scheduling item: an operator-queue entry scored by leverage so
 * the surface can route scarce human attention to the highest-leverage moment
 * (not merely the oldest blocker) and explain WHY via `reason`.
 */
export interface AttentionItem extends OperatorQueueItem {
  blockerType: BlockerType;
  /** leverage score: type weight dominates, then age, then in-project fan-out */
  score: number;
  /** blocker age in minutes (0 when `now` is not supplied — keeps it pure) */
  ageMinutes: number;
  /** agents in the same Project that are blocked/error/idle (work stalled around it) */
  stalledInProject: number;
  /** human-readable "why this matters", e.g. "Credentials needed · 50m waiting" */
  reason: string;
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

export type ProjectAttentionTier = 'hero' | 'secondary' | 'calm';

/**
 * A Project / Context Group zone placed on the dimetric war table.
 * Coplanar — every zone rests at y=0; only selected tiles and the hero rail
 * rise in Y. All coordinates are absolute world space (XZ plane, Y up).
 */
export interface SpatialProjectZone {
  clusterId: string;
  kind: ContextGroupKind;
  label: string;
  agentIds: string[]; // status-sorted (from the core resolver)
  agentCount: number;
  activeCount: number;
  blockedCount: number;
  idleCount: number;
  /** worst status in the cluster; lets the focused zone re-derive its rim/tier */
  dominantStatus: AgentStatus;
  costRate: number;
  totalCost: number;
  attentionPressure: number; // 0..1
  /** precomputed front-lip stat string, e.g. "3 agents · 1 blocked · $1.42/hr" */
  statLine: string;
  /** attention tier the whole zone reads at (drives the rim color) */
  tier: ProjectAttentionTier;
  /** true iff this zone owns the single hero blocker (only zone allowed a red rim) */
  ownsHeroBlocker: boolean;
  selected: boolean;
  x: number; // zone center X
  z: number; // zone center Z
  width: number; // footprint along X
  depth: number; // footprint along Z
  tint: string; // frosted body tint
  rimColor: string; // beveled rail emissive (teal/amber/red)
  // ---- V0.2 motion targets (R3F damps toward these; magnitudes stay pure here) ----
  /** resting Y target for the whole zone (0, or zoneLift when selected) */
  liftTarget: number;
  /** 0..1 target for the crystal-edge emphasis (opacity/width on the rim) */
  edgeEmphasisTarget: number;
  /** emissive-intensity target for the metal frame trim (recedes when another zone is selected) */
  frameEmissiveTarget: number;
  // ---- V0.3 zoom-resolution ----
  /** at fleet altitude this zone renders as a compact summary cluster (no agent tiles) */
  summaryMode: boolean;
  // ---- V0.5 fleet-scale ----
  /**
   * true for the synthetic "+N quieter projects" cluster that aggregates the
   * overflow beyond `maxZones` at fleet altitude. Has no agentIds, is not
   * drillable, and renders distinctly. `agentCount`/counts are the summed totals.
   */
  isAggregate: boolean;
}

/** A single agent tile, placed in ABSOLUTE world coords inside its zone. */
export interface SpatialAgentTile {
  id: string; // `tile:${agentId}`
  agentId: string;
  clusterId: string;
  label: string;
  status: AgentStatus;
  statusColor: string;
  needsOperator: boolean;
  active: boolean;
  selected: boolean;
  isHero: boolean; // the hero blocker's tile (lifted + glow-line target)
  /** 0..1 quiet emphasis for emissive; loud only when isHero/selected */
  emphasis: number;
  x: number;
  y: number; // = liftTarget (kept for back-compat / instant + SSR render path)
  z: number;
  width: number;
  height: number; // uniform thickness; NOT a status encoding
  depth: number;
  // ---- V0.2 motion targets (R3F damps restY -> liftTarget; magnitudes stay pure) ----
  /** resting Y (normally 0) the tile damps up from */
  restY: number;
  /** Y target: restY + selectionLift (if selected) + heroLift (if hero) */
  liftTarget: number;
  /** scale target: selectionScale when selected, else 1 */
  targetScale: number;
  /** emissive-emphasis target (= emphasis), named as the damp target */
  emphasisTarget: number;
}

export interface SpatialAttentionItem {
  agentId: string;
  agentName: string;
  clusterId: string;
  title: string;
  description: string;
  type: string;
  createdAt: number;
  suggestedResponses: string[];
  /** world coords of the owning agent's tile, for the connecting glow line */
  tileX: number;
  tileY: number;
  tileZ: number;
  /** world coords of this item's slot on the attention rail (hero card / chip) */
  railX: number;
  railY: number;
  railZ: number;
  /** Attention Scheduling "why": leverage reason for this blocker */
  reason: string;
}

export interface SpatialAttention {
  hero: SpatialAttentionItem | null;
  secondary: SpatialAttentionItem[]; // grouped, quiet
  overflowCount: number; // blockers beyond hero + secondary, for "+N more"
  ambientActiveCount: number; // working + reviewing, for "N working — no action needed"
  /** world position of the "+N more" overflow label on the rail */
  overflowLabelPos: { x: number; y: number; z: number };
  /** world position of the ambient "N working" label on the rail */
  ambientLabelPos: { x: number; y: number; z: number };
}

/**
 * Zoom-resolution altitude. Each level changes information DENSITY, not just
 * scale: 'fleet' = all Projects as summary clusters (no agent tiles); 'project'
 * = one Project's full agent tiles; 'agent' = one agent focused for inspection.
 */
export type Altitude = 'fleet' | 'project' | 'agent';

/** The single layout the canvas consumes. Replaces SpatialAgentNode[]. */
export interface FleetSpatialScene {
  groups: SpatialProjectZone[];
  tiles: SpatialAgentTile[];
  attention: SpatialAttention;
  /** hero connecting-line endpoints (hero rail card -> hero tile), or null */
  heroLink: {
    fromX: number;
    fromY: number;
    fromZ: number;
    toX: number;
    toY: number;
    toZ: number;
  } | null;
  bounds: { width: number; depth: number }; // for camera framing
  selectedAgentId: string | null;
  // ---- V0.3 zoom-resolution ----
  /** resolved altitude (may differ from the requested one if the focus was missing) */
  altitude: Altitude;
  /** focused Project clusterId at project/agent altitude, else null */
  focusedProjectId: string | null;
  /** whether the 3D attention rail should render (hidden at agent altitude) */
  showRail: boolean;
}

export interface FleetSpatialSceneOptions {
  selectedAgentId?: string | null;
  blockerLimit?: number; // default 3 (hero + up to 2 secondary)
  tileSize?: number;
  tileGap?: number;
  zonePadding?: number;
  zoneGap?: number;
  maxTilesPerRow?: number;
  selectionLift?: number;
  heroLift?: number;
  zoneLift?: number;
  selectionScale?: number;
  /** zoom-resolution altitude (default 'fleet') */
  altitude?: Altitude;
  /** focused Project clusterId for 'project' altitude */
  focusedProjectId?: string | null;
  /** current time (unix ms) for Attention Scheduling age scoring; pure when omitted */
  now?: number;
  /**
   * Override the hero agent id used for tile lift. Lets selectFleetSpatialScene
   * scope the hero to the focused Project at project/agent altitude so the
   * lifted tile and the rail/glow-line always agree.
   */
  heroAgentId?: string | null;
  // ---- V0.5 fleet-scale ----
  /** max full Project clusters at fleet altitude before overflow aggregates (default 24) */
  maxZones?: number;
  /** when true, collapse Projects beyond maxZones into one "+N quieter projects" cluster */
  aggregateOverflow?: boolean;
}

export interface FleetCommandViewOptions {
  activityLimit?: number;
  blockerLimit?: number;
  heartbeatJobs?: ExawattCronJob[];
  selectedAgentId?: string | null;
  /** Reference time (unix ms) for leverage-aware attention ordering; pure. */
  now?: number;
}

export interface FleetCommandViewModel {
  agents: FleetAgentView[];
  metrics: FleetMetrics;
  operatorQueue: OperatorQueueItem[];
  activityFeed: ActivityFeedItem[];
  heartbeats: HeartbeatSummary[];
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
  blocked: '#ff1f4b',
  error: '#ff5c7a',
  reviewing: '#fcec0c',
  working: '#55ead4',
  complete: '#6fe39f',
  idle: '#6a7585',
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

export interface FleetFilter {
  /** case-insensitive substring matched against agent name / goal / project */
  query?: string;
  /** if non-empty, only agents whose status is in this set are kept */
  statuses?: AgentStatus[];
}

/**
 * Pure, deterministic narrowing of a FleetState to the agents matching a search
 * query and/or status set. Empty filter returns the original state (identity, so
 * no behavior change when unused). Fleet-wide `metrics` are preserved unchanged —
 * callers that want fleet totals read them from the unfiltered state.
 */
export function filterFleetState(
  state: FleetState,
  filter: FleetFilter = {}
): FleetState {
  const query = filter.query?.trim().toLowerCase() ?? '';
  const statuses =
    filter.statuses && filter.statuses.length
      ? new Set<AgentStatus>(filter.statuses)
      : null;
  if (!query && !statuses) return state;

  const agents: Record<string, ExawattAgent> = {};
  for (const agent of Object.values(state.agents)) {
    if (statuses && !statuses.has(agent.status)) continue;
    if (
      query &&
      !`${agent.name} ${agent.goal} ${agent.project}`
        .toLowerCase()
        .includes(query)
    ) {
      continue;
    }
    agents[agent.id] = agent;
  }
  return { ...state, agents };
}

const GOAL_STOP_WORDS = new Set([
  'a', 'an', 'the', 'of', 'on', 'in', 'up', 'by', 'all', 'its', 'their', 'new',
]);
// Conjunctions/prepositions that end the useful summary once a couple of words
// are in hand (so "Improve onboarding flow and add ..." -> "Improve onboarding flow").
const GOAL_BREAK_WORDS = new Set([
  'and', '&', 'then', 'to', 'for', 'with', 'plus', 'so', 'that',
]);

/**
 * Derive a 2-4 word micro-summary label from an agent goal. Pure + deterministic
 * (no time, no randomness) so it is safe in selectors and unit-testable. Takes
 * the first clause, then keeps up to `maxWords` significant words — breaking at a
 * conjunction once 2+ words are in hand and skipping small stop words — strips
 * trailing punctuation, and title-cases the first word. Falls back to the trimmed
 * goal. Labels agents by what they are DOING, not by a codename.
 */
export function selectShortGoalLabel(goal: string, maxWords = 4): string {
  const cleaned = (goal ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const firstClause = cleaned.split(/[,.;:]/)[0]!.trim() || cleaned;
  const words = firstClause.split(' ').filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    if (kept.length >= maxWords) break;
    const lw = word.toLowerCase().replace(/[^a-z&/]/g, '');
    if (GOAL_BREAK_WORDS.has(lw)) {
      if (kept.length >= 2) break;
      continue;
    }
    if (kept.length > 0 && GOAL_STOP_WORDS.has(lw)) continue;
    kept.push(word);
  }
  if (kept.length === 0) kept.push(...words.slice(0, maxWords));
  const label = kept.join(' ').replace(/[\s,.;:—-]+$/, '');
  return label.charAt(0).toUpperCase() + label.slice(1);
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
      const lastDelta = b.lastActivityAt - a.lastActivityAt;
      if (lastDelta !== 0) return lastDelta;
      return a.id.localeCompare(b.id);
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

// ---- Attention Scheduling (leverage-aware prioritization) ----
//
// Routes scarce human attention to the highest-leverage blocker, not merely the
// oldest one. Pure + deterministic: pass `now` for age scoring (omitted => age 0
// so selectors stay testable). Blocker type dominates the score (credentials /
// approvals gate the most downstream work), then age, then in-Project fan-out.

const ATTENTION_TYPE_WEIGHT: Record<BlockerType, number> = {
  credentials_needed: 5,
  approval_required: 4,
  error: 4,
  input_needed: 2,
  awaiting_agent: 1,
};

const BLOCKER_LABEL: Record<BlockerType, string> = {
  credentials_needed: 'Credentials needed',
  approval_required: 'Approval required',
  error: 'Error',
  input_needed: 'Needs input',
  awaiting_agent: 'Waiting on another agent',
};

const MAX_ATTENTION_AGE_MIN = 240;

function buildAttentionReason(
  type: BlockerType,
  ageMinutes: number,
  stalledInProject: number,
  project: string
): string {
  const label = BLOCKER_LABEL[type] ?? 'Needs operator';
  let reason = `${label} · ${ageMinutes}m waiting`;
  if (stalledInProject > 1) {
    reason += ` · ${stalledInProject} stalled in ${project}`;
  }
  return reason;
}

export interface AttentionScheduleOptions {
  /** current time (unix ms); omitted keeps the selector pure (age = 0) */
  now?: number;
  /** cap the returned schedule length (default: all blocked agents) */
  limit?: number;
}

/**
 * The leverage-ranked attention queue. Deterministic: sorts by score desc, then
 * oldest blocker, then agent id. Each item carries its score and a human reason.
 */
export function selectAttentionSchedule(
  state: FleetState,
  options: AttentionScheduleOptions = {}
): AttentionItem[] {
  const now = options.now;
  const agents = getAgents(state);

  const stalledByProject = new Map<string, number>();
  for (const agent of agents) {
    if (
      agent.status === 'blocked' ||
      agent.status === 'error' ||
      agent.status === 'idle'
    ) {
      stalledByProject.set(
        agent.project,
        (stalledByProject.get(agent.project) ?? 0) + 1
      );
    }
  }

  const scored = agents
    .filter(agent => agent.status === 'blocked' && agent.blockerInfo)
    .map(agent => {
      const blocker = agent.blockerInfo!;
      const blockerType = blocker.type;
      const typeWeight = ATTENTION_TYPE_WEIGHT[blockerType] ?? 2;
      const ageMinutes =
        now != null
          ? Math.min(
              MAX_ATTENTION_AGE_MIN,
              Math.max(0, Math.round((now - blocker.createdAt) / 60000))
            )
          : 0;
      const stalledInProject = stalledByProject.get(agent.project) ?? 0;
      const score = typeWeight * 1000 + ageMinutes + stalledInProject * 10;
      return { agent, blocker, blockerType, ageMinutes, stalledInProject, score };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const createdDelta = a.blocker.createdAt - b.blocker.createdAt;
      if (createdDelta !== 0) return createdDelta;
      return a.agent.id.localeCompare(b.agent.id);
    });

  const limited =
    options.limit != null ? scored.slice(0, options.limit) : scored;

  return limited.map((s, index) => ({
    id: `${s.agent.id}:blocker`,
    agentId: s.agent.id,
    agentName: s.agent.name,
    title: s.blocker.title,
    description: s.blocker.description || s.agent.goal,
    type: s.blockerType,
    blockerType: s.blockerType,
    createdAt: s.blocker.createdAt,
    lastActivityAt: s.agent.lastActivityAt,
    suggestedResponses: s.blocker.suggestedResponses ?? [],
    priority: index,
    score: s.score,
    ageMinutes: s.ageMinutes,
    stalledInProject: s.stalledInProject,
    reason: buildAttentionReason(
      s.blockerType,
      s.ageMinutes,
      s.stalledInProject,
      s.agent.project
    ),
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

// ---- Spatial command surface (dimetric war table) ----
//
// All layout math lives here in pure TypeScript. The R3F components consume
// plain numbers and do zero geometry. Projects are resolved as Context Group
// lenses via @exawatt/core's resolveContextGroups, never stored on FleetState.

const SPATIAL_DEFAULTS = {
  blockerLimit: 3,
  tileSize: 0.6,
  tileGap: 0.18,
  zonePadding: 0.45,
  zoneGap: 0.9,
  maxTilesPerRow: 3,
  selectionLift: 0.35,
  heroLift: 0.5,
  zoneLift: 0.12,
  selectionScale: 1.05,
  maxZones: 24,
} as const;

const TILE_THICKNESS = 0.14;

// Attention-rail placement, derived from scene bounds. Lives here (not in R3F)
// so the rail card, secondary chips, labels, and the hero glow line all share
// one source of truth and can never drift apart.
const RAIL = {
  frontGap: 0.9,
  heroX: 0,
  heroY: 0.6,
  secondaryGap: 1.6,
  secondaryY: 0.18,
  secondaryZOffset: 0.8,
  overflowY: 0.05,
  overflowZOffset: 1.35,
  ambientY: 0.02,
  ambientZOffset: 1.7,
} as const;

const TIER_RIM_COLOR: Record<ProjectAttentionTier, string> = {
  hero: '#f87171',
  secondary: '#fbbf24',
  calm: '#2dd4bf',
};

const ZONE_TINT: Record<ProjectAttentionTier, string> = {
  hero: '#1b1012',
  secondary: '#1a1710',
  calm: '#0e1a1c',
};

function round4(value: number): number {
  return Number(value.toFixed(4));
}

interface ZoneGrid {
  cols: number;
  rows: number;
  innerW: number;
  innerD: number;
  width: number;
  depth: number;
}

function computeZoneGrid(
  agentCount: number,
  tileSize: number,
  tileGap: number,
  zonePadding: number,
  maxTilesPerRow: number
): ZoneGrid {
  const count = Math.max(1, agentCount);
  const cols = Math.min(
    Math.max(Math.ceil(Math.sqrt(count)), 2),
    maxTilesPerRow
  );
  const rows = Math.max(1, Math.ceil(count / cols));
  const innerW = cols * tileSize + (cols - 1) * tileGap;
  const innerD = rows * tileSize + (rows - 1) * tileGap;
  return {
    cols,
    rows,
    innerW,
    innerD,
    width: innerW + 2 * zonePadding,
    depth: innerD + 2 * zonePadding,
  };
}

/** The single highest-leverage blocker's agent id (top of the Attention Schedule). */
function heroAgentId(state: FleetState, now?: number): string | null {
  return selectAttentionSchedule(state, { now, limit: 1 })[0]?.agentId ?? null;
}

function zoneTier(
  ownsHero: boolean,
  blockedCount: number,
  dominantStatus: AgentStatus
): ProjectAttentionTier {
  if (ownsHero) return 'hero';
  if (blockedCount > 0) return 'secondary';
  if (dominantStatus === 'reviewing' || dominantStatus === 'error') {
    return 'secondary';
  }
  return 'calm';
}

// 0..1 emphasis the crystal Project boundary reads at (drives rim opacity/width).
function edgeEmphasisFor(
  tier: ProjectAttentionTier,
  selected: boolean
): number {
  if (tier === 'hero') return selected ? 1.0 : 0.8;
  if (tier === 'secondary') return selected ? 0.7 : 0.45;
  return selected ? 0.4 : 0.15; // calm
}

// Emissive intensity for the metal frame trim. Selecting a zone brightens it;
// while another zone is selected, the rest passively recede.
function frameEmissiveFor(
  tier: ProjectAttentionTier,
  selected: boolean,
  anySelected: boolean
): number {
  const base = tier === 'hero' ? 0.3 : tier === 'secondary' ? 0.16 : 0.07;
  if (selected) return round4(base + 0.25);
  if (anySelected) return round4(Math.max(0, base - 0.04));
  return round4(base);
}

// The synthetic overflow cluster shown at fleet altitude when there are more
// Projects than `maxZones`. Not drillable; counts are summed totals.
const AGGREGATE_CLUSTER_ID = 'aggregate:quieter';

/** Fold the overflow Projects into one summary ContextGroup (summed counts). */
function aggregateGroup(hidden: ContextGroup[]): ContextGroup {
  let agentCount = 0;
  let activeCount = 0;
  let blockedCount = 0;
  let idleCount = 0;
  let costRate = 0;
  let totalCost = 0;
  for (const g of hidden) {
    agentCount += g.summary.agentCount;
    activeCount += g.summary.activeCount;
    blockedCount += g.summary.blockedCount;
    idleCount += g.summary.idleCount;
    costRate += g.summary.costRate;
    totalCost += g.summary.totalCost;
  }
  return {
    clusterId: AGGREGATE_CLUSTER_ID,
    kind: 'project',
    label: `+${hidden.length} quieter projects`,
    agentIds: [],
    summary: {
      agentCount,
      activeCount,
      blockedCount,
      idleCount,
      costRate: round4(costRate),
      totalCost: round4(totalCost),
      attentionPressure: 0,
      dominantStatus: 'idle',
    },
  };
}

export function selectSpatialProjectZones(
  state: FleetState,
  options: FleetSpatialSceneOptions = {}
): SpatialProjectZone[] {
  const tileSize = options.tileSize ?? SPATIAL_DEFAULTS.tileSize;
  const tileGap = options.tileGap ?? SPATIAL_DEFAULTS.tileGap;
  const zonePadding = options.zonePadding ?? SPATIAL_DEFAULTS.zonePadding;
  const zoneGap = options.zoneGap ?? SPATIAL_DEFAULTS.zoneGap;
  const maxTilesPerRow =
    options.maxTilesPerRow ?? SPATIAL_DEFAULTS.maxTilesPerRow;
  const zoneLift = options.zoneLift ?? SPATIAL_DEFAULTS.zoneLift;
  const selectedAgentId = options.selectedAgentId ?? null;
  const heroId = heroAgentId(state, options.now);

  const groups: ContextGroup[] = resolveContextGroups(state);
  const anyZoneSelected =
    selectedAgentId != null &&
    groups.some(group => group.agentIds.includes(selectedAgentId));

  // Highest attention pressure first; then agent count; label asc tiebreak.
  const maxZones = options.maxZones ?? SPATIAL_DEFAULTS.maxZones;
  const sorted = [...groups].sort((a, b) => {
    const delta = b.summary.attentionPressure - a.summary.attentionPressure;
    if (Math.abs(delta) > 1e-9) return delta;
    if (b.summary.agentCount !== a.summary.agentCount)
      return b.summary.agentCount - a.summary.agentCount;
    return a.label.localeCompare(b.label);
  });

  // Fleet-scale: keep the top-N Projects as full clusters and fold the rest into
  // a single "+N quieter projects" summary so the Fleet Map stays readable.
  // Only fold when it collapses 2+ Projects — at exactly maxZones+1 a single
  // overflow Project keeps its own drillable card (folding it would save no
  // space yet make a real Project unreachable).
  const effectiveGroups =
    options.aggregateOverflow && sorted.length > maxZones + 1
      ? [...sorted.slice(0, maxZones), aggregateGroup(sorted.slice(maxZones))]
      : sorted;

  const withGrid = effectiveGroups.map(group => ({
    group,
    grid: computeZoneGrid(
      group.agentIds.length,
      tileSize,
      tileGap,
      zonePadding,
      maxTilesPerRow
    ),
  }));

  const n = withGrid.length;
  if (n === 0) return [];

  // Single row for a few zones; wrap into a grid beyond 4 (survives 5-8+).
  const cols = n <= 4 ? n : Math.ceil(Math.sqrt(n));
  const rows: Array<typeof withGrid> = [];
  for (let i = 0; i < n; i += cols) rows.push(withGrid.slice(i, i + cols));

  const rowDims = rows.map(row => ({
    row,
    rowWidth:
      row.reduce((sum, z) => sum + z.grid.width, 0) +
      zoneGap * (row.length - 1),
    rowDepth: Math.max(...row.map(z => z.grid.depth)),
  }));

  const totalDepth =
    rowDims.reduce((sum, r) => sum + r.rowDepth, 0) +
    zoneGap * (rowDims.length - 1);

  const placed: SpatialProjectZone[] = [];
  // Front (+Z, nearest camera) holds the highest-pressure row; rows recede.
  let zStart = totalDepth / 2;
  for (const { row, rowWidth, rowDepth } of rowDims) {
    const rowCenterZ = zStart - rowDepth / 2;
    let xCursor = -rowWidth / 2;
    for (const { group, grid } of row) {
      const x = xCursor + grid.width / 2;
      const s = group.summary;
      const isAggregate = group.clusterId === AGGREGATE_CLUSTER_ID;
      const ownsHero =
        !isAggregate && heroId != null && group.agentIds.includes(heroId);
      const tier = isAggregate
        ? 'calm'
        : zoneTier(ownsHero, s.blockedCount, s.dominantStatus);
      const selected =
        selectedAgentId != null && group.agentIds.includes(selectedAgentId);
      const agentWord = s.agentCount === 1 ? 'agent' : 'agents';
      placed.push({
        clusterId: group.clusterId,
        kind: group.kind,
        label: group.label,
        agentIds: group.agentIds,
        agentCount: s.agentCount,
        activeCount: s.activeCount,
        blockedCount: s.blockedCount,
        idleCount: s.idleCount,
        dominantStatus: s.dominantStatus,
        costRate: s.costRate,
        totalCost: s.totalCost,
        attentionPressure: s.attentionPressure,
        statLine: `${s.agentCount} ${agentWord} · ${s.blockedCount} blocked · $${s.costRate.toFixed(2)}/hr`,
        tier,
        ownsHeroBlocker: ownsHero,
        selected,
        x: round4(x),
        z: round4(rowCenterZ),
        width: round4(grid.width),
        depth: round4(grid.depth),
        tint: ZONE_TINT[tier],
        rimColor: TIER_RIM_COLOR[tier],
        liftTarget: selected ? round4(zoneLift) : 0,
        edgeEmphasisTarget: round4(edgeEmphasisFor(tier, selected)),
        frameEmissiveTarget: frameEmissiveFor(tier, selected, anyZoneSelected),
        summaryMode: false,
        isAggregate,
      });
      xCursor += grid.width + zoneGap;
    }
    zStart -= rowDepth + zoneGap;
  }

  return placed;
}

export function selectSpatialAgentTiles(
  zones: SpatialProjectZone[],
  state: FleetState,
  options: FleetSpatialSceneOptions = {}
): SpatialAgentTile[] {
  const tileSize = options.tileSize ?? SPATIAL_DEFAULTS.tileSize;
  const tileGap = options.tileGap ?? SPATIAL_DEFAULTS.tileGap;
  const zonePadding = options.zonePadding ?? SPATIAL_DEFAULTS.zonePadding;
  const maxTilesPerRow =
    options.maxTilesPerRow ?? SPATIAL_DEFAULTS.maxTilesPerRow;
  const selectionLift = options.selectionLift ?? SPATIAL_DEFAULTS.selectionLift;
  const heroLift = options.heroLift ?? SPATIAL_DEFAULTS.heroLift;
  const selectionScale =
    options.selectionScale ?? SPATIAL_DEFAULTS.selectionScale;
  const selectedAgentId = options.selectedAgentId ?? null;
  // Altitude-scoped hero: selectFleetSpatialScene passes the focused Project's
  // hero at project/agent altitude so the lifted tile matches the rail hero.
  const heroId =
    options.heroAgentId !== undefined
      ? options.heroAgentId
      : heroAgentId(state, options.now);

  const tiles: SpatialAgentTile[] = [];
  for (const zone of zones) {
    const grid = computeZoneGrid(
      zone.agentIds.length,
      tileSize,
      tileGap,
      zonePadding,
      maxTilesPerRow
    );
    const leftX = zone.x - grid.innerW / 2 + tileSize / 2;
    const frontZ = zone.z - grid.innerD / 2 + tileSize / 2;
    zone.agentIds.forEach((agentId, index) => {
      const agent = state.agents[agentId];
      if (!agent) return;
      const col = index % grid.cols;
      const row = Math.floor(index / grid.cols);
      const selected = agentId === selectedAgentId;
      const isHero = agentId === heroId;
      const needsOperator = agent.status === 'blocked';
      const active = agent.status === 'working' || agent.status === 'reviewing';
      const emphasis =
        isHero || selected ? 1 : needsOperator ? 0.5 : active ? 0.35 : 0.15;
      const restY = 0;
      const liftTarget =
        restY + (selected ? selectionLift : 0) + (isHero ? heroLift : 0);
      tiles.push({
        id: `tile:${agentId}`,
        agentId,
        clusterId: zone.clusterId,
        label: selectShortGoalLabel(agent.goal) || agent.name,
        status: agent.status,
        statusColor: STATUS_COLORS[agent.status],
        needsOperator,
        active,
        selected,
        isHero,
        emphasis,
        x: round4(leftX + col * (tileSize + tileGap)),
        y: round4(liftTarget), // = liftTarget (back-compat / instant + SSR path)
        z: round4(frontZ + row * (tileSize + tileGap)),
        width: tileSize,
        height: TILE_THICKNESS,
        depth: tileSize,
        restY,
        liftTarget: round4(liftTarget),
        targetScale: selected ? selectionScale : 1,
        emphasisTarget: emphasis,
      });
    });
  }
  return tiles;
}

export function selectSpatialAttention(
  state: FleetState,
  tiles: SpatialAgentTile[],
  options: FleetSpatialSceneOptions = {},
  bounds: { width: number; depth: number } = { width: 0, depth: 0 }
): SpatialAttention {
  const blockerLimit = options.blockerLimit ?? SPATIAL_DEFAULTS.blockerLimit;
  // Hero/secondary follow the leverage-aware Attention Schedule, not raw age.
  const fullQueue = selectAttentionSchedule(state, { now: options.now });
  const tileByAgent = new Map(tiles.map(tile => [tile.agentId, tile]));
  const frontZ = bounds.depth / 2 + RAIL.frontGap;

  const toItem = (
    q: AttentionItem,
    rail: { x: number; y: number; z: number }
  ): SpatialAttentionItem => {
    const tile = tileByAgent.get(q.agentId);
    return {
      agentId: q.agentId,
      agentName: q.agentName,
      clusterId: tile?.clusterId ?? '',
      title: q.title,
      description: q.description,
      type: q.type,
      createdAt: q.createdAt,
      suggestedResponses: q.suggestedResponses,
      tileX: tile?.x ?? 0,
      tileY: tile?.y ?? 0,
      tileZ: tile?.z ?? 0,
      railX: round4(rail.x),
      railY: round4(rail.y),
      railZ: round4(rail.z),
      reason: q.reason,
    };
  };

  const hero = fullQueue.length
    ? toItem(fullQueue[0]!, { x: RAIL.heroX, y: RAIL.heroY, z: frontZ })
    : null;
  const secondaryLimit = Math.max(0, blockerLimit - 1);
  const secondaryQueue = fullQueue.slice(1, 1 + secondaryLimit);
  const secondary = secondaryQueue.map((q, index) =>
    toItem(q, {
      x: (index - (secondaryQueue.length - 1) / 2) * RAIL.secondaryGap,
      y: RAIL.secondaryY,
      z: frontZ + RAIL.secondaryZOffset,
    })
  );
  const overflowCount = Math.max(
    0,
    fullQueue.length - (1 + secondary.length)
  );

  let ambientActiveCount = 0;
  for (const agent of getAgents(state)) {
    if (agent.status === 'working' || agent.status === 'reviewing') {
      ambientActiveCount++;
    }
  }

  return {
    hero,
    secondary,
    overflowCount,
    ambientActiveCount,
    overflowLabelPos: {
      x: 0,
      y: RAIL.overflowY,
      z: round4(frontZ + RAIL.overflowZOffset),
    },
    ambientLabelPos: {
      x: 0,
      y: RAIL.ambientY,
      z: round4(frontZ + RAIL.ambientZOffset),
    },
  };
}

function boundsOf(zones: SpatialProjectZone[]): { width: number; depth: number } {
  let halfWidth = 0;
  let halfDepth = 0;
  for (const zone of zones) {
    halfWidth = Math.max(halfWidth, Math.abs(zone.x) + zone.width / 2);
    halfDepth = Math.max(halfDepth, Math.abs(zone.z) + zone.depth / 2);
  }
  return { width: round4(halfWidth * 2), depth: round4(halfDepth * 2) };
}

/** A FleetState narrowed to a set of agent ids (for project-scoped attention). */
function subState(state: FleetState, agentIds: string[]): FleetState {
  const agents: Record<string, ExawattAgent> = {};
  for (const id of agentIds) {
    const a = state.agents[id];
    if (a) agents[id] = a;
  }
  return { agents, metrics: state.metrics, lastUpdated: state.lastUpdated };
}

function heroLinkFor(attention: SpatialAttention): FleetSpatialScene['heroLink'] {
  if (!attention.hero) return null;
  return {
    fromX: attention.hero.railX,
    fromY: attention.hero.railY,
    fromZ: attention.hero.railZ,
    toX: attention.hero.tileX,
    toY: round4(attention.hero.tileY + 0.2),
    toZ: attention.hero.tileZ,
  };
}

/**
 * Master spatial selector — REPLACES selectSpatialAgentLayout.
 *
 * Branches by zoom-resolution altitude so each level changes information
 * DENSITY, not just scale:
 *  - fleet:   every Project as a summary cluster, NO agent tiles.
 *  - project: only the focused Project, re-centered, with its full agent tiles.
 *  - agent:   the focused agent's Project centered with the agent lifted; the
 *             3D rail is hidden (the DOM inspector takes over).
 * If the requested altitude's focus target is missing (stale URL, agent gone),
 * it gracefully ascends to fleet.
 */
export function selectFleetSpatialScene(
  state: FleetState,
  options: FleetSpatialSceneOptions = {}
): FleetSpatialScene {
  const selectedAgentId = options.selectedAgentId ?? null;
  const allZones = selectSpatialProjectZones(state, options);

  let altitude: Altitude = options.altitude ?? 'fleet';
  let focusedProjectId = options.focusedProjectId ?? null;

  if (altitude === 'agent') {
    const owner = selectedAgentId
      ? allZones.find(zone => zone.agentIds.includes(selectedAgentId))
      : undefined;
    if (owner) focusedProjectId = owner.clusterId;
    else altitude = 'fleet';
  } else if (altitude === 'project') {
    if (
      !focusedProjectId ||
      !allZones.some(zone => zone.clusterId === focusedProjectId)
    ) {
      altitude = 'fleet';
      focusedProjectId = null;
    }
  }

  // ---- Fleet altitude: summary clusters, no agent tiles (the density drop) ----
  if (altitude === 'fleet') {
    // Fold Projects beyond maxZones into one "+N quieter projects" cluster so the
    // Fleet Map stays legible at scale; the top-N keep their full summary cards.
    const groups = selectSpatialProjectZones(state, {
      ...options,
      aggregateOverflow: true,
    }).map(zone => ({ ...zone, summaryMode: true }));
    const bounds = boundsOf(groups);
    return {
      groups,
      tiles: [],
      attention: selectSpatialAttention(state, [], options, bounds),
      heroLink: null, // no agent tiles to connect to at fleet altitude
      bounds,
      selectedAgentId,
      altitude: 'fleet',
      focusedProjectId: null,
      showRail: true,
    };
  }

  // ---- Project / Agent altitude: one focused zone, re-centered, full tiles ----
  const focused = allZones.find(zone => zone.clusterId === focusedProjectId)!;
  // Scope the hero to the focused Project so the lifted tile, the rail hero, the
  // glow line, AND the zone rim/tier all reference the same (project-scoped)
  // agent — not the fleet-wide hero that selectSpatialProjectZones baked in.
  const projectState = subState(state, focused.agentIds);
  const projectHeroId = heroAgentId(projectState, options.now);
  const ownsHero =
    projectHeroId != null && focused.agentIds.includes(projectHeroId);
  const tier = zoneTier(ownsHero, focused.blockedCount, focused.dominantStatus);
  const centered: SpatialProjectZone = {
    ...focused,
    x: 0,
    z: 0,
    summaryMode: false,
    tier,
    ownsHeroBlocker: ownsHero,
    tint: ZONE_TINT[tier],
    rimColor: TIER_RIM_COLOR[tier],
    edgeEmphasisTarget: round4(edgeEmphasisFor(tier, focused.selected)),
    frameEmissiveTarget: frameEmissiveFor(
      tier,
      focused.selected,
      focused.selected
    ),
  };
  const groups = [centered];
  const tiles = selectSpatialAgentTiles(groups, state, {
    ...options,
    heroAgentId: projectHeroId,
  });
  const bounds = boundsOf(groups);
  const showRail = altitude === 'project';
  // Attention is scoped to the focused Project (its own blockers / active count).
  const attention = selectSpatialAttention(projectState, tiles, options, bounds);

  return {
    groups,
    tiles,
    attention,
    heroLink: showRail ? heroLinkFor(attention) : null,
    bounds,
    selectedAgentId,
    altitude,
    focusedProjectId,
    showRail,
  };
}

export function selectFleetCommandView(
  state: FleetState,
  options: FleetCommandViewOptions = {}
): FleetCommandViewModel {
  const agents = selectSortedAgents(state);
  // Order the operator queue by the leverage-aware attention schedule so the DOM
  // /fleet panel agrees with the spatial hero and the Clear-Blocker CTA (one model).
  const operatorQueue = selectAttentionSchedule(state, {
    now: options.now,
    limit: options.blockerLimit ?? 3,
  });

  return {
    agents,
    metrics: state.metrics,
    operatorQueue,
    activityFeed: selectActivityFeed(state, options.activityLimit),
    heartbeats: selectHeartbeatSummaries(options.heartbeatJobs, state),
    selectedAgentId: options.selectedAgentId ?? null,
    // The DOM /fleet and the spatial surface agree on "the most important
    // blocker" by sharing the leverage-aware attention schedule (not raw age).
    nextBlockedAgentId:
      selectAttentionSchedule(state, { now: options.now, limit: 1 })[0]
        ?.agentId ?? null,
    activeAgentCount: agents.filter(agent => agent.active).length,
    blockedAgentCount: operatorQueue.length,
    lastUpdated: state.lastUpdated,
  };
}

// ---- Transmission budget (rule 5) ----
//
// Pure presentation policy for the dimetric surface's "liquid glass" cap: at
// most 2 live MeshTransmissionMaterial surfaces, exactly 1 at rest (the hero
// card). The selected agent's tile takes the 2nd slot only when an agent is
// selected AND it is not the hero (the hero is already glass on the rail card —
// never glass on both for one agent). On a low-power/degraded device everything
// falls back to frosted (0 transmissive). Pure TS so it is unit-tested without
// React/Three.
//
// V0.2 note: the metal frames/rails and the crystal Project boundaries are
// NON-transmissive fakes (metalness/clearcoat/emissive + Edges), so they add
// zero render passes and the <=2 / 1-at-rest cap above remains the only budget.

export interface TransmissionPlan {
  heroCardGlass: boolean;
  selectedTileGlassAgentId: string | null;
}

export function resolveTransmission(
  scene: FleetSpatialScene,
  degraded: boolean
): TransmissionPlan {
  const heroId = scene.attention.hero?.agentId ?? null;
  const selectedId = scene.selectedAgentId;
  const heroCardGlass = !degraded && heroId != null;
  const selectedTileGlassAgentId =
    !degraded && selectedId != null && selectedId !== heroId
      ? selectedId
      : null;
  return { heroCardGlass, selectedTileGlassAgentId };
}
