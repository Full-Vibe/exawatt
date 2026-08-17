/**
 * Population dot fields (ENG-004 V3.1 — demo-scale rendering).
 *
 * Pure expansion of the board model's aggregate pieces (status + count per
 * zone) into deterministic per-agent hex units packed inside their circular
 * Project footprint. The renderer draws the whole field as a bounded set of
 * InstancedMeshes, so the
 * fleet's felt population scales to tens of thousands without per-agent React
 * elements, DOM labels, or draw calls.
 *
 * Honesty contract: dots are counted from real per-status populations and
 * banded in the board's status order. When a zone's population exceeds its
 * geometric capacity at the smallest dot pitch, the field downsamples with
 * largest-remainder proportional representation and reports `truncated`;
 * the zone's DOM control still carries the exact count.
 */

import {
  SPATIAL_BOARD_ZONE_METRICS,
  SPATIAL_DENSITY_ZONE_PITCH,
  type SpatialBoardPiece,
  type SpatialBoardProjectZone,
} from '@exawatt/ui-model';

/** Matches the board model's aggregate emission order (attention first). */
const STATUS_ORDER = [
  'blocked',
  'error',
  'reviewing',
  'working',
  'idle',
  'complete',
] as const;

export type PopulationStatus = (typeof STATUS_ORDER)[number];

const STATUS_INDEX = new Map<string, number>(
  STATUS_ORDER.map((status, index) => [status, index])
);

/** Largest→smallest dot pitch (world units). The renderer keeps dots readable
 *  when zones are quiet (a handful of agents get substantial marks) and lets
 *  dense zones read as population texture. Includes the shared density-zone
 *  sizing pitch so `densityZoneRect` can never budget for a pitch this packer
 *  cannot select (pinned by a unit test). */
export const PITCH_TIERS = [
  1.7,
  1.3,
  1.0,
  0.78,
  0.62,
  0.5,
  0.42,
  SPATIAL_DENSITY_ZONE_PITCH,
  0.28,
  0.22,
] as const;
/** Dot diameter as a fraction of pitch. */
const DOT_FILL = 0.62;

/** Dot-region insets, derived from the board model's shared zone metrics so a
 *  zone-geometry change in `@exawatt/ui-model` re-sizes the dot region with it.
 *  The multipliers are the tuned V3.1 clearances: dots start below the DOM
 *  zone-header chip with breathing room, and sit slightly inside the plate. */
const ZONE_PADDING = SPATIAL_BOARD_ZONE_METRICS.zonePadding * 0.8;
const ZONE_LABEL_CLEARANCE =
  SPATIAL_BOARD_ZONE_METRICS.zoneLabelClearance * 1.05;

export interface PopulationDotField {
  /** Dots actually emitted (≤ population when truncated). */
  count: number;
  /** Board-space coordinates (y grows downward, like SpatialBoardRect). */
  x: Float32Array;
  y: Float32Array;
  /** Dot diameter in world units, per dot (pitch varies per zone). */
  size: Float32Array;
  /** Index into POPULATION_STATUS_ORDER, per dot. */
  status: Uint8Array;
  /** Burn-lens intensity per dot, 0..1 from the zone's aggregate piece
   *  (ENG-008); -1 when the zone's usage is unreported (neutral unknown,
   *  never a zero on the ramp). */
  burn: Float32Array;
  /** Stable zone table plus per-dot zone/status ordinals for transition carry. */
  zoneIds: string[];
  zone: Uint16Array;
  ordinal: Uint32Array;
  /** Total population represented across all zones. */
  population: number;
  /** True when any zone had to downsample below its real population. */
  truncated: boolean;
}

export const POPULATION_STATUS_ORDER = STATUS_ORDER;

interface ZoneBand {
  status: number;
  count: number;
  /** 0..1 zone burn intensity; -1 = unreported. */
  burn: number;
}

