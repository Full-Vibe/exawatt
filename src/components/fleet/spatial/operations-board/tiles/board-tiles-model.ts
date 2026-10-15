import type { SpatialBoardLayout } from '@exawatt/ui-model';
import { workStateReading } from '@/components/status-light/protocol';
import type { TileInstance } from '@/components/tiles/tile-contract';
import { boardWorldPoint, boardRectCenter } from '../operations-board-camera';
import {
  computePopulationDotField,
  POPULATION_STATUS_ORDER,
} from '../population-dots';

interface BoardTileModel {
  agents: TileInstance[];
  ground: TileInstance[];
  ghosts: TileInstance[];
  population: TileInstance[];
}

/** Adapt the existing board's addresses, never generate another Agent layout.
 * TileRenderer's plane is XZ, normal +Y. Its parent turns +90° around X into
 * the board's XY plane, normal +Z. Negating world Y here is that basis change,
 * not a second layout-to-world policy. */
function tilePoint(point: { x: number; y: number }) {
  const world = boardWorldPoint(point);
  return { x: world.x, y: -world.y };
}

export function boardTileModel(
  layout: SpatialBoardLayout,
  sourceMarks: Readonly<Record<string, string>> = {}
): BoardTileModel {
  const agents: TileInstance[] = [];
  const ground: TileInstance[] = [];
  const ghosts: TileInstance[] = [];
  for (const piece of layout.pieces) {
    if (!piece.visible || piece.kind !== 'agent') continue;
    const reading = workStateReading(piece.status);
    const radius = piece.size / (2 * 0.82);
    agents.push({
      id: piece.id,
      agentId: piece.agentId ?? undefined,
      ...tilePoint(piece),
      radius,
      status: reading === 'unreported' ? undefined : reading,
      mark: piece.agentId ? sourceMarks[piece.agentId] : undefined,
      phase: piece.slotIndex * 0.618,
    });
    ground.push({
      id: `ground:${piece.id}`,
      ...tilePoint(piece),
      radius: radius * 1.14,
      elevation: -0.22 * radius,
    });
  }
  // Decorative spare sockets are anchored to the existing Project footprint.
  // They never represent population, reserve an Agent address or receive input.
  for (const zone of layout.zones) {
    if (!zone.visible) continue;
    const center = boardRectCenter(zone.rect);
    const radius = zone.unitSize / (2 * 0.82);
    for (let side = 0; side < 6; side += 1) {
      const angle = (side * Math.PI) / 3;
      const reach = Math.max(0, zone.radius - zone.unitSize * 0.7);
      ghosts.push({
        id: `ghost:${zone.id}:${side}`,
        x: center.x + Math.cos(angle) * reach,
        y: -(center.y + Math.sin(angle) * reach),
        radius: radius * 0.7,
        elevation: -0.22 * radius,
      });
    }
  }
  const field = computePopulationDotField(layout.zones, layout.pieces);
  const population: TileInstance[] = [];
  for (let index = 0; index < field.count; index += 1) {
    const reading = workStateReading(
      POPULATION_STATUS_ORDER[field.status[index]!]!
    );
    population.push({
      agentId: `population:${index}`,
      id: `population:${field.zoneIds[field.zone[index]!]!}:${field.status[index]}:${field.ordinal[index]}`,
      ...tilePoint({ x: field.x[index]!, y: field.y[index]! }),
      radius: field.size[index]! / (2 * 0.82),
      status: reading === 'unreported' ? undefined : reading,
      phase: field.ordinal[index]! * 0.618,
    });
  }
  return { agents, ground, ghosts, population };
}
