import type { SpatialBoardPiece } from '@exawatt/ui-model';

/**
 * The Agent pieces that wear a status mark: every visible Agent, stopped
 * Sessions included (BUG-225).
 *
 * A stopped Session gives up its body for a dashed outline, and it used to
 * give up its mark with it. The counts bar still tallied its last reading, so
 * a fleet of finished-and-exited Agents counted 13 Result ready and drew one
 * check, and the empty outlines read as the Idle mark's broken ring. The
 * outline says the Session stopped; the mark inside it says what the last
 * turn left, which is the reading the bar counts. Two layers, one vocabulary.
 *
 * `rendered` is the solid pieces plus any still retiring. A piece that is
 * retiring because it just stopped appears once, as its current stopped
 * self, so its mark reads the live status rather than the departing body's.
 */
export function statusMarkSubjects(
  rendered: readonly SpatialBoardPiece[],
  visible: readonly SpatialBoardPiece[]
): SpatialBoardPiece[] {
  const stopped = visible.filter(piece => piece.sessionState === 'stopped');
  if (stopped.length === 0) return [...rendered];
  const stoppedIds = new Set(stopped.map(piece => piece.id));
  return [
    ...rendered.filter(piece => !stoppedIds.has(piece.id)),
    ...stopped,
  ];
}
