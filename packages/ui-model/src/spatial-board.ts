import {
  resolveContextGroups,
  type AgentStatus,
  type ContextGroup,
  type ExawattAgent,
  type FleetState,
  type ProjectCatalogEntry,
} from '@exawatt/core';
import {
  computeAgentBurn,
  selectFleetBurn,
  type FleetBurnView,
} from './consumption-burn';

export type SpatialBoardAltitude = 'fleet' | 'project' | 'agent';
export type SpatialBoardProjection = 'top-down' | 'fixed-angle';
/**
 * Board color lens (ENG-008): `status` is the default D40 protocol coloring;
 * `burn` recolors zones and population dots by normalized token share through
 * the consumption FLUX channel. Presentation-only — attention semantics
 * (triage order, needs-attention flags) never read the lens.
 */
export type SpatialBoardLens = 'status' | 'burn';
export type SpatialBoardPieceKind = 'agent' | 'aggregate';
export type SpatialBoardLabelVisibility = 'always' | 'selected' | 'hidden';

export interface SpatialBoardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpatialBoardStatusCounts {
  working: number;
  blocked: number;
  reviewing: number;
  idle: number;
  complete: number;
  error: number;
}

export interface SpatialBoardProjectZone {
  id: string;
  slotIndex: number;
  label: string;
  agentIds: string[];
  rect: SpatialBoardRect;
  /** Circular Project footprint radius; `rect` is its square bounding box. */
  radius: number;
  /** Fixed Fleet-address footprint used by the minimap at every altitude. */
  minimapRect: SpatialBoardRect;
  visible: boolean;
  selected: boolean;
  isAggregate: boolean;
  aggregatedProjectCount: number;
  agentCount: number;
  visibleAgentCount: number;
  activeCount: number;
  blockedCount: number;
  attentionPressure: number;
  costRate: number;
  dominantStatus: AgentStatus;
  statusCounts: SpatialBoardStatusCounts;
  /** Consumption burn rollup (ENG-008): null when no Agent in the zone
   *  reports usage — absent, never zero. `share` is the zone's slice of the
   *  board's normalized total; `intensity` is against the hottest zone so
   *  the burn-lens choropleth uses the full ramp range. */
  burn: SpatialBoardZoneBurn | null;
}

export interface SpatialBoardZoneBurn {
  normalizedTokens: number;
  share: number;
  intensity: number;
}

/** One delegated child projected for the board (ENG-023 D3b): labels only. */
export interface SpatialBoardDelegatedChild {
  id: string;
  agentType: string | null;
  description: string | null;
}

/** Satellites drawn per delegating piece before the count aggregates into
 *  the DOM control copy — mirrors the DOM presence-dot cap. */
export const SPATIAL_DELEGATION_SATELLITE_CAP = 5;

export interface SpatialBoardPiece {
  id: string;
  slotIndex: number;
  kind: SpatialBoardPieceKind;
  projectId: string;
  agentId: string | null;
  label: string;
  summary: string;
  /** Latest source-reported activity sentence; absent when unreported. */
  activity?: string | null;
  status: AgentStatus;
  sessionState?: 'live' | 'stopped';
  count: number;
  x: number;
  y: number;
  size: number;
  visible: boolean;
  selected: boolean;
  needsAttention: boolean;
  labelVisibility: SpatialBoardLabelVisibility;
  /** Burn-lens color figure (ENG-008): agent pieces carry their own
   *  intensity against the hottest reporting Agent; aggregate pieces carry
   *  their zone's intensity (per-dot identity does not survive aggregation).
   *  Null when unreported — the lens renders it as the neutral unknown. */
  burnIntensity: number | null;
  /** Present only while the source reports live children (ENG-023 D3b):
   *  presence is the signal, so unreported and zero read identically. */
  delegation?: {
    count: number;
    children: SpatialBoardDelegatedChild[];
  };
}

export interface SpatialBoardLayout {
  version: 2;
  altitude: SpatialBoardAltitude;
  focusedProjectId: string | null;
  selectedAgentId: string | null;
  zones: SpatialBoardProjectZone[];
  pieces: SpatialBoardPiece[];
  /** Bounds of every emitted zone. Stable while filters only change visibility. */
  bounds: SpatialBoardRect;
  /** Bounds used for fit/recenter after filtering or semantic descent. */
  cameraBounds: SpatialBoardRect;
  minimap: {
    bounds: SpatialBoardRect;
    visibleZoneIds: string[];
  };
  stats: {
    sourceProjectCount: number;
    emittedProjectCount: number;
    sourceAgentCount: number;
    emittedPieceCount: number;
    visiblePieceCount: number;
    aggregatedAgentCount: number;
    visibleLabelCount: number;
  };
}

