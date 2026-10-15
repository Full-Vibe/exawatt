import { describe, expect, it } from 'vitest';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { boardStudyFleet } from '@/components/hud/board-study-fixtures';
import { boardWorldPoint } from '../operations-board-camera';
import { computePopulationDotField } from '../population-dots';
import { boardTileModel } from './board-tiles-model';

describe('v2 adapts the shared board layout', () => {
  it.each(['scale-10', 'scale-100', 'scale-1000'] as const)(
    'keeps addresses and census in %s',
    fixture => {
      const fleet = boardStudyFleet(fixture);
      const layout = selectSpatialBoardLayout(fleet);
      const before = structuredClone(layout);
      const model = boardTileModel(layout);
      const individual = layout.pieces.filter(
        piece => piece.visible && piece.kind === 'agent'
      );
      expect(model.agents.map(tile => tile.id)).toEqual(
        individual.map(piece => piece.id)
      );
      for (const piece of individual) {
        const tile = model.agents.find(tile => tile.id === piece.id)!;
        const world = boardWorldPoint(piece);
        // Rotate the renderer's XZ plane into the board's XY plane.
        expect({ x: tile.x, y: -tile.y }).toEqual(world);
        expect(tile.agentId).toBe(piece.agentId);
        if (piece.status === null) expect(tile.status).toBeUndefined();
      }
      const population = computePopulationDotField(layout.zones, layout.pieces);
      expect(model.population).toHaveLength(population.count);
      expect(model.agents.length + population.population).toBe(
        Object.keys(fleet.agents).length
      );
      expect(
        new Set(
          [
            ...model.agents,
            ...model.population,
            ...model.ground,
            ...model.ghosts,
          ].map(tile => tile.id)
        ).size
      ).toBe(
        model.agents.length +
          model.population.length +
          model.ground.length +
          model.ghosts.length
      );
      expect(layout).toEqual(before);
    }
  );

  it('does not assign a harness to an Agent whose source is absent', () => {
    const layout = selectSpatialBoardLayout(boardStudyFleet('scale-10'));
    expect(
      boardTileModel(layout).agents.every(tile => tile.mark === undefined)
    ).toBe(true);
    const agent = layout.pieces.find(piece => piece.agentId)!;
    const marks = { [agent.agentId!]: 'claude' };
    expect(
      boardTileModel(layout, marks).agents.find(
        tile => tile.agentId === agent.agentId
      )?.mark
    ).toBe('claude');
  });
});
