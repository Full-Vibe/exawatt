import { describe, expect, it } from 'vitest';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { boardStudyFleet } from '@/components/hud/board-study-fixtures';
import { sameAgentBodyPaint } from './agent-body-subjects';

const piece = selectSpatialBoardLayout(boardStudyFleet('scale-10')).pieces.find(
  piece => piece.kind === 'agent'
)!;

describe('neutral Agent body paint', () => {
  it('ignores metadata and status handled by live sibling owners', () => {
    expect(
      sameAgentBodyPaint(
        [piece],
        [
          {
            ...piece,
            label: 'new source label',
            status: 'error',
            unread: true,
            selected: !piece.selected,
            burnIntensity: 0.7,
          },
        ]
      )
    ).toBe(true);
  });
  it('invalidates for every geometric or command identity change', () => {
    for (const patch of [
      { id: 'new' },
      { agentId: 'another-agent' },
      { kind: 'aggregate' as const },
      { x: piece.x + 1 },
      { y: piece.y + 1 },
      { size: piece.size + 1 },
    ]) {
      expect(sameAgentBodyPaint([piece], [{ ...piece, ...patch }])).toBe(false);
    }
    expect(sameAgentBodyPaint([piece], [])).toBe(false);
    const other = { ...piece, id: 'another' };
    expect(sameAgentBodyPaint([piece, other], [other, piece])).toBe(false);
  });
});