export interface SpatialBoardLayoutOptions {
  altitude?: SpatialBoardAltitude;
  focusedProjectId?: string | null;
  selectedAgentId?: string | null;
  /** Presentation-only; coordinates never branch on projection. */
  projection?: SpatialBoardProjection;
  /** Compute from full FleetState, then hide without changing stable addresses. */
  visibleAgentIds?: ReadonlySet<string>;
  /** Known Projects remain addressable before their first Agent exists. */
  projects?: readonly ProjectCatalogEntry[];
  /** Empty Projects matching the active semantic filter. */
  visibleProjectIds?: ReadonlySet<string>;
  previousLayout?: SpatialBoardLayout | null;
  maxProjectZones?: number;
  maxFleetPieces?: number;
  maxFleetPiecesPerZone?: number;
  maxProjectPieces?: number;
  fleetAgentLabelLimit?: number;
  projectAgentLabelLimit?: number;
}

const BOARD = {
  columns: 4,
  fleetPitchX: 30,
  fleetPitchY: 28,
  fleetMinRadius: 7,
  fleetMaxRadius: 14,
  zoneLabelClearance: 3.2,
  zonePadding: 1.4,
  fleetPieceSize: 2.2,
  projectPieceHeight: 2.15,
  fleetHexPitch: 1.3,
  projectHexPitch: 2.75,
} as const;

/**
 * Zone metrics the renderer's density-dot packer must agree with
 * (`operations-board/population-dots.ts` derives its dot-region insets from
 * these — never duplicate the numbers there).
 */
export const SPATIAL_BOARD_ZONE_METRICS = {
  zoneLabelClearance: BOARD.zoneLabelClearance,
  zonePadding: BOARD.zonePadding,
  fleetMinRadius: BOARD.fleetMinRadius,
} as const;

/**
 * The dot pitch `densityZoneRect` budgets area for. Must be one of the
 * renderer's PITCH_TIERS (population-dots pins this with a test): sizing a
 * density zone for a pitch the renderer cannot select would silently missize
 * every aggregated Project zone.
 */
export const SPATIAL_DENSITY_ZONE_PITCH = 0.35;

const DEFAULTS = {
  maxProjectZones: 24,
  // The 173-Agent reference and current Voltaic demo fleets remain fully
  // individual. Larger fleets enter the fitted "very far" population field;
  // drilling a Project restores hexes up to the focused-Project budget.
  maxFleetPieces: 240,
  maxFleetPiecesPerZone: 64,
  maxProjectPieces: 120,
  fleetAgentLabelLimit: 8,
  // A few persistent goal labels establish identity; every remaining Agent
  // reveals the same goal/activity copy on hover, focus, or selection. Higher
  // budgets turn a compact Project into an unreadable stack of DOM cards.
  projectAgentLabelLimit: 4,
} as const;

const STATUS_ORDER: AgentStatus[] = [
  'blocked',
  'error',
  'reviewing',
  'working',
  'idle',
  'complete',
];

const STATUS_RANK: Record<AgentStatus, number> = {
  blocked: 0,
  error: 1,
  reviewing: 2,
  working: 3,
  idle: 4,
  complete: 5,
};

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function emptyCounts(): SpatialBoardStatusCounts {
  return {
    working: 0,
    blocked: 0,
    reviewing: 0,
    idle: 0,
    complete: 0,
    error: 0,
  };
}

function statusCounts(agents: ExawattAgent[]): SpatialBoardStatusCounts {
  const counts = emptyCounts();
  for (const agent of agents) counts[agent.status]++;
  return counts;
}

function dominantStatus(counts: SpatialBoardStatusCounts): AgentStatus {
  for (const status of STATUS_ORDER) {
    if (counts[status] > 0) return status;
  }
  return 'idle';
}

function boundsOf(rects: SpatialBoardRect[]): SpatialBoardRect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return {
    x: round4(minX),
    y: round4(minY),
    width: round4(maxX - minX),
    height: round4(maxY - minY),
  };
}