function largestRemainderShare(bands: ZoneBand[], capacity: number): number[] {
  const total = bands.reduce((sum, band) => sum + band.count, 0);
  if (total <= capacity) return bands.map(band => band.count);
  const exact = bands.map(band => (band.count / total) * capacity);
  const floored = exact.map(Math.floor);
  let remaining = capacity - floored.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const entry of order) {
    if (remaining <= 0) break;
    // Never invent a dot for an empty band.
    if (bands[entry.index]!.count === 0) continue;
    floored[entry.index]! += 1;
    remaining -= 1;
  }
  // Minority pin: an attention-critical minority must never vanish (1 blocked
  // Agent among 10,000 idle would otherwise round to 0 dots). Every nonzero
  // band renders at least one dot, taking the slot from the largest band.
  // Bands arrive sorted attention-first, so if capacity is ever smaller than
  // the band count, attention statuses are pinned first.
  for (let index = 0; index < bands.length; index++) {
    if (bands[index]!.count === 0 || floored[index]! > 0) continue;
    let donor = -1;
    for (let candidate = 0; candidate < bands.length; candidate++) {
      if (candidate === index || floored[candidate]! < 2) continue;
      if (donor === -1 || floored[candidate]! > floored[donor]!) {
        donor = candidate;
      }
    }
    if (donor === -1) continue; // capacity below the nonzero-band count
    floored[donor]! -= 1;
    floored[index]! += 1;
  }
  return floored;
}

/**
 * Choose which slots a zone's population actually occupies.
 *
 * The slot grid is generated by scanning rows down the circle, so filling it in
 * generation order packs a zone's population into the TOP rows and leaves the
 * rest of the circle empty. A six-Agent Project therefore read as a short bar
 * hanging under its own label rather than as a small Project, and the emptiness
 * grew with the circle: the more room a Project had, the more of it went
 * unused, so the biggest Projects looked the barest.
 *
 * Taking the slots nearest the middle instead makes the population a centred
 * mass whose radius grows with the count -- the circle says how much room the
 * Project has and the mass says how much of it is running, which is the
 * comparison the board exists to support. Emission order stays row-major so the
 * status bands keep reading top to bottom.
 */
function centeredSlots(
  slots: Array<{ x: number; y: number }>,
  zone: SpatialBoardProjectZone,
  needed: number
): Array<{ x: number; y: number }> {
  if (needed >= slots.length) return slots;
  const centerX = zone.rect.x + zone.radius;
  const centerY = zone.rect.y + zone.radius;
  const distance = (slot: { x: number; y: number }) =>
    (slot.x - centerX) ** 2 + (slot.y - centerY) ** 2;
  return slots
    .map((slot, index) => ({ slot, index, d: distance(slot) }))
    // `index` breaks ties so a symmetric ring can never depend on sort
    // stability: the field has to be identical on every run.
    .sort((a, b) => a.d - b.d || a.index - b.index)
    .slice(0, needed)
    .sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x || a.index - b.index)
    .map(entry => entry.slot);
}

/**
 * Expand every aggregate piece into its zone's dot field. Zones whose pieces
 * are individual Agents contribute nothing (they render as full pieces).
 */
