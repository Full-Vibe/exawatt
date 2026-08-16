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
  /** Distance between adjacent Agent slots inside this Project. */
  slotPitch: number;
  /** Diameter of an Agent unit inside this Project. Projects whose Agents
   *  delegate render the whole family finer so a constellation fits the same
   *  population-sized circle — the room is bought from the unit, never from
   *  the Project, so circle area keeps meaning population. */
  unitSize: number;
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

/** One delegated child projected for the board (ENG-023 D3b/D3c): labels and
 *  the source's own start time, which the focus detail turns into elapsed. */
export interface SpatialBoardDelegatedChild {
  id: string;
  agentType: string | null;
  description: string | null;
  startedAt: number | null;
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
  /** Delegated children at their final packed positions. Placed with the
   *  Agents rather than derived afterwards, so one relaxation resolves both. */
  delegationUnits: SpatialBoardDelegationUnit[];
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

/**
 * Deterministic collision relaxation for board units (ENG-004, operator
 * 2026-08-11: "they should have their own kind of magnetic repulsion effect
 * and then they should generally be able to fit").
 *
 * The hex lattice assigns each Agent a STABLE address, which is what makes
 * spatial memory work — but a lattice sized for bare Agents has no room for a
 * delegated constellation, and a slot's rosette can reach past its neighbour's
 * centre. Relaxation resolves that residual overlap without giving up the
 * addresses: lattice slots are the SEED, and units are pushed apart from there.
 *
 * Three properties this must have, and the reasons they are not negotiable:
 *
 * - **Deterministic.** Same input, same output, every time. No randomness, no
 *   clock, no iteration-order dependence — the board layout is pure and its
 *   snapshots are compared in tests.
 * - **Anchored.** Every unit is pulled back toward its seed, and a parent Agent
 *   resists far more than a delegated child. An Agent's position is its
 *   address; a child's is a detail of its parent. So conflicts are paid for by
 *   the children, and the fleet a person has learned stays learnable.
 * - **Bounded.** A fixed iteration count, not "until settled". This runs inside
 *   a pure selector on every layout tick.
 */
const RELAX = {
  iterations: 24,
  /**
   * Iterations at the end that ignore the anchor entirely. Without them the
   * pull toward the seed fights the separation forever and the pass settles
   * with units still touching — correct-looking but not actually resolved.
   * Separation gets the last word; the anchor has already done its job of
   * deciding WHICH way things moved.
   */
  settleIterations: 8,
  /** Fraction of an overlap resolved per iteration; under 1 to stay stable. */
  strength: 0.8,
  /** Pull back toward the seed, per iteration. Higher = holds its address. */
  anchor: { agent: 0.5, child: 0.08 },
  /** Breathing room left between two units once separated. */
  gap: 0.08,
} as const;

export interface RelaxableUnit {
  id: string;
  x: number;
  y: number;
  radius: number;
  kind: 'agent' | 'child';
  /** Layout-space ceiling (y grows downward), enforced every iteration. A
   *  delegated child may not be pushed below its parent: the lane under an
   *  Agent belongs to its DOM label, and separation must not buy room there. */
  maxY?: number;
}

/**
 * Push overlapping units apart, in place. Returns the same array so callers can
 * read positions straight back out.
 */
export function relaxBoardUnits(units: RelaxableUnit[]): RelaxableUnit[] {
  if (units.length < 2) return units;
  // Sorted once so the sweep order cannot depend on how the caller built the
  // list; two layouts of the same fleet must relax identically.
  const ordered = [...units].sort((a, b) => a.id.localeCompare(b.id));
  const seeds = ordered.map(unit => ({ x: unit.x, y: unit.y }));
  for (let pass = 0; pass < RELAX.iterations; pass += 1) {
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i]!;
        const b = ordered[j]!;
        const minimum = a.radius + b.radius + RELAX.gap;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        if (distance >= minimum) continue;
        if (distance < 1e-6) {
          // Exactly coincident: separate along a direction derived from the
          // ids, so the tie is broken the same way on every run.
          const angle =
            ((a.id.length * 31 + b.id.length * 17) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const push = ((minimum - distance) / distance) * RELAX.strength;
        // Mobility is the inverse of how hard a unit holds its address.
        const aMove = 1 - RELAX.anchor[a.kind];
        const bMove = 1 - RELAX.anchor[b.kind];
        const total = aMove + bMove || 1;
        const aShare = (push * aMove) / total;
        const bShare = (push * bMove) / total;
        a.x -= dx * aShare;
        a.y -= dy * aShare;
        b.x += dx * bShare;
        b.y += dy * bShare;
      }
    }
    for (const unit of ordered) {
      if (unit.maxY !== undefined && unit.y > unit.maxY) unit.y = unit.maxY;
    }
    if (pass >= RELAX.iterations - RELAX.settleIterations) continue;
    for (let i = 0; i < ordered.length; i += 1) {
      const unit = ordered[i]!;
      const seed = seeds[i]!;
      const pull = RELAX.anchor[unit.kind];
      unit.x += (seed.x - unit.x) * pull;
      unit.y += (seed.y - unit.y) * pull;
    }
  }
  for (const unit of ordered) {
    if (unit.maxY !== undefined && unit.y > unit.maxY) unit.y = unit.maxY;
    unit.x = round4(unit.x);
    unit.y = round4(unit.y);
  }
  return units;
}