function groupAgents(group: ContextGroup, state: FleetState): ExawattAgent[] {
  return group.agentIds
    .map(id => state.agents[id])
    .filter((agent): agent is ExawattAgent => Boolean(agent))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function visibleAgent(
  agentId: string,
  visibleAgentIds: ReadonlySet<string> | undefined
): boolean {
  return visibleAgentIds ? visibleAgentIds.has(agentId) : true;
}

function nextFreeSlot(used: Set<number>): number {
  let slot = 0;
  while (used.has(slot)) slot++;
  used.add(slot);
  return slot;
}

function stableSlots(
  ids: string[],
  previous: Map<string, number>
): Map<string, number> {
  const result = new Map<string, number>();
  const used = new Set<number>();
  for (const id of ids) {
    const old = previous.get(id);
    if (old == null || old < 0 || used.has(old)) continue;
    result.set(id, old);
    used.add(old);
  }
  for (const id of ids) {
    if (!result.has(id)) result.set(id, nextFreeSlot(used));
  }
  return result;
}

function circleRect(x: number, y: number, radius: number): SpatialBoardRect {
  return {
    x: round4(x - radius),
    y: round4(y - radius),
    width: round4(radius * 2),
    height: round4(radius * 2),
  };
}

function fleetZoneRadius(agentCount: number): number {
  return round4(
    Math.min(
      BOARD.fleetMaxRadius,
      Math.max(BOARD.fleetMinRadius, 5.8 + Math.sqrt(agentCount) * 1.15)
    )
  );
}

function fleetZoneRect(
  slotIndex: number,
  agentCount: number
): SpatialBoardRect {
  const column = slotIndex % BOARD.columns;
  const row = Math.floor(slotIndex / BOARD.columns);
  const centerX = BOARD.fleetMaxRadius + column * BOARD.fleetPitchX;
  const centerY = BOARD.fleetMaxRadius + row * BOARD.fleetPitchY;
  const radius = fleetZoneRadius(agentCount);
  return circleRect(centerX, centerY, radius);
}

function hexRingForCount(count: number): number {
  let ring = 0;
  while (1 + 3 * ring * (ring + 1) < Math.max(1, count)) ring += 1;
  return ring;
}

function projectZoneRect(
  slotIndex: number,
  agentCount: number
): SpatialBoardRect {
  const radius = Math.max(
    7,
    5.2 + hexRingForCount(agentCount) * BOARD.projectHexPitch * 1.5
  );
  // Semantic altitude changes resolution, not address. Keep the focused
  // Project on its Fleet-lattice center so the camera and contents can carry
  // their current viewport through Fleet → Project → Agent.
  const fleetRect = fleetZoneRect(slotIndex, agentCount);
  return circleRect(
    fleetRect.x + fleetRect.width / 2,
    fleetRect.y + fleetRect.height / 2,
    radius
  );
}

/** Circular footprint for aggregate density at focused Project altitude. */
function densityZoneRect(
  slotIndex: number,
  agentCount: number
): SpatialBoardRect {
  const contentRadius = Math.sqrt(
    (Math.min(agentCount, 4_000) * SPATIAL_DENSITY_ZONE_PITCH ** 2 * 1.25) /
      Math.PI
  );
  const radius = Math.max(
    BOARD.fleetMinRadius,
    contentRadius + BOARD.zoneLabelClearance + BOARD.zonePadding
  );
  const fleetRect = fleetZoneRect(slotIndex, agentCount);
  return circleRect(
    fleetRect.x + fleetRect.width / 2,
    fleetRect.y + fleetRect.height / 2,
    radius
  );
}

function axialSlotOffset(
  slotIndex: number,
  pitch: number
): { x: number; y: number } {
  if (slotIndex === 0) return { x: 0, y: 0 };
  const ring = hexRingForCount(slotIndex + 1);
  const coordinates: Array<{ q: number; r: number; distance: number }> = [];
  for (let q = -ring; q <= ring; q += 1) {
    const rMin = Math.max(-ring, -q - ring);
    const rMax = Math.min(ring, -q + ring);
    for (let r = rMin; r <= rMax; r += 1) {
      const distance = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      coordinates.push({ q, r, distance });
    }
  }
  coordinates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return Math.atan2(a.r, a.q) - Math.atan2(b.r, b.q);
  });
  const coordinate = coordinates[slotIndex]!;
  return {
    x: round4(pitch * Math.sqrt(3) * (coordinate.q + coordinate.r / 2)),
    y: round4(pitch * 1.5 * coordinate.r),
  };
}

function aggregateGroups(
  groups: ContextGroup[],
  state: FleetState
): ContextGroup {
  const agents = groups.flatMap(group => groupAgents(group, state));
  const counts = statusCounts(agents);
  const blocked = counts.blocked + counts.error;
  const active = counts.working + counts.reviewing;
  const idle = agents.length - blocked - active;
  const costRate = agents.reduce(
    (sum, agent) => sum + agent.metrics.costRate,
    0
  );
  const totalCost = agents.reduce(
    (sum, agent) => sum + agent.metrics.estimatedCost,
    0
  );
  return {
    clusterId: 'aggregate:remaining-projects',
    kind: 'project',
    label: `+${groups.length} more Projects`,
    agentIds: agents.map(agent => agent.id).sort(),
    summary: {
      agentCount: agents.length,
      activeCount: active,
      blockedCount: blocked,
      idleCount: idle,
      costRate: round4(costRate),
      totalCost: round4(totalCost),
      attentionPressure: round4(
        agents.length > 0
          ? (blocked * 3 + counts.reviewing) / (agents.length * 3)
          : 0
      ),
      dominantStatus: dominantStatus(counts),
    },
  };
}

