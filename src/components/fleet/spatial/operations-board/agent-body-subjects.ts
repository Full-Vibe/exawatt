import type { SpatialBoardPiece } from '@exawatt/ui-model';

/** Neutral body geometry and its command identity. Status, unread, source
 * clocks and selection belong to sibling layers or the imperative frame. */
export function sameAgentBodyPaint(
  previous: readonly SpatialBoardPiece[],
  next: readonly SpatialBoardPiece[]
): boolean {
  return (
    previous.length === next.length &&
    previous.every((piece, index) => {
      const other = next[index]!;
      return (
        piece === other ||
        (piece.id === other.id &&
          piece.kind === other.kind &&
          piece.agentId === other.agentId &&
          piece.x === other.x &&
          piece.y === other.y &&
          piece.size === other.size)
      );
    })
  );
}
