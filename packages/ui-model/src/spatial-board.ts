import {
  resolveContextGroups,
  type AgentStatus,
  type ContextGroup,
  type ExawattAgent,
  type FleetState,
  type ProjectCatalogEntry,
} from '@exawatt/core';
import { selectFleetBurn, type FleetBurnView } from './consumption-burn';

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
  version: 1;
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
  fleetZoneWidth: 24,
  fleetZoneHeight: 11.5,
  zoneGapX: 5,
  zoneGapY: 5,
  zoneHeaderHeight: 4,
  zonePadding: 2,
  fleetPieceSize: 2.2,
  fleetPieceGap: 1.25,
  projectPieceWidth: 5.2,
  projectPieceHeight: 2.15,
  projectPieceGap: 1.6,
  projectColumns: 6,
} as const;

/**
 * Zone metrics the renderer's density-dot packer must agree with
 * (`operations-board/population-dots.ts` derives its dot-region insets from
 * these — never duplicate the numbers there).
 */
export const SPATIAL_BOARD_ZONE_METRICS = {
  zoneHeaderHeight: BOARD.zoneHeaderHeight,
  zonePadding: BOARD.zonePadding,
  fleetZoneWidth: BOARD.fleetZoneWidth,
  fleetZoneHeight: BOARD.fleetZoneHeight,
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
  maxFleetPieces: 96,
  maxFleetPiecesPerZone: 12,
  maxProjectPieces: 120,
  fleetAgentLabelLimit: 8,
  projectAgentLabelLimit: 32,
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

function fleetZoneRect(slotIndex: number): SpatialBoardRect {
  const pitchX = BOARD.fleetZoneWidth + BOARD.zoneGapX;
  const pitchY = BOARD.fleetZoneHeight + BOARD.zoneGapY;
  return {
    x: (slotIndex % BOARD.columns) * pitchX,
    y: Math.floor(slotIndex / BOARD.columns) * pitchY,
    width: BOARD.fleetZoneWidth,
    height: BOARD.fleetZoneHeight,
  };
}

function projectZoneRect(agentCount: number): SpatialBoardRect {
  const columns = Math.max(1, Math.min(BOARD.projectColumns, agentCount));
  const rows = Math.max(1, Math.ceil(agentCount / BOARD.projectColumns));
  const width =
    columns * BOARD.projectPieceWidth +
    Math.max(0, columns - 1) * BOARD.projectPieceGap +
    BOARD.zonePadding * 2;
  const height =
    BOARD.zoneHeaderHeight +
    rows * BOARD.projectPieceHeight +
    Math.max(0, rows - 1) * BOARD.projectPieceGap +
    BOARD.zonePadding * 2;
  return {
    x: 0,
    y: 0,
    width: round4(Math.max(BOARD.fleetZoneWidth, width)),
    height: round4(Math.max(BOARD.fleetZoneHeight, height)),
  };
}

/**
 * Zone footprint for a focused Project that exceeds the individual-piece
 * budget and therefore renders as aggregate density rather than one slot per
 * Agent (ENG-004 V3.1). Sizing for `agentCount` slots produced a footprint
 * thousands of units tall whose camera fit was an empty sliver; density
 * content only needs area proportional to the population, at a board-like
 * aspect, with a bounded ceiling.
 */
function densityZoneRect(agentCount: number): SpatialBoardRect {
  // One pitch² of area per rendered density dot, plus some slack.
  const contentArea =
    Math.min(agentCount, 4_000) * SPATIAL_DENSITY_ZONE_PITCH ** 2 * 1.2;
  const aspect = 2.4;
  const contentHeight = Math.max(
    BOARD.fleetZoneHeight - BOARD.zoneHeaderHeight,
    Math.sqrt(contentArea / aspect)
  );
  const contentWidth = Math.max(BOARD.fleetZoneWidth, contentHeight * aspect);
  return {
    x: 0,
    y: 0,
    width: round4(contentWidth + BOARD.zonePadding * 2),
    height: round4(
      contentHeight + BOARD.zoneHeaderHeight + BOARD.zonePadding * 2
    ),
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
  const columns = 4;
  const row = Math.floor(slotIndex / columns);
  const column = slotIndex % columns;
  const contentWidth =
    columns * BOARD.fleetPieceSize + (columns - 1) * BOARD.fleetPieceGap;
  const startX = zone.rect.x + (zone.rect.width - contentWidth) / 2;
  const startY =
    zone.rect.y +
    BOARD.zoneHeaderHeight +
    BOARD.zonePadding +
    BOARD.fleetPieceSize / 2;
  return {
    x: round4(
      startX +
        column * (BOARD.fleetPieceSize + BOARD.fleetPieceGap) +
        BOARD.fleetPieceSize / 2
    ),
    y: round4(startY + row * (BOARD.fleetPieceSize + BOARD.fleetPieceGap)),
  };
}

function projectSlotPosition(
  zone: SpatialBoardProjectZone,
  slotIndex: number
): { x: number; y: number } {
  const columns = Math.max(1, Math.min(BOARD.projectColumns, zone.agentCount));
  const row = Math.floor(slotIndex / columns);
  const column = slotIndex % columns;
  const contentWidth =
    columns * BOARD.projectPieceWidth +
    Math.max(0, columns - 1) * BOARD.projectPieceGap;
  const startX = zone.rect.x + (zone.rect.width - contentWidth) / 2;
  const startY =
    zone.rect.y +
    BOARD.zoneHeaderHeight +
    BOARD.zonePadding +
    BOARD.projectPieceHeight / 2;
  return {
    x: round4(
      startX +
        column * (BOARD.projectPieceWidth + BOARD.projectPieceGap) +
        BOARD.projectPieceWidth / 2
    ),
    y: round4(
      startY + row * (BOARD.projectPieceHeight + BOARD.projectPieceGap)
    ),
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
    return {
      id,
      slotIndex,
      kind: 'agent' as const,
      projectId: zone.id,
      agentId,
      label: agent.name,
      summary: agent.goal,
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
  } else if (altitude !== 'fleet') {
    groups = allGroups.filter(group => group.clusterId === focusedProjectId);
  }

  const previousZoneSlots = new Map<string, number>();
  if (options.previousLayout?.altitude === altitude) {
    for (const zone of options.previousLayout.zones) {
      previousZoneSlots.set(zone.id, zone.slotIndex);
    }
  }
  const zoneSlots = stableSlots(
    groups.map(group => group.clusterId),
    previousZoneSlots
  );
  const maxProjectPiecesBudget =
    options.maxProjectPieces ?? DEFAULTS.maxProjectPieces;
  const zones = groups.map(group => {
    const slotIndex =
      altitude === 'fleet' ? zoneSlots.get(group.clusterId)! : 0;
    const isAggregate = group.clusterId === 'aggregate:remaining-projects';
    const rect =
      altitude === 'fleet'
        ? fleetZoneRect(slotIndex)
        : group.agentIds.length > maxProjectPiecesBudget
          ? densityZoneRect(group.agentIds.length)
          : projectZoneRect(group.agentIds.length);
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
    const individualLimit =
      altitude === 'fleet' ? maxFleetPiecesPerZone : maxProjectPieces;
    const showIndividuals =
      !zone.isAggregate &&
      zone.agentCount <= individualLimit &&
      (altitude !== 'fleet' || showFleetIndividuals);
    if (showIndividuals) {
      pieces.push(
        ...individualPieces(
          zone,
          state,
          altitude,
          selectedAgentId,
          options.visibleAgentIds,
          altitude === 'fleet'
            ? (options.fleetAgentLabelLimit ?? DEFAULTS.fleetAgentLabelLimit)
            : (options.projectAgentLabelLimit ??
                DEFAULTS.projectAgentLabelLimit),
          options.previousLayout,
          burnView
        )
      );
    } else {
      pieces.push(...aggregatePieces(zone, altitude));
    }
  }

  const bounds = boundsOf(zones.map(zone => zone.rect));
  const cameraBounds = cameraBoundsFor(
    altitude,
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
    version: 1,
    altitude,
    focusedProjectId: altitude === 'fleet' ? null : focusedProjectId,
    selectedAgentId,
    zones,
    pieces,
    bounds,
    cameraBounds,
    minimap: {
      bounds,
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
