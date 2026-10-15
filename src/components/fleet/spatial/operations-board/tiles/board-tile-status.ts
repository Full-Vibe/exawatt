import type { SpatialBoardPiece } from '@exawatt/ui-model';

/** The shared D40 glyph gets its own corner beside the harness relief. Its
 * status, unread bit, stopped lifecycle and identity are never re-derived. */
export function boardTileStatusSubjects(
  pieces: readonly SpatialBoardPiece[]
): SpatialBoardPiece[] {
  return pieces.map(piece => ({
    ...piece,
    x: piece.x + piece.size * 0.3,
    y: piece.y + piece.size * 0.3,
    size: piece.size * 0.42,
  }));
}
