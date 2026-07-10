import { describe, expect, it } from 'vitest';
import {
  fleetClusterCenters,
  fleetSceneRadius,
  isSparseFleetComposition,
  sparseProjectBaySize,
} from './agent-field-fleet-layout';

describe('sparse Fleet composition', () => {
  it('places two Projects side by side instead of on a vertical ring', () => {
    const centers = fleetClusterCenters(2, 8);

    expect(centers).toEqual([
      { x: -14, y: 0 },
      { x: 14, y: 0 },
    ]);
  });

  it('uses compact balanced rows for one through six Projects', () => {
    for (let count = 1; count <= 6; count++) {
      const centers = fleetClusterCenters(count, 8);
      expect(centers).toHaveLength(count);
      const meanX = centers.reduce((sum, point) => sum + point.x, 0) / count;
      const meanY = centers.reduce((sum, point) => sum + point.y, 0) / count;
      expect(meanX).toBeCloseTo(0);
      expect(meanY).toBeCloseTo(0);
    }
  });

  it('retains a center-plus-ring topology beyond the sparse threshold', () => {
    const centers = fleetClusterCenters(7, 12);

    expect(centers[0]).toEqual({ x: 0, y: 0 });
    expect(
      centers.slice(1).every(point => Math.hypot(point.x, point.y) > 12)
    ).toBe(true);
  });

  it('uses the sparse visual regime only for bounded small fleets', () => {
    expect(isSparseFleetComposition(2, 3)).toBe(true);
    expect(isSparseFleetComposition(6, 24)).toBe(true);
    expect(isSparseFleetComposition(7, 12)).toBe(false);
    expect(isSparseFleetComposition(3, 25)).toBe(false);
  });

  it('frames sparse extents without the former radius-40 floor', () => {
    expect(
      fleetSceneRadius([
        { x: -14, y: 0, radius: 8 },
        { x: 14, y: 0, radius: 8 },
      ])
    ).toBeCloseTo(29.12);
  });

  it('sizes Project bays from content with a readable minimum', () => {
    expect(sparseProjectBaySize(8)).toEqual({ width: 22, height: 15 });
    expect(sparseProjectBaySize(16)).toEqual({ width: 40, height: 28 });
  });
});