/**
 * Relax one board's units, zone by zone. Zones are independent: a Project's
 * contents can never be pushed into a neighbouring Project, so a busy Project
 * cannot disturb a quiet one's addresses.
 */
function packBoardUnits(
  pieces: SpatialBoardPiece[],
  units: SpatialBoardDelegationUnit[]
): void {
  if (units.length === 0) return;
  const byZone = new Map<string, RelaxableUnit[]>();
  const pieceById = new Map<string, SpatialBoardPiece>();
  const unitById = new Map<string, SpatialBoardDelegationUnit>();
  const add = (zoneId: string, unit: RelaxableUnit) => {
    const bucket = byZone.get(zoneId);
    if (bucket) bucket.push(unit);
    else byZone.set(zoneId, [unit]);
  };
  // Only zones that actually contain a constellation need relaxing; everywhere
  // else the lattice is already correct and must not be perturbed.
  const contested = new Set(units.map(unit => unit.projectId));
  for (const piece of pieces) {
    if (piece.kind !== 'agent' || !piece.visible) continue;
    if (!contested.has(piece.projectId)) continue;
    pieceById.set(piece.id, piece);
    add(piece.projectId, {
      id: piece.id,
      x: piece.x,
      y: piece.y,
      radius: piece.size / 2,
      kind: 'agent',
    });
  }
  for (const unit of units) {
    unitById.set(unit.id, unit);
    add(unit.projectId, {
      id: unit.id,
      x: unit.x,
      y: unit.y,
      radius: unit.size / 2,
      kind: 'child',
      maxY: unit.parentY,
    });
  }
  for (const bucket of byZone.values()) {
    relaxBoardUnits(bucket);
    for (const relaxed of bucket) {
      const piece = pieceById.get(relaxed.id);
      if (piece) {
        piece.x = relaxed.x;
        piece.y = relaxed.y;
        continue;
      }
      const unit = unitById.get(relaxed.id);
      if (unit) {
        unit.x = relaxed.x;
        unit.y = relaxed.y;
      }
    }
  }
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

/**
 * A Project's address on the fleet lattice. `scale` spreads the whole lattice
 * uniformly when some Project has outgrown the default footprint, so Projects
 * never intersect and every Project keeps its grid coordinate — the fleet gets
 * bigger, nothing moves relative to anything else.
 */
function fleetZoneRect(
  slotIndex: number,
  agentCount: number,
  radius = fleetZoneRadius(agentCount),
  scale = 1
): SpatialBoardRect {
  const column = slotIndex % BOARD.columns;
  const row = Math.floor(slotIndex / BOARD.columns);
  const centerX =
    BOARD.fleetMaxRadius * scale + column * BOARD.fleetPitchX * scale;
  const centerY =
    BOARD.fleetMaxRadius * scale + row * BOARD.fleetPitchY * scale;
  return circleRect(centerX, centerY, radius);
}

/**
 * How far apart two Agent slots must sit.
 *
 * A bare Agent needs its own diameter. An Agent that has delegated needs its
 * whole constellation — the rosette reaches `orbitRadius` out plus a child's
 * radius — and two neighbouring constellations must not intersect. Deriving
 * the pitch from that requirement is what stops a child being placed further
 * from its parent than the next Agent is (measured at 85% overlap before this
 * existed: the pitch was a constant, and the constellation was not).
 */
function slotPitchFor(
  pieceSize: number,
  delegating: boolean,
  basePitch: number
): number {
  if (!delegating) return basePitch;
  const childRadius = (pieceSize * SPATIAL_DELEGATION_UNIT.childScale) / 2;
  const constellation =
    pieceSize * SPATIAL_DELEGATION_UNIT.orbitRadius + childRadius;
  // Neighbour spacing is `pitch * sqrt(3)` for this axial lattice.
  return Math.max(basePitch, (2 * constellation) / Math.sqrt(3));
}

/**
 * How much of its intended size a delegated constellation can actually have,
 * given the room its parent's slot owns.
 *
 * The rosette is specified at peer scale, which is right when you are close
 * enough to read individuals. At Fleet altitude the lattice is deliberately
 * tight — that density is the board's whole claim — so the same rosette would
 * reach past the neighbouring Agent. Rather than choose between "peers" and
 * "no overlap", the constellation takes the room that exists: full size where
 * there is room, scaled down where there is not, by ONE factor applied to both
 * the orbit and the child so the shape never distorts.
 *
 * Returns 1 when the constellation already fits.
 */
/**
 * The Agent size a slot can carry once its constellation has to fit beside it.
 *
 * At Fleet altitude the lattice is deliberately tight — that density is the
 * board's claim about how much is running — so a peer-scale rosette has
 * literally nowhere to go: parents sit `2.25` apart with radius `1.1`, a `0.05`
 * gap. The three things that cannot all be true are population-sized Projects,
 * peer-scale children, and no overlap.
 *
 * This keeps the first two and buys the room from the UNIT, not the Project:
 * where Agents delegate, the whole family renders finer so the constellation
 * fits inside the same population-sized circle. Where they do not, nothing
 * changes. Solving `orbit + childRadius <= spacing - parentRadius` for size:
 *
 *   2 * size * (orbitRatio + childScale/2) <= pitch * sqrt(3)
 */
function slotPieceSizeFor(
  pieceSize: number,
  pitch: number,
  delegating: boolean
): number {
  if (!delegating) return pieceSize;
  // Two neighbouring constellations must clear EACH OTHER, not merely each
  // other's parent: adjacent rosettes can point straight at one another, so
  // the requirement is `2 * constellationRadius <= spacing`.
  const constellation =
    SPATIAL_DELEGATION_UNIT.orbitRadius + SPATIAL_DELEGATION_UNIT.childScale / 2;
  const fits = (pitch * Math.sqrt(3)) / (2 * constellation);
  return round4(
    Math.max(pieceSize * SPATIAL_DELEGATION_UNIT.minimumUnitScale, Math.min(pieceSize, fits))
  );
}

/** Outer reach of one slot's contents, for sizing the Project that holds it. */
function slotReachFor(pieceSize: number, delegating: boolean): number {
  const childRadius = (pieceSize * SPATIAL_DELEGATION_UNIT.childScale) / 2;
  return delegating
    ? pieceSize * SPATIAL_DELEGATION_UNIT.orbitRadius + childRadius
    : pieceSize / 2;
}

/** The circle that actually contains `agentCount` slots at `pitch`. */
function contentRadiusFor(
  agentCount: number,
  pitch: number,
  reach: number
): number {
  return hexRingForCount(agentCount) * pitch * Math.sqrt(3) + reach;
}

function hexRingForCount(count: number): number {
  let ring = 0;
  while (1 + 3 * ring * (ring + 1) < Math.max(1, count)) ring += 1;
  return ring;
}

function projectZoneRect(
  slotIndex: number,
  agentCount: number,
  radius: number,
  scale = 1
): SpatialBoardRect {
  // Semantic altitude changes resolution, not address. Keep the focused
  // Project on its Fleet-lattice center so the camera and contents can carry
  // their current viewport through Fleet → Project → Agent.
  const fleetRect = fleetZoneRect(slotIndex, agentCount, undefined, scale);
  return circleRect(
    fleetRect.x + fleetRect.width / 2,
    fleetRect.y + fleetRect.height / 2,
    radius
  );
}

/** Circular footprint for aggregate density at focused Project altitude. */
function densityZoneRect(
  slotIndex: number,
  agentCount: number,
  scale = 1
): SpatialBoardRect {
  const contentRadius = Math.sqrt(
    (Math.min(agentCount, 4_000) * SPATIAL_DENSITY_ZONE_PITCH ** 2 * 1.25) /
      Math.PI
  );
  const radius = Math.max(
    BOARD.fleetMinRadius,
    contentRadius + BOARD.zoneLabelClearance + BOARD.zonePadding
  );
  const fleetRect = fleetZoneRect(slotIndex, agentCount, undefined, scale);
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
  slotPitch: number,
  unitSize: number,
  fleetRadius: number,
  latticeScale: number,
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
    slotPitch,
    unitSize,
    // The minimap is always the fixed Fleet footprint (F7), so it takes the
    // same fleet radius and lattice scale the world does.
    minimapRect: fleetZoneRect(slotIndex, agents.length, fleetRadius, latticeScale),
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
  const offset = axialSlotOffset(slotIndex, zone.slotPitch);
  return {
    x: round4(centerX + offset.x),
    y: round4(centerY + offset.y),
  };
}

function projectSlotPosition(
  zone: SpatialBoardProjectZone,
  slotIndex: number
): { x: number; y: number } {
  const offset = axialSlotOffset(slotIndex, zone.slotPitch);
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
                  startedAt:
                    typeof child.startedAt === 'number' ? child.startedAt : null,
                })),
            },
          }
        : {}),
      count: 1,
      x: position.x,
      y: position.y,
      size: zone.unitSize,
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
      size: zone.unitSize,
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

  // How much room each Project actually needs, before any of them are placed.
  // A Project whose Agents delegate has to hold their constellations; one whose
  // Agents do not stays exactly as tight as it was. The fleet then scales to
  // the largest of them, so Projects never intersect and every Project keeps
  // its grid coordinate.
  const delegatingZones = new Set<string>();
  for (const group of groups) {
    for (const agentId of group.agentIds) {
      if ((state.agents[agentId]?.delegation?.children?.length ?? 0) > 0) {
        delegatingZones.add(group.clusterId);
        break;
      }
    }
  }
  // A Project's circle stays POPULATION-sized (F7): its area is how the board
  // says how much is running, and letting delegation drive it would make a
  // small busy Project look bigger than a large quiet one. Delegation is
  // absorbed inside the slot instead — see `delegationFitFor`.
  const zoneFootprint = (group: ContextGroup, pieceSize: number, base: number) => ({
    pitch: base,
    radius:
      pieceSize === BOARD.fleetPieceSize
        ? fleetZoneRadius(group.agentIds.length)
        : Math.max(
            7,
            5.2 + hexRingForCount(group.agentIds.length) * base * 1.5
          ),
  });
  const fleetFootprints = new Map(
    groups.map(group => [
      group.clusterId,
      zoneFootprint(group, BOARD.fleetPieceSize, BOARD.fleetHexPitch),
    ] as const)
  );
  // Unit size is a property of the BOARD, not of a Project. Sizing it per
  // Project would make two Projects with the same population look different
  // for a reason nothing on screen explains; one resolution for the whole
  // board reads as the grain the fleet is drawn at.
  const anyDelegating = delegatingZones.size > 0;
  const fleetUnitSize = slotPieceSizeFor(
    BOARD.fleetPieceSize,
    BOARD.fleetHexPitch,
    anyDelegating
  );
  const detailedUnitSize = slotPieceSizeFor(
    BOARD.projectPieceHeight,
    BOARD.projectHexPitch,
    anyDelegating
  );
  const latticeScale = Math.max(
    1,
    ...[...fleetFootprints.values()].map(
      footprint => footprint.radius / BOARD.fleetMaxRadius
    )
  );

  const zones = groups.map(group => {
    const slotIndex =
      altitude === 'fleet'
        ? fleetSlots.get(group.clusterId)!
        : addressSlots.get(group.clusterId)!;
    const isAggregate = group.clusterId === 'aggregate:remaining-projects';
    const detailed =
      altitude !== 'fleet' && group.clusterId === focusedProjectId;
    const fleetFootprint = fleetFootprints.get(group.clusterId)!;
    const projectFootprint = zoneFootprint(
      group,
      BOARD.projectPieceHeight,
      BOARD.projectHexPitch
    );
    const rect = !detailed
      ? fleetZoneRect(
          slotIndex,
          group.agentIds.length,
          fleetFootprint.radius,
          latticeScale
        )
      : group.agentIds.length > maxProjectPiecesBudget
        ? densityZoneRect(slotIndex, group.agentIds.length, latticeScale)
        : projectZoneRect(
            slotIndex,
            group.agentIds.length,
            projectFootprint.radius,
            latticeScale
          );
    return projectZone(
      group,
      state,
      slotIndex,
      rect,
      detailed ? projectFootprint.pitch : fleetFootprint.pitch,
      detailed ? detailedUnitSize : fleetUnitSize,
      fleetFootprint.radius,
      latticeScale,
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

  // One packing pass over Agents AND their delegated children. Lattice slots
  // and rosettes are the seed; relaxation resolves the residual overlap a
  // lattice sized for bare Agents cannot avoid once constellations exist.
  const delegationUnits = seedDelegationUnits(pieces);
  packBoardUnits(pieces, delegationUnits);
  attachDelegationTethers(delegationUnits, pieces);

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
    delegationUnits,
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

export type SpatialSelectionDirection = 'up' | 'down' | 'left' | 'right';

/**
 * Arrow-key selection for the RTS board. Candidates live in the pressed
 * half-plane; distance is weighted by angular deviation so a nearby diagonal
 * Agent wins only when it is still a legible move in that direction.
 */
/**
 * What board navigation and band selection can land on (ENG-004 V3.4).
 *
 * Delegated children render as peers, so they are reachable — but they are not
 * Agents: no Session, no goal, no URL address, and nothing to direct yet. The
 * discriminated union is what keeps that distinction honest instead of
 * smuggling a child through an `agentId`-shaped hole.
 */
export type SpatialBoardTarget =
  | { kind: 'agent'; agentId: string }
  | {
      kind: 'child';
      /** Board-scoped unit id; unique across parents. */
      unitId: string;
      parentAgentId: string;
      /** The source's own child id. */
      childId: string;
    };

interface DirectionalCandidate {
  key: string;
  x: number;
  y: number;
  target: SpatialBoardTarget;
}

function directionalCandidates(
  layout: SpatialBoardLayout,
  units: readonly SpatialBoardDelegationUnit[]
): DirectionalCandidate[] {
  const candidates: DirectionalCandidate[] = [];
  for (const piece of layout.pieces) {
    if (piece.kind !== 'agent' || !piece.visible || !piece.agentId) continue;
    candidates.push({
      key: `agent:${piece.agentId}`,
      x: piece.x,
      y: piece.y,
      target: { kind: 'agent', agentId: piece.agentId },
    });
  }
  for (const unit of units) {
    // An overflow lobe stands for several Agents; walking onto it would claim
    // to select one of them.
    if (unit.kind !== 'child' || !unit.childId) continue;
    candidates.push({
      key: `child:${unit.id}`,
      x: unit.x,
      y: unit.y,
      target: {
        kind: 'child',
        unitId: unit.id,
        parentAgentId: unit.parentAgentId,
        childId: unit.childId,
      },
    });
  }
  return candidates;
}

function targetKey(target: SpatialBoardTarget | null): string | null {
  if (!target) return null;
  return target.kind === 'agent'
    ? `agent:${target.agentId}`
    : `child:${target.unitId}`;
}

/**
 * The nearest unit in the pressed direction, over board coordinates. Agents and
 * delegated children are one field: at peer scale, arrow navigation that skips
 * half of what is on screen reads as broken.
 */
export function selectSpatialDirectionalTarget(
  layout: SpatialBoardLayout,
  units: readonly SpatialBoardDelegationUnit[],
  current: SpatialBoardTarget | null,
  direction: SpatialSelectionDirection
): SpatialBoardTarget | null {
  const candidates = directionalCandidates(layout, units);
  if (candidates.length === 0) return null;
  const currentKey = targetKey(current);
  const from = currentKey
    ? candidates.find(candidate => candidate.key === currentKey)
    : undefined;
  const origin = from ?? {
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
  let best: DirectionalCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.key === currentKey) continue;
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
        candidate.key.localeCompare(best?.key ?? '') < 0)
    ) {
      best = candidate;
      bestScore = score;
    }
  }
  return best?.target ?? from?.target ?? null;
}