function projectZone(
  group: ContextGroup,
  state: FleetState,
  slotIndex: number,
  rect: SpatialBoardRect,
  selectedAgentId: string | null,
  visibleAgentIds: ReadonlySet<string> | undefined,
  visibleProjectIds: ReadonlySet<string> | undefined,
  isAggregate: boolean,
  aggregatedProjectCount: number
): SpatialBoardProjectZone {
  const agents = groupAgents(group, state);
  const visible = agents.filter(agent =>
    visibleAgent(agent.id, visibleAgentIds)
  );
  const counts = statusCounts(agents);
  const visibleIds = new Set(visible.map(agent => agent.id));
  const selected = selectedAgentId
    ? group.agentIds.includes(selectedAgentId)
    : false;
  return {
    id: group.clusterId,
    slotIndex,
    label: group.label,
    agentIds: agents.map(agent => agent.id),
    rect,
    radius: rect.width / 2,
    minimapRect: fleetZoneRect(slotIndex, agents.length),
    visible:
      isAggregate ||
      visible.length > 0 ||
      (agents.length === 0 &&
        (visibleAgentIds === undefined ||
          visibleProjectIds?.has(group.clusterId) === true)),
    selected,
    isAggregate,
    aggregatedProjectCount,
    agentCount: agents.length,
    visibleAgentCount: isAggregate
      ? agents.length
      : agents.reduce(
          (count, agent) => count + Number(visibleIds.has(agent.id)),
          0
        ),
    activeCount: counts.working + counts.reviewing,
    blockedCount: counts.blocked + counts.error,
    attentionPressure: group.summary.attentionPressure,
    costRate: group.summary.costRate,
    dominantStatus: dominantStatus(counts),
    statusCounts: counts,
    burn: null, // attached by the layout's burn post-pass
  };
}

/**
 * Attach zone burn rollups in place (ENG-008): each zone sums the reported
 * per-agent normalized tokens of its Agents; `share` is against the board
 * total, `intensity` against the hottest zone. Zones whose Agents all go
 * unreported keep `burn: null` — the lens must render them as unknown.
 */
function attachZoneBurn(
  zones: SpatialBoardProjectZone[],
  burnView: FleetBurnView
): void {
  if (burnView.reportedCount === 0) return;
  const totals = zones.map(zone => {
    let normalized = 0;
    let reported = false;
    for (const agentId of zone.agentIds) {
      const entry = burnView.byAgent.get(agentId);
      if (!entry) continue;
      normalized += entry.normalizedTokens;
      reported = true;
    }
    return reported ? normalized : null;
  });
  const boardTotal = totals.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0
  );
  const maxZone = totals.reduce<number>(
    (max, value) => Math.max(max, value ?? 0),
    0
  );
  zones.forEach((zone, index) => {
    const normalized = totals[index];
    if (normalized === null) return;
    zone.burn = {
      normalizedTokens: normalized,
      share: boardTotal > 0 ? round4(normalized / boardTotal) : 0,
      intensity: maxZone > 0 ? round4(normalized / maxZone) : 0,
    };
  });
}

function fleetSlotPosition(
  zone: SpatialBoardProjectZone,
  slotIndex: number
): { x: number; y: number } {
  const centerX = zone.rect.x + zone.radius;
  const centerY = zone.rect.y + zone.radius + BOARD.zoneLabelClearance * 0.18;
  const offset = axialSlotOffset(slotIndex, BOARD.fleetHexPitch);
  return {
    x: round4(centerX + offset.x),
    y: round4(centerY + offset.y),
  };
}

function projectSlotPosition(
  zone: SpatialBoardProjectZone,
  slotIndex: number
): { x: number; y: number } {
  const offset = axialSlotOffset(slotIndex, BOARD.projectHexPitch);
  return {
    x: round4(zone.rect.x + zone.radius + offset.x),
    y: round4(zone.rect.y + zone.radius + offset.y),
  };
}

