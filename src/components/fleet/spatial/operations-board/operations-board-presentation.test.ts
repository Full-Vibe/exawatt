import { describe, expect, it } from 'vitest';
import {
  OPERATIONS_BOARD_PRESENTATION_DEFAULTS,
  resolveOperationsBoardPresentation,
} from './operations-board-presentation';

describe('Operations Board presentation policy', () => {
  it('keeps production on the shipped treatment when no study is supplied', () => {
    expect(resolveOperationsBoardPresentation()).toEqual(
      OPERATIONS_BOARD_PRESENTATION_DEFAULTS
    );
  });

  it('changes only the review dimension a caller explicitly auditions', () => {
    expect(
      resolveOperationsBoardPresentation({ projectEmphasis: 'focus' })
    ).toEqual({
      projectEmphasis: 'focus',
      agentCandidate: 'current',
    });
  });
});
