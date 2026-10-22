import { describe, expect, it } from 'vitest';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import {
  boardStudyFleet,
  boardStudySourceMarks,
} from '@/components/hud/board-study-fixtures';
import { qualityModel } from './model';

describe('Fleet territory review keeps source truth', () => {
  it.each(['scale-10', 'scale-1000', 'fanout', 'stopped'] as const)(
    'preserves addresses, statuses and the input for %s',
    fixture => {
      const layout = selectSpatialBoardLayout(boardStudyFleet(fixture));
      const before = structuredClone(layout);
      const model = qualityModel(layout, boardStudySourceMarks(fixture));
      for (const piece of layout.pieces.filter(
        piece => piece.visible && piece.kind === 'agent'
      )) {
        const tile = model.tiles.find(tile => tile.id === piece.id);
        if (piece.sessionState === 'stopped') {
          expect(tile).toBeUndefined();
        } else {
          expect(tile).toMatchObject({
            x: piece.x,
            y: piece.y,
            agentId: piece.agentId,
          });
        }
      }
      for (const child of layout.delegationUnits.filter(
        unit => unit.kind === 'child'
      )) {
        expect(model.tiles.find(tile => tile.id === child.id)).toMatchObject({
          x: child.x,
          y: child.y,
        });
        // A parent's harness is not evidence of a child's harness.
        expect(
          model.tiles.find(tile => tile.id === child.id)?.mark
        ).toBeUndefined();
      }
      expect(model.ground.length).toBeLessThanOrEqual(4096);
      expect(model.ground.every(tile => !tile.agentId && !tile.status)).toBe(
        true
      );
      expect(
        new Set([...model.ground, ...model.tiles].map(tile => tile.id)).size
      ).toBe(model.ground.length + model.tiles.length);
      expect(layout).toEqual(before);
    }
  );
});