function individualPieces(
  zone: SpatialBoardProjectZone,
  state: FleetState,
  altitude: SpatialBoardAltitude,
  selectedAgentId: string | null,
  visibleAgentIds: ReadonlySet<string> | undefined,
  labelLimit: number,
  previousLayout: SpatialBoardLayout | null | undefined,
  burnView: FleetBurnView
): SpatialBoardPiece[] {
  const previousSlots = new Map<string, number>();
  if (previousLayout?.altitude === altitude) {
    for (const piece of previousLayout.pieces) {
      if (piece.kind === 'agent' && piece.projectId === zone.id) {
        previousSlots.set(piece.id, piece.slotIndex);
      }
    }
  }
  const ids = zone.agentIds.map(agentId => `agent:${agentId}`);
  const slots = stableSlots(ids, previousSlots);
  return ids.map((id, index) => {
    const agentId = id.slice('agent:'.length);
    const agent = state.agents[agentId]!;
    const selected = agentId === selectedAgentId;
    const slotIndex = slots.get(id)!;
    const position =
      altitude === 'fleet'
        ? fleetSlotPosition(zone, slotIndex)
        : projectSlotPosition(zone, slotIndex);
    const showByBudget = index < labelLimit;
    const delegated = agent.delegation?.children ?? [];
    const latestActivity = [...(agent.activities ?? [])]
      .filter(activity => activity.type !== 'status_change')
      .sort((a, b) => b.timestamp - a.timestamp)[0]
      ?.content.trim();
    return {
      id,
      slotIndex,
      kind: 'agent' as const,
      projectId: zone.id,
      agentId,
      label: agent.goal.trim() || agent.name,
      summary: agent.name,
      activity: latestActivity || null,
      status: agent.status,
      ...(agent.sessionState ? { sessionState: agent.sessionState } : {}),
      ...(delegated.length > 0
        ? {
            delegation: {
              count: delegated.length,
              children: delegated
                .slice(0, SPATIAL_DELEGATION_SATELLITE_CAP)
                .map(child => ({
                  id: child.id,
                  agentType: child.agentType,
                  description: child.description ?? null,
                })),
            },
          }
        : {}),
      count: 1,
      x: position.x,
      y: position.y,
      size:
        altitude === 'fleet' ? BOARD.fleetPieceSize : BOARD.projectPieceHeight,
      visible: zone.visible && visibleAgent(agentId, visibleAgentIds),
      selected,
      needsAttention: agent.status === 'blocked' || agent.status === 'error',
      burnIntensity: burnView.byAgent.get(agentId)?.intensity ?? null,
      labelVisibility: selected
        ? ('always' as const)
        : showByBudget
          ? ('always' as const)
          : ('selected' as const),
    };
  });
}

function aggregatePieces(
  zone: SpatialBoardProjectZone,
  altitude: SpatialBoardAltitude
): SpatialBoardPiece[] {
  const pieces: SpatialBoardPiece[] = [];
  for (const status of STATUS_ORDER) {
    const count = zone.statusCounts[status];
    if (count === 0) continue;
    const slotIndex = pieces.length;
    const position =
      altitude === 'fleet'
        ? fleetSlotPosition(zone, slotIndex)
        : projectSlotPosition(zone, slotIndex);
    pieces.push({
      id: `aggregate:${zone.id}:${status}`,
      slotIndex,
      kind: 'aggregate',
      projectId: zone.id,
      agentId: null,
      label: status,
      summary: `${count} ${status}`,
      status,
      count,
      x: position.x,
      y: position.y,
      size:
        altitude === 'fleet' ? BOARD.fleetPieceSize : BOARD.projectPieceHeight,
      visible: zone.visible,
      selected: false,
      needsAttention: status === 'blocked' || status === 'error',
      burnIntensity: zone.burn?.intensity ?? null,
      labelVisibility: 'always',
    });
  }
  return pieces;
}

function cameraBoundsFor(
  altitude: SpatialBoardAltitude,
  focusedProjectId: string | null,
  zones: SpatialBoardProjectZone[],
  pieces: SpatialBoardPiece[],
  selectedAgentId: string | null,
  fallback: SpatialBoardRect
): SpatialBoardRect {
  if (altitude === 'agent' && selectedAgentId) {
    const selected = pieces.find(piece => piece.agentId === selectedAgentId);
    if (selected) {
      const padding = 6;
      return {
        x: round4(selected.x - padding),
        y: round4(selected.y - padding),
        width: padding * 2,
        height: padding * 2,
      };
    }
  }
  if (altitude === 'project' && focusedProjectId) {
    const focused = zones.find(zone => zone.id === focusedProjectId);
    if (focused?.visible) return focused.rect;
  }
  const visibleRects = zones
    .filter(zone => zone.visible)
    .map(zone => zone.rect);
  return visibleRects.length > 0 ? boundsOf(visibleRects) : fallback;
}