export function computePopulationDotField(
  zones: readonly SpatialBoardProjectZone[],
  pieces: readonly SpatialBoardPiece[]
): PopulationDotField {
  const zoneById = new Map(zones.map(zone => [zone.id, zone]));
  const bandsByZone = new Map<string, ZoneBand[]>();
  let population = 0;
  for (const piece of pieces) {
    if (piece.kind !== 'aggregate' || !piece.visible) continue;
    const zone = zoneById.get(piece.projectId);
    if (!zone || !zone.visible) continue;
    const statusIndex = STATUS_INDEX.get(piece.status);
    if (statusIndex === undefined || piece.count <= 0) continue;
    const bands = bandsByZone.get(piece.projectId) ?? [];
    bands.push({
      status: statusIndex,
      count: piece.count,
      burn: piece.burnIntensity ?? -1,
    });
    bandsByZone.set(piece.projectId, bands);
    population += piece.count;
  }

  // First pass: capacity per zone, emitted counts.
  const emitPlans: Array<{
    zone: SpatialBoardProjectZone;
    bands: ZoneBand[];
    shares: number[];
    pitch: number;
    slots: Array<{ x: number; y: number }>;
  }> = [];
  let emitted = 0;
  let truncated = false;
  for (const [zoneId, bands] of bandsByZone) {
    const zone = zoneById.get(zoneId)!;
    bands.sort((a, b) => a.status - b.status);
    const total = bands.reduce((sum, band) => sum + band.count, 0);
    let pitch = PITCH_TIERS[PITCH_TIERS.length - 1]!;
    let slots: Array<{ x: number; y: number }> = [];
    let capacity = 0;
    for (const tier of PITCH_TIERS) {
      const nextSlots: Array<{ x: number; y: number }> = [];
      const centerX = zone.rect.x + zone.radius;
      const centerY = zone.rect.y + zone.radius;
      const usableRadius = Math.max(tier, zone.radius - ZONE_PADDING);
      const minY = centerY - usableRadius + ZONE_LABEL_CLEARANCE;
      const maxY = centerY + usableRadius;
      const rowCount = Math.max(1, Math.floor((maxY - minY) / tier) + 1);
      for (let row = 0; row < rowCount; row += 1) {
        const y = minY + row * tier;
        const dy = y - centerY;
        const halfWidth = Math.sqrt(
          Math.max(0, usableRadius * usableRadius - dy * dy)
        );
        const columns = Math.max(1, Math.floor((halfWidth * 2) / tier) + 1);
        const offset = row % 2 === 0 ? 0 : tier * 0.5;
        const startX = centerX - ((columns - 1) * tier) / 2 + offset;
        for (let column = 0; column < columns; column += 1) {
          const x = startX + column * tier;
          const dx = x - centerX;
          if (dx * dx + dy * dy > usableRadius * usableRadius) continue;
          nextSlots.push({ x, y });
        }
      }
      if (nextSlots.length >= total) {
        pitch = tier;
        slots = nextSlots;
        capacity = nextSlots.length;
        break;
      }
      pitch = tier;
      slots = nextSlots;
      capacity = nextSlots.length;
    }
    const shares = largestRemainderShare(bands, capacity);
    const zoneEmit = shares.reduce((sum, value) => sum + value, 0);
    if (zoneEmit < total) truncated = true;
    emitPlans.push({
      zone,
      bands,
      shares,
      pitch,
      slots: centeredSlots(slots, zone, zoneEmit),
    });
    emitted += zoneEmit;
  }

  const x = new Float32Array(emitted);
  const y = new Float32Array(emitted);
  const size = new Float32Array(emitted);
  const status = new Uint8Array(emitted);
  const burn = new Float32Array(emitted);
  const zoneIds = emitPlans.map(plan => plan.zone.id);
  const zone = new Uint16Array(emitted);
  const ordinal = new Uint32Array(emitted);
  let cursor = 0;
  for (let zoneIndex = 0; zoneIndex < emitPlans.length; zoneIndex++) {
    const plan = emitPlans[zoneIndex]!;
    let slot = 0;
    for (let band = 0; band < plan.bands.length; band++) {
      const share = plan.shares[band]!;
      for (let index = 0; index < share; index++) {
        x[cursor] = plan.slots[slot]!.x;
        y[cursor] = plan.slots[slot]!.y;
        size[cursor] = plan.pitch * DOT_FILL;
        status[cursor] = plan.bands[band]!.status;
        burn[cursor] = plan.bands[band]!.burn;
        zone[cursor] = zoneIndex;
        ordinal[cursor] = index;
        cursor += 1;
        slot += 1;
      }
    }
  }

  return {
    count: emitted,
    x,
    y,
    size,
    status,
    burn,
    zoneIds,
    zone,
    ordinal,
    population,
    truncated,
  };
}
