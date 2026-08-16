import { describe, expect, it } from 'vitest';
import {
  SPATIAL_DENSITY_ZONE_PITCH,
  type SpatialBoardPiece,
  type SpatialBoardProjectZone,
} from '@exawatt/ui-model';
import {
  computePopulationDotField,
  PITCH_TIERS,
  POPULATION_STATUS_ORDER,
} from './population-dots';

function zone(
  id: string,
  rect: { x: number; y: number; width: number; height: number },
  visible = true
): SpatialBoardProjectZone {
  return {
    id,
    slotIndex: 0,
    label: id,
    agentIds: [],
    rect,
    slotPitch: 1.3,
  unitSize: 2.2,
  radius: rect.width / 2,
    minimapRect: rect,
    visible,
    selected: false,
    isAggregate: false,
    aggregatedProjectCount: 0,
    agentCount: 0,
    visibleAgentCount: 0,
    activeCount: 0,
    blockedCount: 0,
    attentionPressure: 0,
    costRate: 0,
    dominantStatus: 'idle',
    statusCounts: {
      working: 0,
      blocked: 0,
      reviewing: 0,
      idle: 0,
      complete: 0,
      error: 0,
    },
    burn: null,
  };
}

function aggregate(
  projectId: string,
  status: SpatialBoardPiece['status'],
  count: number,
  visible = true
): SpatialBoardPiece {
  return {
    id: `aggregate:${projectId}:${status}`,
    slotIndex: 0,
    kind: 'aggregate',
    projectId,
    agentId: null,
    label: status,
    summary: `${count} ${status}`,
    status,
    count,
    x: 0,
    y: 0,
    size: 2,
    visible,
    selected: false,
    needsAttention: false,
    burnIntensity: null,
    labelVisibility: 'always',
  };
}

const FLEET_RECT = { x: 0, y: 0, width: 24, height: 24 };