/**
 * Projection-independent, source-agnostic board layout. It consumes the full
 * FleetState and applies visibility after placement so filters do not scramble
 * spatial addresses. Supply `previousLayout` to preserve existing slots when
 * Projects or Agents arrive.
 */
export function selectSpatialBoardLayout(
  state: FleetState,
  options: SpatialBoardLayoutOptions = {}
): SpatialBoardLayout {
  const selectedAgentId = options.selectedAgentId ?? null;
  let altitude = options.altitude ?? 'fleet';
  let focusedProjectId = options.focusedProjectId ?? null;
  const allGroups = resolveContextGroups(state, {
    projects: options.projects,
  }).sort((a, b) => a.clusterId.localeCompare(b.clusterId));
  const sourceProjectCount = allGroups.length;
  const sourceAgentCount = Object.keys(state.agents).length;

  if (altitude === 'agent') {
    const owner = selectedAgentId
      ? allGroups.find(group => group.agentIds.includes(selectedAgentId))
      : undefined;
    if (owner) focusedProjectId = owner.clusterId;
    else {
      altitude = 'fleet';
      focusedProjectId = null;
    }
  }
  if (altitude === 'project') {
    if (!allGroups.some(group => group.clusterId === focusedProjectId)) {
      altitude = 'fleet';
      focusedProjectId = null;
    }
  }

  const maxProjectZones = Math.max(
    1,
    options.maxProjectZones ?? DEFAULTS.maxProjectZones
  );
  let groups = allGroups;
  let aggregateProjectCount = 0;
  if (altitude === 'fleet' && allGroups.length > maxProjectZones + 1) {
    const hidden = allGroups.slice(maxProjectZones);
    aggregateProjectCount = hidden.length;
    groups = [
      ...allGroups.slice(0, maxProjectZones),
      aggregateGroups(hidden, state),
    ];
  }

  const previousZoneSlots = new Map<string, number>();
  if (options.previousLayout) {
    for (const zone of options.previousLayout.zones) {
      previousZoneSlots.set(zone.id, zone.slotIndex);
    }
  }
  const addressSlots = stableSlots(
    allGroups.map(group => group.clusterId),
    previousZoneSlots
  );
  const fleetSlots = stableSlots(
    groups.map(group => group.clusterId),
    previousZoneSlots
  );
  const maxProjectPiecesBudget =
    options.maxProjectPieces ?? DEFAULTS.maxProjectPieces;
  const zones = groups.map(group => {
    const slotIndex =
      altitude === 'fleet'
        ? fleetSlots.get(group.clusterId)!
        : addressSlots.get(group.clusterId)!;
    const isAggregate = group.clusterId === 'aggregate:remaining-projects';
    const detailed =
      altitude !== 'fleet' && group.clusterId === focusedProjectId;
    const rect = !detailed
      ? fleetZoneRect(slotIndex, group.agentIds.length)
      : group.agentIds.length > maxProjectPiecesBudget
        ? densityZoneRect(slotIndex, group.agentIds.length)
        : projectZoneRect(slotIndex, group.agentIds.length);
    return projectZone(
      group,
      state,
      slotIndex,
      rect,
      selectedAgentId,
      options.visibleAgentIds,
      options.visibleProjectIds,
      isAggregate,
      isAggregate ? aggregateProjectCount : 0
    );
  });

  // Burn attaches BEFORE pieces so aggregate pieces inherit zone intensity.
  const burnView = selectFleetBurn(state);
  attachZoneBurn(zones, burnView);

  const maxFleetPieces = options.maxFleetPieces ?? DEFAULTS.maxFleetPieces;
  const maxFleetPiecesPerZone =
    options.maxFleetPiecesPerZone ?? DEFAULTS.maxFleetPiecesPerZone;
  const maxProjectPieces = maxProjectPiecesBudget;
  const showFleetIndividuals = sourceAgentCount <= maxFleetPieces;
  const pieces: SpatialBoardPiece[] = [];
  for (const zone of zones) {
    const detailed = altitude !== 'fleet' && zone.id === focusedProjectId;
    if (altitude !== 'fleet' && !detailed) {
      pieces.push(...aggregatePieces(zone, 'fleet'));
      continue;
    }
    const pieceAltitude = detailed ? altitude : 'fleet';
    const individualLimit =
      pieceAltitude === 'fleet' ? maxFleetPiecesPerZone : maxProjectPieces;
    const showIndividuals =
      !zone.isAggregate &&
      zone.agentCount <= individualLimit &&
      (pieceAltitude !== 'fleet' || showFleetIndividuals);
    if (showIndividuals) {
      pieces.push(
        ...individualPieces(
          zone,
          state,
          pieceAltitude,
          selectedAgentId,
          options.visibleAgentIds,
          pieceAltitude === 'fleet'
            ? (options.fleetAgentLabelLimit ?? DEFAULTS.fleetAgentLabelLimit)
            : (options.projectAgentLabelLimit ??
                DEFAULTS.projectAgentLabelLimit),
          options.previousLayout,
          burnView
        )
      );
    } else {
      pieces.push(...aggregatePieces(zone, pieceAltitude));
    }
  }

  const bounds = boundsOf(zones.map(zone => zone.rect));
  const minimapBounds = boundsOf(zones.map(zone => zone.minimapRect));
  const cameraBounds = cameraBoundsFor(
    altitude,
    focusedProjectId,
    zones,
    pieces,
    selectedAgentId,
    bounds
  );
  const emittedIndividualAgents = pieces.reduce(
    (count, piece) => count + (piece.kind === 'agent' ? 1 : 0),
    0
  );
  const visiblePieces = pieces.filter(piece => piece.visible);
  const visibleLabelCount = visiblePieces.filter(
    piece => piece.labelVisibility === 'always'
  ).length;

  return {
    version: 2,
    altitude,
    focusedProjectId: altitude === 'fleet' ? null : focusedProjectId,
    selectedAgentId,
    zones,
    pieces,
    bounds,
    cameraBounds,
    minimap: {
      bounds: minimapBounds,
      visibleZoneIds: zones.filter(zone => zone.visible).map(zone => zone.id),
    },
    stats: {
      sourceProjectCount,
      emittedProjectCount: zones.length,
      sourceAgentCount,
      emittedPieceCount: pieces.length,
      visiblePieceCount: visiblePieces.length,
      aggregatedAgentCount: Math.max(
        0,
        sourceAgentCount - emittedIndividualAgents
      ),
      visibleLabelCount,
    },
  };
}