/** A band drag's catch: Agents and delegated children, kept apart. */
export interface SpatialBandSelection {
  agentIds: string[];
  /** Board-scoped delegation unit ids. */
  childUnitIds: string[];
}

/**
 * Band-hit selection over board coordinates. Piece centers act as RTS unit
 * points; a zone rendered as population dots is captured whole on intersection,
 * while a zone that owns individual pieces is never grabbed wholesale.
 *
 * Delegated children are captured as themselves, never folded into their
 * parent — a band over a constellation caught the workers, not one Agent.
 */
export function selectSpatialBandSelection(
  layout: SpatialBoardLayout,
  units: readonly SpatialBoardDelegationUnit[],
  band: SpatialBoardRect,
  visibleAgentIds?: ReadonlySet<string>
): SpatialBandSelection {
  const left = Math.min(band.x, band.x + band.width);
  const right = Math.max(band.x, band.x + band.width);
  const top = Math.min(band.y, band.y + band.height);
  const bottom = Math.max(band.y, band.y + band.height);
  const inside = (x: number, y: number) =>
    x >= left && x <= right && y >= top && y <= bottom;
  const captured = new Set<string>();
  const capturedChildren = new Set<string>();
  const pieceOwnedZones = new Set<string>();
  for (const piece of layout.pieces) {
    if (piece.kind !== 'agent' || !piece.visible || !piece.agentId) continue;
    pieceOwnedZones.add(piece.projectId);
    if (inside(piece.x, piece.y)) captured.add(piece.agentId);
  }
  for (const unit of units) {
    if (unit.kind !== 'child') continue;
    if (inside(unit.x, unit.y)) capturedChildren.add(unit.id);
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
  return { agentIds: [...captured], childUnitIds: [...capturedChildren] };
}

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

/**
 * Delegated children as board units (ENG-004 V3.4 / ENG-023 D3c). D3b drew one
 * punctuation-sized dot per child; operator dogfood found four real subagents
 * reading as four specks above one large parent, which conveys neither fan-out
 * nor that several Agents are doing the work.
 *
 * The policy here is pure so the R3F layer stays a damped executor: it decides
 * slot geometry, the overflow boundary, and lineage endpoints; the renderer
 * decides only material and motion.
 */
export const SPATIAL_DELEGATION_UNIT = {
  /** Child diameter as a fraction of the parent's. AMENDED 2026-08-07
   *  (operator): parents and children read mainly as PEERS. D3c's original
   *  0.72–0.82 band expressed lineage through size hierarchy; lineage now
   *  rides the spoke instead, and a delegated worker is not a lesser Agent.
   *  Held just under parity so the hub of a constellation is still findable. */
  childScale: 0.92,
  /** At or below this, every child is an individual unit. */
  individualLimit: SPATIAL_DELEGATION_SATELLITE_CAP,
  /** Above it, this many individuals plus one same-family overflow lobe. */
  individualsWhenOverflowing: 4,
  /** Center-to-center distance as a fraction of the parent's diameter. Sized
   *  so a real gap opens between the two bodies: at peer scale the spoke is
   *  what carries parentage, and a spoke with no visible run carries nothing. */
  orbitRadius: 1.14,
  /** Rosette center, degrees CCW from +x with +y UP (layout space is y-down,
   *  so this is converted on use). 90° is directly above the parent. */
  arcCenterDeg: 90,
  /** Widest angular step between neighbours, so two children never straddle
   *  the parent and the constellation stays a rosette rather than a ring. */
  maxStepDeg: 46,
  /** The rosette may reach the sides but never dip below them: the lane under
   *  the parent belongs to the DOM label, so slots stop at the horizontal. */
  maxHalfSpanDeg: 90,
  /** Floor on how far a constellation may be scaled down to fit its slot.
   *  Below this a child stops reading as a unit and becomes punctuation, which
   *  is the treatment D3c exists to replace. */
  /** Floor on shrinking an Agent to make room for its constellation. Below
   *  this the family stops reading as units at all. */
  minimumUnitScale: 0.4,
} as const;

/**
 * Marks a single parent can contribute: every child individually, or the
 * individuals plus one overflow lobe. Both branches top out at
 * `individualLimit`, which is what a renderer must budget per piece.
 */
export const SPATIAL_DELEGATION_MARKS_PER_PIECE =
  SPATIAL_DELEGATION_UNIT.individualLimit;

/**
 * Upper bound on delegation units the board can emit at once, so a renderer
 * can size a fixed instance buffer that CANNOT silently truncate. Fleet
 * altitude carries the larger piece budget, so it — not the focused-Project
 * budget — sets the ceiling.
 */
export const SPATIAL_DELEGATION_UNIT_CEILING =
  Math.max(DEFAULTS.maxFleetPieces, DEFAULTS.maxProjectPieces) *
  SPATIAL_DELEGATION_MARKS_PER_PIECE;

export interface SpatialBoardDelegationUnit {
  /** Stable across frames: lifecycle motion keys off this, so a redelivered or
   *  reordered event can never animate the wrong child. */
  id: string;
  parentPieceId: string;
  parentAgentId: string;
  /** Hub the constellation belongs to, in layout space. */
  parentX: number;
  parentY: number;
  projectId: string;
  kind: 'child' | 'overflow';
  /** The source's own child id, unprefixed — `id` is board-scoped, so this is
   *  what other surfaces (the selection panel, delegation events) key on. */
  childId: string | null;
  agentType: string | null;
  description: string | null;
  startedAt: number | null;
  /** Exact Agents the lobe stands for; 0 on an individual child. */
  overflowCount: number;
  x: number;
  y: number;
  size: number;
  /** Parent edge → child edge in layout space. Lineage only: the tether does
   *  not imply message flow, status, or command authority. */
  tether: { x1: number; y1: number; x2: number; y2: number };
}

function delegationSlotAngles(count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [SPATIAL_DELEGATION_UNIT.arcCenterDeg];
  const step = Math.min(
    SPATIAL_DELEGATION_UNIT.maxStepDeg,
    (SPATIAL_DELEGATION_UNIT.maxHalfSpanDeg * 2) / (count - 1)
  );
  return Array.from(
    { length: count },
    (_, index) =>
      SPATIAL_DELEGATION_UNIT.arcCenterDeg + (index - (count - 1) / 2) * step
  );
}

/**
 * Every live delegated child that should render as a unit, in deterministic
 * slots around its parent. Returns nothing for aggregated tiers by
 * construction: aggregate pieces carry no delegation, so a very-far fleet
 * never becomes a hairball of tethers.
 */
/**
 * Rosette seeds for one board's delegated children, before relaxation. Tethers
 * are deliberately absent here: they are drawn between FINAL positions, and
 * computing them from the seed would leave every spoke pointing at where a
 * child used to be.
 */
function seedDelegationUnits(
  pieces: readonly SpatialBoardPiece[]
): SpatialBoardDelegationUnit[] {
  const units: SpatialBoardDelegationUnit[] = [];
  for (const piece of pieces) {
    if (piece.kind !== 'agent' || !piece.visible || !piece.agentId) continue;
    const delegation = piece.delegation;
    if (!delegation || delegation.count <= 0) continue;
    const overflowing =
      delegation.count > SPATIAL_DELEGATION_UNIT.individualLimit;
    const individuals = overflowing
      ? delegation.children.slice(
          0,
          SPATIAL_DELEGATION_UNIT.individualsWhenOverflowing
        )
      : delegation.children;
    const remainder = overflowing ? delegation.count - individuals.length : 0;
    const marks = individuals.length + (remainder > 0 ? 1 : 0);
    const angles = delegationSlotAngles(marks);
    const size = piece.size * SPATIAL_DELEGATION_UNIT.childScale;
    const orbit = piece.size * SPATIAL_DELEGATION_UNIT.orbitRadius;
    for (let index = 0; index < marks; index += 1) {
      const radians = (angles[index]! * Math.PI) / 180;
      // Layout space is y-down, so a positive (upward) angle subtracts y.
      const x = piece.x + Math.cos(radians) * orbit;
      const y = piece.y - Math.sin(radians) * orbit;
      const child = individuals[index];
      const lobe = !child;
      units.push({
        id: lobe
          ? `delegation:${piece.id}:overflow`
          : `delegation:${piece.id}:${child!.id}`,
        parentPieceId: piece.id,
        parentAgentId: piece.agentId,
        parentX: piece.x,
        parentY: piece.y,
        projectId: piece.projectId,
        kind: lobe ? 'overflow' : 'child',
        childId: lobe ? null : child!.id,
        agentType: lobe ? null : child!.agentType,
        description: lobe ? null : child!.description,
        startedAt: lobe ? null : child!.startedAt,
        overflowCount: lobe ? remainder : 0,
        x: round4(x),
        y: round4(y),
        size: round4(size),
        tether: { x1: 0, y1: 0, x2: 0, y2: 0 },
      });
    }
  }
  return units;
}

/** Spoke endpoints from a unit's FINAL position: parent edge → child edge. */
function attachDelegationTethers(
  units: SpatialBoardDelegationUnit[],
  pieces: readonly SpatialBoardPiece[]
): void {
  const byId = new Map(pieces.map(piece => [piece.id, piece] as const));
  for (const unit of units) {
    const parent = byId.get(unit.parentPieceId);
    if (!parent) continue;
    unit.parentX = parent.x;
    unit.parentY = parent.y;
    const dx = unit.x - parent.x;
    const dy = unit.y - parent.y;
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    unit.tether = {
      x1: round4(parent.x + ux * parent.size * 0.5),
      y1: round4(parent.y + uy * parent.size * 0.5),
      x2: round4(unit.x - ux * unit.size * 0.5),
      y2: round4(unit.y - uy * unit.size * 0.5),
    };
  }
}

/**
 * Every delegated child the board is drawing, at its final relaxed position.
 * Computed during layout so Agents and children are packed as ONE field —
 * placing them in separate passes is what let a child land on a neighbouring
 * Agent (measured at 85% overlap on the demo fleet before this).
 */
export function selectSpatialDelegationUnits(
  layout: SpatialBoardLayout
): SpatialBoardDelegationUnit[] {
  return layout.delegationUnits;
}

export function compareSpatialBoardAttention(
  a: SpatialBoardPiece,
  b: SpatialBoardPiece
): number {
  const statusDelta = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  if (statusDelta !== 0) return statusDelta;
  return a.id.localeCompare(b.id);
}