describe('computePopulationDotField', () => {
  it('emits one dot per counted agent when the zone has capacity', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    const pieces = [
      aggregate('project:a', 'blocked', 3),
      aggregate('project:a', 'working', 5),
      aggregate('project:a', 'idle', 4),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.count).toBe(12);
    expect(field.population).toBe(12);
    expect(field.truncated).toBe(false);
    // Banded in board status order: blocked dots come first.
    const blockedIndex = POPULATION_STATUS_ORDER.indexOf('blocked');
    for (let index = 0; index < 3; index++) {
      expect(field.status[index]).toBe(blockedIndex);
    }
  });

  it('keeps every dot inside its zone rect', () => {
    const rect = { x: 29, y: 16.5, width: 24, height: 24 };
    const zones = [zone('project:a', rect)];
    const pieces = [aggregate('project:a', 'idle', 200)];
    const field = computePopulationDotField(zones, pieces);
    expect(field.count).toBe(200);
    for (let index = 0; index < field.count; index++) {
      expect(field.x[index]).toBeGreaterThan(rect.x);
      expect(field.x[index]).toBeLessThan(rect.x + rect.width);
      expect(field.y[index]).toBeGreaterThan(rect.y);
      expect(field.y[index]).toBeLessThan(rect.y + rect.height);
      const dx = field.x[index]! - (rect.x + rect.width / 2);
      const dy = field.y[index]! - (rect.y + rect.height / 2);
      expect(Math.hypot(dx, dy)).toBeLessThan(rect.width / 2);
    }
  });

  it('uses larger dots for sparse populations than dense ones', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    const sparse = computePopulationDotField(zones, [
      aggregate('project:a', 'working', 5),
    ]);
    const dense = computePopulationDotField(zones, [
      aggregate('project:a', 'working', 900),
    ]);
    expect(sparse.size[0]!).toBeGreaterThan(dense.size[0]! * 2);
  });

  it('downsamples proportionally when population exceeds capacity', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    const pieces = [
      aggregate('project:a', 'blocked', 1_000),
      aggregate('project:a', 'idle', 9_000),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.truncated).toBe(true);
    expect(field.count).toBeLessThan(10_000);
    expect(field.count).toBeGreaterThan(100);
    const blockedIndex = POPULATION_STATUS_ORDER.indexOf('blocked');
    const blockedDots = Array.from(field.status).filter(
      status => status === blockedIndex
    ).length;
    const share = blockedDots / field.count;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.13);
  });

  it('ignores agent pieces, hidden pieces, and hidden zones', () => {
    const zones = [
      zone('project:a', FLEET_RECT),
      zone('project:hidden', FLEET_RECT, false),
    ];
    const pieces: SpatialBoardPiece[] = [
      { ...aggregate('project:a', 'idle', 4), kind: 'agent', agentId: 'x' },
      aggregate('project:a', 'working', 2, false),
      aggregate('project:hidden', 'idle', 9),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.count).toBe(0);
  });

  it('never drops a nonzero minority band when truncating', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    // 1 blocked Agent among 10,000: proportional share rounds to 0 dots, but
    // an attention-critical status must never disappear from the field.
    const pieces = [
      aggregate('project:a', 'blocked', 1),
      aggregate('project:a', 'idle', 9_999),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.truncated).toBe(true);
    const blockedIndex = POPULATION_STATUS_ORDER.indexOf('blocked');
    const blockedDots = Array.from(field.status).filter(
      status => status === blockedIndex
    ).length;
    expect(blockedDots).toBeGreaterThanOrEqual(1);
    // The pinned dot is banded first (attention-first status order).
    expect(field.status[0]).toBe(blockedIndex);
  });

  it('pins every nonzero band, not just the first, at extreme skew', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    const pieces = [
      aggregate('project:a', 'blocked', 1),
      aggregate('project:a', 'error', 1),
      aggregate('project:a', 'reviewing', 1),
      aggregate('project:a', 'working', 20_000),
      aggregate('project:a', 'idle', 20_000),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.truncated).toBe(true);
    const seen = new Set(field.status);
    for (const status of ['blocked', 'error', 'reviewing'] as const) {
      expect(seen.has(POPULATION_STATUS_ORDER.indexOf(status))).toBe(true);
    }
  });

  it('stays exact (untruncated) when population equals zone capacity', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    // Discover the zone's geometric capacity at the smallest pitch by
    // overfilling it, then refill with exactly that population.
    const overfilled = computePopulationDotField(zones, [
      aggregate('project:a', 'idle', 1_000_000),
    ]);
    expect(overfilled.truncated).toBe(true);
    const capacity = overfilled.count;
    const atCapacity = computePopulationDotField(zones, [
      aggregate('project:a', 'idle', capacity),
    ]);
    expect(atCapacity.truncated).toBe(false);
    expect(atCapacity.count).toBe(capacity);
    expect(atCapacity.population).toBe(capacity);
    const overCapacity = computePopulationDotField(zones, [
      aggregate('project:a', 'idle', capacity + 1),
    ]);
    expect(overCapacity.truncated).toBe(true);
    expect(overCapacity.count).toBeLessThanOrEqual(capacity);
  });

  it('bands each zone independently in a multi-zone field', () => {
    const rectA = { x: 0, y: 0, width: 24, height: 24 };
    const rectB = { x: 40, y: 20, width: 24, height: 24 };
    const zones = [zone('project:a', rectA), zone('project:b', rectB)];
    const pieces = [
      aggregate('project:a', 'working', 6),
      aggregate('project:a', 'blocked', 2),
      aggregate('project:b', 'idle', 5),
      aggregate('project:b', 'error', 3),
    ];
    const field = computePopulationDotField(zones, pieces);
    expect(field.count).toBe(16);
    expect(field.population).toBe(16);
    expect(field.truncated).toBe(false);
    const inRect = (
      index: number,
      rect: { x: number; y: number; width: number; height: number }
    ) =>
      field.x[index]! > rect.x &&
      field.x[index]! < rect.x + rect.width &&
      field.y[index]! > rect.y &&
      field.y[index]! < rect.y + rect.height;
    const statuses = (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) =>
      Array.from({ length: field.count }, (_, index) => index)
        .filter(index => inRect(index, rect))
        .map(index => field.status[index]!);
    const zoneA = statuses(rectA);
    const zoneB = statuses(rectB);
    expect(zoneA.length).toBe(8);
    expect(zoneB.length).toBe(8);
    // Every dot lands in exactly one zone, banded attention-first per zone.
    const blocked = POPULATION_STATUS_ORDER.indexOf('blocked');
    const working = POPULATION_STATUS_ORDER.indexOf('working');
    const error = POPULATION_STATUS_ORDER.indexOf('error');
    const idle = POPULATION_STATUS_ORDER.indexOf('idle');
    expect(zoneA).toEqual([
      ...Array(2).fill(blocked),
      ...Array(6).fill(working),
    ]);
    expect(zoneB).toEqual([...Array(3).fill(error), ...Array(5).fill(idle)]);
    expect(field.zoneIds).toEqual(['project:a', 'project:b']);
    expect(Array.from(field.zone).filter(index => index === 0)).toHaveLength(8);
    expect(Array.from(field.zone).filter(index => index === 1)).toHaveLength(8);
  });

  it('keeps the shared density-zone sizing pitch selectable', () => {
    // densityZoneRect budgets area at this pitch; the packer must be able to
    // select it (and everything smaller) or density zones silently missize.
    expect(PITCH_TIERS).toContain(SPATIAL_DENSITY_ZONE_PITCH);
    expect(Math.min(...PITCH_TIERS)).toBeLessThanOrEqual(
      SPATIAL_DENSITY_ZONE_PITCH
    );
  });

  it('is deterministic for identical input', () => {
    const zones = [zone('project:a', FLEET_RECT)];
    const pieces = [
      aggregate('project:a', 'blocked', 40),
      aggregate('project:a', 'idle', 260),
    ];
    const first = computePopulationDotField(zones, pieces);
    const second = computePopulationDotField(zones, pieces);
    expect(Array.from(first.x)).toEqual(Array.from(second.x));
    expect(Array.from(first.y)).toEqual(Array.from(second.y));
    expect(Array.from(first.status)).toEqual(Array.from(second.status));
  });
});
