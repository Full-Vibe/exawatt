import type { SpatialBoardLayout, SpatialBoardRect } from '@exawatt/ui-model';
import type { TileInstance } from '@/components/tiles/tile-contract';
import { boardTileModel } from '@/components/fleet/spatial/operations-board/tiles/board-tiles-model';
import { hexSpiral, axialKey, type Axial } from '@/components/tiles/hex';

const PITCH = 1.04;
function point(cell: Axial) {
  return {
    x: Math.sqrt(3) * PITCH * (cell.q + cell.r / 2),
    y: 1.5 * PITCH * cell.r,
  };
}

/** Gallery presentation addresses. Source identities, readings and census stay
 * immutable. Bodies, sockets, lineage and input all consume this one mapping. */
export function qualityModel(
  layout: SpatialBoardLayout,
  marks: Readonly<Record<string, string>>
) {
  const existing = boardTileModel(layout, marks);
  const tiles: TileInstance[] = [];
  const ground: TileInstance[] = [];
  const targets: {
    tile: TileInstance;
    label: string;
    agentId: string | null;
    parentAgentId?: string;
    childId?: string;
    stopped: boolean;
    overflow: number;
  }[] = [];
  const tethers: [number, number, number][] = [];
  const territories: {
    zone: SpatialBoardLayout['zones'][number];
    rect: SpatialBoardRect;
  }[] = [];
  const zones = layout.zones.filter(zone => zone.visible);
  const columns = Math.max(1, Math.ceil(Math.sqrt(zones.length * 1.35)));
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const [zoneIndex, zone] of zones.entries()) {
    const local: TileInstance[] = [];
    const occupied = new Map<string, Axial>();
    const allocate = (near: Axial): Axial => {
      for (let ring = 0; ; ring++) {
        for (const candidate of hexSpiral(near, ring).filter(
          item => item.ring === ring
        )) {
          const key = axialKey(candidate.axial);
          if (!occupied.has(key)) {
            occupied.set(key, candidate.axial);
            return candidate.axial;
          }
        }
      }
    };
    const roots = layout.pieces.filter(
      piece =>
        piece.visible && piece.kind === 'agent' && piece.projectId === zone.id
    );
    const rootCells = hexSpiral(
      { q: 0, r: 0 },
      Math.ceil(Math.sqrt(roots.length))
    );
    const localTethers: [TileInstance, TileInstance][] = [];
    for (const [index, piece] of roots.entries()) {
      const seed = rootCells[index]!.axial;
      const hasChildren = layout.delegationUnits.some(
        unit => unit.projectId === zone.id
      );
      const clusterColumns = Math.ceil(Math.sqrt(roots.length * 1.5));
      const row = Math.floor(index / clusterColumns);
      const cell = allocate(
        hasChildren
          ? { q: (index % clusterColumns) * 4 - row * 2, r: row * 4 }
          : seed
      );
      const source = existing.agents.find(tile => tile.id === piece.id)!;
      const tile: TileInstance = {
        ...source,
        ...point(cell),
        radius: 0.9,
        elevation: 0.08,
        status: piece.sessionState === 'stopped' ? undefined : source.status,
      };
      local.push(tile);
      targets.push({
        tile,
        label: `${piece.label} · ${piece.sessionState === 'stopped' ? 'Stopped' : piece.status}`,
        agentId: piece.agentId,
        stopped: piece.sessionState === 'stopped',
        overflow: 0,
      });
      for (const unit of layout.delegationUnits.filter(
        unit => unit.parentPieceId === piece.id
      )) {
        const child: TileInstance = {
          id: unit.id,
          agentId: unit.kind === 'child' ? unit.id : undefined,
          ...point(allocate(cell)),
          radius: unit.kind === 'child' ? 0.68 : 0.58,
          elevation: 0.04,
          status: unit.kind === 'child' ? 'active' : undefined,
          phase: index * 0.618,
        };
        local.push(child);
        localTethers.push([tile, child]);
        targets.push({
          tile: child,
          label:
            unit.kind === 'overflow'
              ? `${unit.overflowCount} more delegated Agents`
              : `${unit.description ?? unit.agentType ?? 'Delegated Agent'} · Working`,
          agentId: null,
          parentAgentId: unit.parentAgentId,
          childId: unit.childId ?? undefined,
          stopped: false,
          overflow: unit.overflowCount ?? 0,
        });
      }
    }
    const population = existing.population.filter(tile =>
      tile.id.startsWith(`population:${zone.id}:`)
    );
    const populationCells = hexSpiral(
      { q: 0, r: 0 },
      Math.ceil(Math.sqrt(population.length / 3)) + 1
    );
    for (const [index, source] of population.entries()) {
      local.push({
        ...source,
        ...point(allocate(populationCells[index]!.axial)),
        radius: 0.84,
        elevation: 0.06,
      });
    }
    if (!local.length) continue;
    const floorCells = new Map(occupied);
    for (const cell of occupied.values()) {
      for (const neighbor of hexSpiral(cell, 1))
        floorCells.set(axialKey(neighbor.axial), neighbor.axial);
    }
    const floor = [...floorCells].map(([key, cell]) => ({
      id: `land:${zone.id}:${key}`,
      ...point(cell),
      radius: 1.17,
      elevation: -0.29,
      ring: 0,
    }));
    const minX = Math.min(...floor.map(tile => tile.x)) - 1;
    const minY = Math.min(...floor.map(tile => tile.y)) - 1;
    const width = Math.max(...floor.map(tile => tile.x)) + 1 - minX;
    const height = Math.max(...floor.map(tile => tile.y)) + 1 - minY;
    if (zoneIndex % columns === 0 && zoneIndex > 0) {
      cursorX = 0;
      cursorY += rowHeight + 5;
      rowHeight = 0;
    }
    const dx = cursorX - minX;
    const dy = cursorY - minY;
    for (const tile of [...local, ...floor]) {
      tile.x += dx;
      tile.y += dy;
    }
    for (const [parent, child] of localTethers)
      tethers.push([parent.x, 0.03, parent.y], [child.x, 0.03, child.y]);
    territories.push({ zone, rect: { x: cursorX, y: cursorY, width, height } });
    cursorX += width + 5;
    rowHeight = Math.max(rowHeight, height);
    tiles.push(...local);
    ground.push(...floor);
  }
  const visible = layout.focusedProjectId
    ? territories.filter(item => item.zone.id === layout.focusedProjectId)
    : territories;
  const frames = visible.length ? visible : territories;
  const bounds = frames.length
    ? {
        x: Math.min(...frames.map(item => item.rect.x)),
        y: Math.min(...frames.map(item => item.rect.y)),
        width: 0,
        height: 0,
      }
    : { x: -2, y: -2, width: 4, height: 4 };
  if (frames.length) {
    bounds.width =
      Math.max(...frames.map(item => item.rect.x + item.rect.width)) - bounds.x;
    bounds.height =
      Math.max(...frames.map(item => item.rect.y + item.rect.height)) -
      bounds.y;
  }
  return { tiles, ground, targets, tethers, territories, bounds };
}
