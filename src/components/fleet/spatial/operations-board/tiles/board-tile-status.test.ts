import { describe, expect, it } from 'vitest';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { boardStudyFleet } from '@/components/hud/board-study-fixtures';
import { boardTileStatusSubjects } from './board-tile-status';
import { boardTileModel } from './board-tiles-model';

describe('tile presentation preserves board truth', () => {
  it('retains unread, absent readings and stopped lifecycle when positioning corner marks', () => {
    const layout = selectSpatialBoardLayout(boardStudyFleet('scale-10'));
    const source = layout.pieces
      .filter(piece => piece.kind === 'agent')
      .map(piece => ({
        ...piece,
        status: null,
        unread: true,
        sessionState: 'stopped' as const,
      }));
    const before = structuredClone(source);
    const marks = boardTileStatusSubjects(source);
    for (const [index, mark] of marks.entries()) {
      expect(mark.id).toBe(source[index]!.id);
      expect(mark.agentId).toBe(source[index]!.agentId);
      expect(mark.status).toBeNull();
      expect(mark.unread).toBe(true);
      expect(mark.sessionState).toBe('stopped');
      expect(mark.size).toBeGreaterThan(0);
      expect(mark.size).toBeLessThan(source[index]!.size);
    }
    expect(source).toEqual(before);
  });

  it('can retain a retiring tile without changing the shared population or layout', () => {
    const layout = selectSpatialBoardLayout(boardStudyFleet('scale-1000'));
    const prior = selectSpatialBoardLayout(boardStudyFleet('scale-10'));
    const retiring = prior.pieces.find(
      piece => piece.kind === 'agent' && piece.visible
    )!;
    const original = boardTileModel(layout);
    const withRetirement = boardTileModel(layout, {}, [retiring]);
    expect(withRetirement.agents.map(tile => tile.id)).toEqual([retiring.id]);
    expect(withRetirement.population).toEqual(original.population);
    expect(withRetirement.ghosts).toEqual(original.ghosts);
    expect(layout.pieces.some(piece => piece === retiring)).toBe(false);
  });
});
