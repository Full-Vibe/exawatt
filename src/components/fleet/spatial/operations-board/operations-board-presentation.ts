/**
 * Bounded visual-policy seam for the standing Operations Board bench.
 *
 * The bench renders the production board, so review candidates travel through
 * the same renderer instead of forking a mock. Production callers omit this
 * object and receive the shipped treatment. Once the operator picks a
 * direction, the chosen values become the defaults and the rejected branches
 * can be removed.
 */
export type BoardProjectEmphasis = 'current' | 'outline' | 'lift' | 'focus';
export type BoardAgentCandidate = 'current' | 'precision';

export interface OperationsBoardPresentation {
  projectEmphasis: BoardProjectEmphasis;
  agentCandidate: BoardAgentCandidate;
}

export const OPERATIONS_BOARD_PRESENTATION_DEFAULTS: OperationsBoardPresentation =
  {
    projectEmphasis: 'current',
    agentCandidate: 'current',
  };

export function resolveOperationsBoardPresentation(
  candidate?: Partial<OperationsBoardPresentation>
): OperationsBoardPresentation {
  return {
    ...OPERATIONS_BOARD_PRESENTATION_DEFAULTS,
    ...candidate,
  };
}