/**
 * Band-hit selection (ENG-004 V3.2): resolve a drag rectangle in LAYOUT space
 * (y-down, the coordinate system every `SpatialBoardRect` uses) to the Agents
 * it captures. Two capture rules, both over visible entities only:
 *
 * - a visible agent piece whose CENTER falls inside the band is captured
 *   individually (the RTS unit rule);
 * - a zone whose population renders as the aggregated dot field — no
 *   per-agent pieces to hit — is captured whole when the band INTERSECTS its
 *   circular footprint (the RTS building rule; at fleet density the zone is
 *   the unit).
 *   Zones that do render agent pieces are owned by the piece rule, so a band
 *   inside a focused Project never grabs the whole Project.
 *
 * `visibleAgentIds` (the same set the layout was computed with) keeps
 * filtered-out Agents out of zone captures. Pure and order-stable: piece
 * captures in piece order, then zone captures in zone order, deduplicated.
 */
export function selectSpatialBandAgentIds(
  layout: SpatialBoardLayout,
  band: SpatialBoardRect,
  visibleAgentIds?: ReadonlySet<string>
): string[] {
  const left = Math.min(band.x, band.x + band.width);
  const right = Math.max(band.x, band.x + band.width);
  const top = Math.min(band.y, band.y + band.height);
  const bottom = Math.max(band.y, band.y + band.height);
  const captured = new Set<string>();
  const pieceOwnedZones = new Set<string>();
  for (const piece of layout.pieces) {
    if (piece.kind !== 'agent' || !piece.visible || !piece.agentId) continue;
    pieceOwnedZones.add(piece.projectId);
    if (
      piece.x >= left &&
      piece.x <= right &&
      piece.y >= top &&
      piece.y <= bottom
    ) {
      captured.add(piece.agentId);
    }
  }
  for (const zone of layout.zones) {
    if (!zone.visible || zone.isAggregate || zone.agentCount === 0) continue;
    if (pieceOwnedZones.has(zone.id)) continue;
    const centerX = zone.rect.x + zone.radius;
    const centerY = zone.rect.y + zone.radius;
    const closestX = Math.max(left, Math.min(centerX, right));
    const closestY = Math.max(top, Math.min(centerY, bottom));
    const dx = centerX - closestX;
    const dy = centerY - closestY;
    const intersects = dx * dx + dy * dy <= zone.radius * zone.radius;
    if (!intersects) continue;
    for (const agentId of zone.agentIds) {
      if (visibleAgentIds && !visibleAgentIds.has(agentId)) continue;
      captured.add(agentId);
    }
  }
  return [...captured];
}

