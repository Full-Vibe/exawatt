import {
  resolveContextGroups,
  type AgentActivity,
  type AgentStatus,
  type ContextGroup,
  type ContextGroupKind,
  type ExawattAgent,
  type ExawattCronJob,
  type FleetMetrics,
  type FleetState,
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
}

export interface FleetCommandViewOptions {
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

/** The single highest-leverage blocker's agent id (oldest blocker), or null. */
function heroAgentId(state: FleetState): string | null {
  return selectOperatorQueue(state, 1)[0]?.agentId ?? null;
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
  const heroId = heroAgentId(state);

  const groups: ContextGroup[] = resolveContextGroups(state);
  const anyZoneSelected =
    selectedAgentId != null &&
    groups.some(group => group.agentIds.includes(selectedAgentId));

  // Highest attention pressure first; label asc tiebreak (stable, deterministic).
  const sorted = [...groups].sort((a, b) => {
    const delta = b.summary.attentionPressure - a.summary.attentionPressure;
    if (Math.abs(delta) > 1e-9) return delta;
    return a.label.localeCompare(b.label);
  });

  const withGrid = sorted.map(group => ({
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
      const ownsHero = heroId != null && group.agentIds.includes(heroId);
      const tier = zoneTier(ownsHero, s.blockedCount, s.dominantStatus);
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
  const heroId = heroAgentId(state);

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
        label: agent.name,
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
  const fullQueue = selectOperatorQueue(state, Number.MAX_SAFE_INTEGER);
  const tileByAgent = new Map(tiles.map(tile => [tile.agentId, tile]));
  const frontZ = bounds.depth / 2 + RAIL.frontGap;

  const toItem = (
    q: OperatorQueueItem,
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
    const groups = allZones.map(zone => ({ ...zone, summaryMode: true }));
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
  const centered: SpatialProjectZone = {
    ...focused,
    x: 0,
    z: 0,
    summaryMode: false,
  };
  const groups = [centered];
  const tiles = selectSpatialAgentTiles(groups, state, options);
  const bounds = boundsOf(groups);
  const showRail = altitude === 'project';
  // Attention is scoped to the focused Project (its own blockers / active count).
  const attention = selectSpatialAttention(
    subState(state, centered.agentIds),
    tiles,
    options,
    bounds
  );

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
  const operatorQueue = selectOperatorQueue(state, options.blockerLimit);

  return {
    agents,
    metrics: state.metrics,
    operatorQueue,
    activityFeed: selectActivityFeed(state, options.activityLimit),
    heartbeats: selectHeartbeatSummaries(options.heartbeatJobs, state),
    selectedAgentId: options.selectedAgentId ?? null,
    nextBlockedAgentId: operatorQueue[0]?.agentId ?? null,
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
