import type { SpatialBoardLayout, SpatialBoardRect } from '@exawatt/ui-model';
import type { TileInstance } from '@/components/tiles/tile-contract';
import { boardTileModel } from '@/components/fleet/spatial/operations-board/tiles/board-tiles-model';
import { boardWorldPoint } from '@/components/fleet/spatial/operations-board/operations-board-camera';
import { delegationStatusPieces } from '@/components/fleet/spatial/operations-board/delegation-roster';
import { workStateReading } from '@/components/status-light/protocol';

/** Review-only territory adapter. Agent addresses, sizes, census and lineage
 * are untouched. Only decorative ground and the camera's framing are proposed. */
export function qualityModel(
  layout: SpatialBoardLayout,
  marks: Readonly<Record<string, string>>
) {
  const existing = boardTileModel(layout, marks);
  const children = delegationStatusPieces(layout.delegationUnits);
  const stopped = new Set(
    layout.pieces
      .filter(piece => piece.sessionState === 'stopped')
      .map(piece => piece.id)
  );
  const tiles: TileInstance[] = [
    ...existing.agents.filter(tile => !stopped.has(tile.id)),
    ...existing.population,
  ];
  for (const child of children) {
    const world = boardWorldPoint(child);
    const parent = layout.delegationUnits.find(unit => unit.id === child.id)!;
    const reading = workStateReading(child.status);
    tiles.push({
      id: child.id,
      agentId: child.id,
      x: world.x,
      y: -world.y,
      radius: child.size / 1.64,
      status: reading === 'unreported' ? undefined : reading,
      // Child harness is not reported by this projection; never infer it
      // from the parent. Its blank face and tether distinguish the child.
      phase: parent.x + parent.y,
    });
  }
  for (const unit of layout.delegationUnits.filter(
    unit => unit.kind === 'overflow'
  )) {
    const world = boardWorldPoint(unit);
    tiles.push({
      id: unit.id,
      x: world.x,
      y: -world.y,
      radius: unit.size / 1.64,
    });
  }
  const ground: TileInstance[] = [];
  const groundBudget = Math.floor(
    4096 / Math.max(1, layout.zones.filter(zone => zone.visible).length)
  );
  const territories = layout.zones
    .filter(zone => zone.visible)
    .map(zone => {
      const roots = layout.pieces.filter(
        piece =>
          piece.visible && piece.kind === 'agent' && piece.projectId === zone.id
      );
      const units = [
        ...roots,
        ...children.filter(child => child.projectId === zone.id),
      ];
      // Aggregated populations retain their real footprint and coarse body batch.
      const points = units.length
        ? units
        : existing.population
            .filter(
              tile =>
                tile.x >= zone.rect.x &&
                tile.x <= zone.rect.x + zone.rect.width &&
                tile.y >= zone.rect.y &&
                tile.y <= zone.rect.y + zone.rect.height
            )
            .map(tile => ({
              x: tile.x,
              y: tile.y,
              size: (tile.radius ?? 1) * 1.64,
            }));
      const step = Math.max(zone.unitSize / 1.64, 0.35);
      const padding = step * 2.5;
      const rect: SpatialBoardRect = points.length
        ? {
            x:
              Math.min(...points.map(point => point.x - point.size / 2)) -
              padding,
            y:
              Math.min(...points.map(point => point.y - point.size / 2)) -
              padding,
            width: 0,
            height: 0,
          }
        : { ...zone.rect };
      if (points.length) {
        rect.width =
          Math.max(...points.map(point => point.x + point.size / 2)) +
          padding -
          rect.x;
        rect.height =
          Math.max(...points.map(point => point.y + point.size / 2)) +
          padding -
          rect.y;
      }
      const cx = zone.rect.x + zone.radius;
      const cy = zone.rect.y + zone.radius;
      const floorStep = Math.max(
        step,
        Math.sqrt((rect.width * rect.height) / (groundBudget * 2.598))
      );
      const groundStart = ground.length;
      const dy = floorStep * 1.5;
      const dx = floorStep * Math.sqrt(3);
      // One bounded ground batch; it carries no Agent ids or command targets.
      for (
        let row = Math.floor((rect.y - cy) / dy);
        row <= Math.ceil((rect.y + rect.height - cy) / dy);
        row++
      ) {
        const y = cy + row * dy;
        const offset = row % 2 ? dx / 2 : 0;
        for (
          let column = Math.floor((rect.x - cx) / dx);
          column <= Math.ceil((rect.x + rect.width - cx) / dx);
          column++
        ) {
          if (ground.length - groundStart >= groundBudget) break;
          const x = cx + column * dx + offset;
          if (
            !points.some(
              point =>
                Math.hypot(point.x - x, point.y - y) <
                point.size / 2 + step * 1.8
            )
          )
            continue;
          ground.push({
            id: `land:${zone.id}:${row}:${column}`,
            x,
            y,
            radius: floorStep,
            elevation: -step * 0.48,
            ring: 0,
          });
        }
      }
      return { zone, rect };
    });
  const visible =
    layout.altitude === 'project'
      ? territories.filter(item => item.zone.id === layout.focusedProjectId)
      : territories;
  const frames = visible.length ? visible : territories;
  const cameraBounds = frames.length
    ? {
        x: Math.min(...frames.map(item => item.rect.x)),
        y: Math.min(...frames.map(item => item.rect.y)) - 2,
        width: 0,
        height: 0,
      }
    : layout.cameraBounds;
  if (frames.length) {
    cameraBounds.width =
      Math.max(...frames.map(item => item.rect.x + item.rect.width)) -
      cameraBounds.x;
    cameraBounds.height =
      Math.max(...frames.map(item => item.rect.y + item.rect.height)) -
      cameraBounds.y +
      1;
  }
  return {
    tiles,
    ground,
    children,
    territories,
    cameraLayout: { ...layout, cameraBounds },
  };
}