export type SpatialSelectionDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Arrow-key selection for the RTS board. Candidates live in the pressed
 * half-plane; distance is weighted by angular deviation so a nearby diagonal
 * Agent wins only when it is still a legible move in that direction.
 */
export function selectSpatialDirectionalAgentId(
  layout: SpatialBoardLayout,
  currentAgentId: string | null,
  direction: SpatialSelectionDirection
): string | null {
  const candidates = layout.pieces.filter(
    (piece): piece is SpatialBoardPiece & { agentId: string } =>
      piece.kind === 'agent' && piece.visible && Boolean(piece.agentId)
  );
  if (candidates.length === 0) return null;
  const current = currentAgentId
    ? candidates.find(piece => piece.agentId === currentAgentId)
    : undefined;
  const origin = current ?? {
    x: layout.cameraBounds.x + layout.cameraBounds.width / 2,
    y: layout.cameraBounds.y + layout.cameraBounds.height / 2,
  };
  const axis =
    direction === 'left'
      ? { x: -1, y: 0 }
      : direction === 'right'
        ? { x: 1, y: 0 }
        : direction === 'up'
          ? { x: 0, y: -1 }
          : { x: 0, y: 1 };
  let best: (typeof candidates)[number] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.agentId === currentAgentId) continue;
    const dx = candidate.x - origin.x;
    const dy = candidate.y - origin.y;
    const forward = dx * axis.x + dy * axis.y;
    if (forward <= 0.001) continue;
    const distance = Math.hypot(dx, dy);
    const perpendicular = Math.abs(dx * axis.y - dy * axis.x);
    const score = distance * (1 + (perpendicular / distance) * 2.25);
    if (
      score < bestScore - 0.0001 ||
      (Math.abs(score - bestScore) <= 0.0001 &&
        candidate.agentId.localeCompare(best?.agentId ?? '') < 0)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.agentId ?? current?.agentId ?? null;
}

/**
 * Fleet-altitude activity summary (ENG-004 V3.2): the compact working /
 * blocked / idle readout plus the scope's token burn, over the whole fleet or
 * a selected scope. Buckets follow the D40 projection the zone health rails
 * already use: working folds in reviewing (both Active), blocked folds in
 * error (both demand the operator), idle folds in complete (both quietly
 * waiting). `burn` is null when no Agent in scope reports usage — absent,
 * never zero, per consumption canon.
 */
export interface SpatialScopeActivity {
  agentCount: number;
  working: number;
  blocked: number;
  idle: number;
  burn: {
    rawTokens: number;
    normalizedTokens: number;
    reportedCount: number;
    unreportedCount: number;
  } | null;
}

export function selectSpatialScopeActivity(
  state: FleetState,
  scope?: ReadonlySet<string> | null
): SpatialScopeActivity {
  const agents = Object.values(state.agents).filter(
    agent => !scope || scope.has(agent.id)
  );
  const summary: SpatialScopeActivity = {
    agentCount: agents.length,
    working: 0,
    blocked: 0,
    idle: 0,
    burn: null,
  };
  for (const agent of agents) {
    if (agent.status === 'working' || agent.status === 'reviewing') {
      summary.working++;
    } else if (agent.status === 'blocked' || agent.status === 'error') {
      summary.blocked++;
    } else {
      summary.idle++;
    }
  }
  const burn = computeAgentBurn(
    agents.map(agent => ({
      id: agent.id,
      rawTokens: agent.metrics.rawTokens,
      normalizedTokens: agent.metrics.normalizedTokens,
    }))
  );
  if (burn.reportedCount > 0) {
    let rawTokens = 0;
    for (const entry of burn.byAgent.values()) rawTokens += entry.rawTokens;
    summary.burn = {
      rawTokens,
      normalizedTokens: burn.totalNormalizedTokens,
      reportedCount: burn.reportedCount,
      unreportedCount: burn.unreportedCount,
    };
  }
  return summary;
}

export function spatialBoardPieceForAgent(
  layout: SpatialBoardLayout,
  agentId: string
): SpatialBoardPiece | null {
  return layout.pieces.find(piece => piece.agentId === agentId) ?? null;
}

export function spatialBoardZoneForAgent(
  layout: SpatialBoardLayout,
  agentId: string
): SpatialBoardProjectZone | null {
  return layout.zones.find(zone => zone.agentIds.includes(agentId)) ?? null;
}

export function compareSpatialBoardAttention(
  a: SpatialBoardPiece,
  b: SpatialBoardPiece
): number {
  const statusDelta = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (statusDelta !== 0) return statusDelta;
  return a.id.localeCompare(b.id);
}
