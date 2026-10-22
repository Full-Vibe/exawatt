import { describe, expect, it } from 'vitest';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import {
  boardStudyFleet,
  boardStudySourceMarks,
} from '@/components/hud/board-study-fixtures';
import { boardTileModel } from '@/components/fleet/spatial/operations-board/tiles/board-tiles-model';
import { qualityModel } from './model';

describe('Fleet territory review keeps source truth on a shared lattice', () => {
  it.each([
    'scale-10',
    'scale-100',
    'scale-1000',
    'fanout',
    'stopped',
  ] as const)(
    'preserves identity, readings and source data; each body owns one socket in %s',
    fixture => {
      const layout = selectSpatialBoardLayout(boardStudyFleet(fixture));
      const before = structuredClone(layout);
      const marks = boardStudySourceMarks(fixture);
      const model = qualityModel(layout, marks);
      const source = boardTileModel(layout, marks);
      for (const piece of layout.pieces.filter(
        piece => piece.visible && piece.kind === 'agent'
      )) {
        const tile = model.tiles.find(tile => tile.id === piece.id);
        expect(tile?.agentId).toBe(piece.agentId);
        expect(tile?.status).toBe(
          piece.sessionState === 'stopped'
            ? undefined
            : source.agents.find(item => item.id === piece.id)?.status
        );
      }
      for (const child of layout.delegationUnits.filter(
        unit => unit.kind === 'child'
      )) {
        const tile = model.tiles.find(tile => tile.id === child.id);
        expect(tile).toBeDefined();
        // A parent's harness is not evidence of a child's harness.
        expect(tile?.mark).toBeUndefined();
      }
      expect(
        model.tiles
          .filter(tile => tile.id.startsWith('population:'))
          .map(tile => tile.id)
          .sort()
      ).toEqual(source.population.map(tile => tile.id).sort());
      for (const tile of model.tiles) {
        const socket = model.ground.filter(
          ground => ground.x === tile.x && ground.y === tile.y
        );
        expect(socket).toHaveLength(1);
        expect(tile.radius).toBeLessThan(socket[0]!.radius!);
      }
      // Double occupation is the visible overlap defect, independent of pitch.
      expect(new Set(model.tiles.map(tile => `${tile.x},${tile.y}`)).size).toBe(
        model.tiles.length
      );
      expect(model.ground.length).toBeLessThanOrEqual(4096);
      expect(model.ground.every(tile => !tile.agentId && !tile.status)).toBe(
        true
      );
      expect(
        new Set([...model.ground, ...model.tiles].map(tile => tile.id)).size
      ).toBe(model.ground.length + model.tiles.length);
      expect(layout).toEqual(before);
      // Navigation frames the fixed world; it must not rearrange the Agents.
      const focused = qualityModel(
        {
          ...layout,
          altitude: 'project',
          focusedProjectId: layout.zones[0]?.id ?? null,
        },
        marks
      );
      expect(focused.tiles).toEqual(model.tiles);
    }
  );
});
