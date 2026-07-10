export interface FleetClusterCenter {
  x: number;
  y: number;
}

export interface FleetClusterExtent extends FleetClusterCenter {
  radius: number;
}

const CLUSTER_GAP = 1.7;

/**
 * Compact, aspect-friendly placement for the flagship sparse Fleet state.
 * Larger fleets retain the radial topology used by the instanced overview.
 */
export function fleetClusterCenters(
  count: number,
  maxLocalRadius: number
): FleetClusterCenter[] {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, y: 0 }];

  if (count <= 6) {
    const pitchX = Math.max(28, maxLocalRadius * 2.45);
    const pitchY = Math.max(22, maxLocalRadius * 2.05);
    const rows = count <= 3 ? [count] : count === 4 ? [2, 2] : [3, count - 3];
    const centers: FleetClusterCenter[] = [];
    const top = ((rows.length - 1) * pitchY) / 2;
    rows.forEach((columns, row) => {
      const left = -((columns - 1) * pitchX) / 2;
      for (let column = 0; column < columns; column++) {
        centers.push({
          x: left + column * pitchX,
          y: top - row * pitchY,
        });
      }
    });
    const meanX = centers.reduce((sum, center) => sum + center.x, 0) / count;
    const meanY = centers.reduce((sum, center) => sum + center.y, 0) / count;
    return centers.map(center => ({
      x: center.x - meanX,
      y: center.y - meanY,
    }));
  }

  const hasCenter = count >= 6;
  const ringCount = hasCenter ? count - 1 : count;
  const ringRadius =
    ringCount <= 1
      ? 0
      : (maxLocalRadius * CLUSTER_GAP) / Math.sin(Math.PI / ringCount);

  return Array.from({ length: count }, (_, index) => {
    if (hasCenter && index === 0) return { x: 0, y: 0 };
    const ringIndex = hasCenter ? index - 1 : index;
    const angle =
      (ringIndex / Math.max(ringCount, 1)) * Math.PI * 2 - Math.PI / 2;
    return {
      x: Math.cos(angle) * ringRadius,
      y: Math.sin(angle) * ringRadius,
    };
  });
}

export function isSparseFleetComposition(
  projectCount: number,
  agentCount: number
): boolean {
  return projectCount > 0 && projectCount <= 6 && agentCount <= 24;
}

export function fleetSceneRadius(extents: FleetClusterExtent[]): number {
  const minimum = extents.length <= 6 ? 26 : 40;
  let radius = minimum;
  for (const extent of extents) {
    radius = Math.max(radius, Math.hypot(extent.x, extent.y) + extent.radius);
  }
  return radius * 1.12;
}

export function sparseProjectBaySize(radius: number): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(22, radius * 2.5),
    height: Math.max(15, radius * 1.75),
  };
}
