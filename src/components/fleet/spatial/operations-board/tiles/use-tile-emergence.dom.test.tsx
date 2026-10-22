// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpatialBoardPiece } from '@exawatt/ui-model';

// A live demand canvas outside WebGL: R3F's `invalidate` asks for one frame.
const canvas = vi.hoisted(() => {
  const state = { paints: 0, invalidate: () => (state.paints += 1) };
  return state;
});
vi.mock('@react-three/fiber', () => ({
  useFrame: () => undefined,
  useThree: (select: (state: { invalidate: () => void }) => unknown) =>
    select({ invalidate: canvas.invalidate }),
}));

const { useTileEmergence } = await import('./use-tile-emergence');
const { FrameDemandRoot } = await import('@/lib/frame-demand/frame-demand');
const { createFrameScheduler } =
  await import('@/lib/frame-demand/frame-scheduler');

// The fields the emergence hook reads; the rest of a piece is layout.
const agent = (id: string) =>
  ({
    id,
    kind: 'agent',
    visible: true,
    sessionState: 'live',
  }) as Pick<
    SpatialBoardPiece,
    'id' | 'kind' | 'visible' | 'sessionState'
  > as SpatialBoardPiece;

function Emerging({
  pieces,
  reduced,
}: {
  pieces: SpatialBoardPiece[];
  reduced: boolean;
}) {
  useTileEmergence(pieces, reduced);
  return null;
}

afterEach(cleanup);

describe('useTileEmergence', () => {
  for (const reduced of [false, true]) {
    it(`paints Agents that arrive after the canvas parked (${reduced ? 'reduced motion' : 'motion'})`, () => {
      const scheduler = createFrameScheduler({
        render: true,
        ambient: reduced ? 'parked' : 'display',
      });
      const board = (pieces: SpatialBoardPiece[]) => (
        <FrameDemandRoot scheduler={scheduler}>
          <Emerging pieces={pieces} reduced={reduced} />
        </FrameDemandRoot>
      );
      const { rerender } = render(board([]));
      expect(scheduler.snapshot().parked).toBe(true);
      const parkedAt = canvas.paints;

      rerender(board([agent('a1'), agent('a2')]));

      expect(canvas.paints).toBeGreaterThan(parkedAt);
      // With motion the arrival is a transition: frames hold until it lands.
      expect(scheduler.snapshot().deadlineMs > 0).toBe(!reduced);
    });
  }
});
