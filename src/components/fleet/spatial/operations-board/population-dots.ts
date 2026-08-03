/**
 * Population dot fields (ENG-004 V3.1 — demo-scale rendering).
 *
 * Pure expansion of the board model's aggregate pieces (status + count per
 * zone) into deterministic per-agent density dots packed inside their zone
 * rect. The renderer draws the whole field as ONE InstancedMesh, so the
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
const ZONE_PADDING_X = SPATIAL_BOARD_ZONE_METRICS.zonePadding * 0.8;
const ZONE_HEADER = SPATIAL_BOARD_ZONE_METRICS.zoneHeaderHeight * 1.2;
const ZONE_PADDING_BOTTOM = SPATIAL_BOARD_ZONE_METRICS.zonePadding * 0.45;

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
    columns: number;
    startX: number;
    startY: number;
  }> = [];
  let emitted = 0;
  let truncated = false;
  for (const [zoneId, bands] of bandsByZone) {
    const zone = zoneById.get(zoneId)!;
    bands.sort((a, b) => a.status - b.status);
    const total = bands.reduce((sum, band) => sum + band.count, 0);
    const regionWidth = Math.max(1, zone.rect.width - ZONE_PADDING_X * 2);
    const regionHeight = Math.max(
      1,
      zone.rect.height - ZONE_HEADER - ZONE_PADDING_BOTTOM
    );
    let pitch = PITCH_TIERS[PITCH_TIERS.length - 1]!;
    let columns = 1;
    let capacity = 0;
    for (const tier of PITCH_TIERS) {
      const cols = Math.max(1, Math.floor(regionWidth / tier));
      const rows = Math.max(1, Math.floor(regionHeight / tier));
      if (cols * rows >= total) {
        pitch = tier;
        columns = cols;
        capacity = cols * rows;
        break;
      }
      pitch = tier;
      columns = cols;
      capacity = cols * rows;
    }
    const shares = largestRemainderShare(bands, capacity);
    const zoneEmit = shares.reduce((sum, value) => sum + value, 0);
    if (zoneEmit < total) truncated = true;
    const usedColumns = Math.min(columns, Math.max(1, zoneEmit));
    const rows = Math.ceil(Math.max(1, zoneEmit) / columns);
    const contentWidth = usedColumns * pitch;
    const contentHeight = rows * pitch;
    const startX =
      zone.rect.x + ZONE_PADDING_X + (regionWidth - contentWidth) / 2 + pitch / 2;
    const startY =
      zone.rect.y + ZONE_HEADER + Math.max(0, (regionHeight - contentHeight) / 2) + pitch / 2;
    emitPlans.push({ zone, bands, shares, pitch, columns, startX, startY });
    emitted += zoneEmit;
  }

  const x = new Float32Array(emitted);
  const y = new Float32Array(emitted);
  const size = new Float32Array(emitted);
  const status = new Uint8Array(emitted);
  const burn = new Float32Array(emitted);
  let cursor = 0;
  for (const plan of emitPlans) {
    let slot = 0;
    for (let band = 0; band < plan.bands.length; band++) {
      const share = plan.shares[band]!;
      for (let index = 0; index < share; index++) {
        const column = slot % plan.columns;
        const row = Math.floor(slot / plan.columns);
        x[cursor] = plan.startX + column * plan.pitch;
        y[cursor] = plan.startY + row * plan.pitch;
        size[cursor] = plan.pitch * DOT_FILL;
        status[cursor] = plan.bands[band]!.status;
        burn[cursor] = plan.bands[band]!.burn;
        cursor += 1;
        slot += 1;
      }
    }
  }

  return { count: emitted, x, y, size, status, burn, population, truncated };
}
