import type { ClusterInfo, FieldAgent } from './agent-field-types';

export interface ProjectUnitPlacement {
  agent: FieldAgent;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectDeckLayout {
  cluster: ClusterInfo;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  units: ProjectUnitPlacement[];
}

function columnCount(count: number): number {
  if (count <= 2) return Math.max(count, 1);
  if (count <= 8) return 2;
  if (count <= 18) return 3;
  return 4;
}

/**
 * Stable Project-altitude layout. It deliberately uses agent IDs rather than
 * status order so live state changes never teleport units.
 */
export function layoutProjectDeck(
  agents: FieldAgent[],
  cluster: ClusterInfo
): ProjectDeckLayout {
  const members = agents
    .filter(agent => agent.cluster === cluster.index)
    .sort((a, b) => a.id.localeCompare(b.id));
  const columns = columnCount(members.length);
  const compact = members.length > 18;
  const unitWidth = compact ? 17 : 22;
  const unitHeight = compact ? 8 : 11;
  const columnGap = compact ? 3 : 4;
  const rowGap = compact ? 3 : 4;
  const rows = Math.max(1, Math.ceil(members.length / columns));
  const contentWidth = columns * unitWidth + (columns - 1) * columnGap;
  const contentHeight = rows * unitHeight + (rows - 1) * rowGap;
  const width = Math.max(36, contentWidth + 12);
  const height = Math.max(28, contentHeight + 16);
  const top = cluster.cy + contentHeight / 2;
  const units: ProjectUnitPlacement[] = [];

  for (let index = 0; index < members.length; index++) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const remaining = members.length - row * columns;
    const columnsInRow = Math.min(columns, remaining);
    const rowWidth = columnsInRow * unitWidth + (columnsInRow - 1) * columnGap;
    const left = cluster.cx - rowWidth / 2 + unitWidth / 2;
    units.push({
      agent: members[index],
      x: left + column * (unitWidth + columnGap),
      y: top - row * (unitHeight + rowGap) - unitHeight / 2,
      width: unitWidth,
      height: unitHeight,
    });
  }

  return {
    cluster,
    centerX: cluster.cx,
    centerY: cluster.cy,
    width,
    height,
    units,
  };
}

export function projectUnitPosition(
  layout: ProjectDeckLayout,
  agentId: string
): { x: number; y: number } | null {
  const unit = layout.units.find(entry => entry.agent.id === agentId);
  return unit ? { x: unit.x, y: unit.y } : null;
}
