import { describe, expect, it } from 'vitest';
import type {
  SpatialBoardPiece,
  SpatialBoardProjectZone,
} from '@exawatt/ui-model';
import {
  computePopulationDotField,
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
    labelVisibility: 'always',
  };
}

const FLEET_RECT = { x: 0, y: 0, width: 24, height: 11.5 };

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
    const rect = { x: 29, y: 16.5, width: 24, height: 11.5 };
    const zones = [zone('project:a', rect)];
    const pieces = [aggregate('project:a', 'idle', 200)];
    const field = computePopulationDotField(zones, pieces);
    expect(field.count).toBe(200);
    for (let index = 0; index < field.count; index++) {
      expect(field.x[index]).toBeGreaterThan(rect.x);
      expect(field.x[index]).toBeLessThan(rect.x + rect.width);
      expect(field.y[index]).toBeGreaterThan(rect.y);
      expect(field.y[index]).toBeLessThan(rect.y + rect.height);
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
