import type { SpatialBoardPiece } from '@exawatt/ui-model';
import { sameAgentBodyPaint } from './agent-body-subjects';

/** Source status ticks do not rebuild a static picking surface. */
export function createFleetAgentHitSelector() {
  let previous: readonly SpatialBoardPiece[] = [];
  return (pieces: readonly SpatialBoardPiece[]) => {
    const next = pieces.filter(
      piece =>
        piece.visible &&
        piece.kind === 'agent' &&
        piece.agentId &&
        piece.sessionState !== 'stopped'
    );
    if (!sameAgentBodyPaint(previous, next)) previous = next;
    return previous;
  };
}

/** Ordinary Fleet clicks belong to the Project behind the Agent. */
export function fleetAgentHitId(
  pieces: readonly SpatialBoardPiece[],
  event: { shiftKey: boolean; delta: number; instanceId?: number }
): string | null {
  if (!event.shiftKey || event.delta > 5 || event.instanceId === undefined)
    return null;
  return pieces[event.instanceId]?.agentId ?? null;
}
