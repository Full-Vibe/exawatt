// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Suspense, startTransition, use, useEffect, useState } from 'react';
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

// The fields the emergence hook reads, plus a label to tell two versions of
// one Agent apart; the rest of a piece is layout.
const agent = (id: string, label = id) =>
  ({
    id,
    label,
    kind: 'agent',
    visible: true,
    sessionState: 'live',
  }) as Pick<
    SpatialBoardPiece,
    'id' | 'label' | 'kind' | 'visible' | 'sessionState'
  > as SpatialBoardPiece;

function Emerging({
  pieces,
  reduced,
}: {
  pieces: SpatialBoardPiece[];
  reduced: boolean;
}) {
  const { rendered } = useTileEmergence(pieces, reduced);
  return (
    <output
      data-rendered={rendered.map(piece => piece.id).join(',')}
      data-labels={rendered.map(piece => piece.label).join(',')}
    />
  );
}

type Move = (pieces: SpatialBoardPiece[], held: boolean) => void;
type FrameScheduler = ReturnType<typeof createFrameScheduler>;

const never = new Promise<void>(() => undefined);

/** Suspends forever: a transition that renders it is held. */
function Held(): null {
  use(never);
  return null;
}

/** A board whose moves are transitions, optionally held by a sibling. */
function HoldableBoard({
  scheduler,
  initial,
  onMove,
}: {
  scheduler: FrameScheduler;
  initial: SpatialBoardPiece[];
  onMove: (move: Move) => void;
}) {
  const [pieces, setPieces] = useState(initial);
  const [held, setHeld] = useState(false);
  useEffect(
    () =>
      onMove((next, hold) =>
        startTransition(() => {
          setPieces(next);
          setHeld(hold);
        })
      ),
    [onMove]
  );
  return (
    <FrameDemandRoot scheduler={scheduler}>
      <Emerging pieces={pieces} reduced={false} />
      {held ? <Held /> : null}
    </FrameDemandRoot>
  );
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

  it('draws a departing Agent as it was last drawn, not as a discarded render saw it', async () => {
    // The hazard the retained records exist for: a render React throws away
    // must not change what a departing Agent looks like. A transition renames
    // a2 and is held (a sibling suspends); a newer transition removes a2 and
    // lets go of the hold, so the rename is rendered but never drawn. The
    // exit plays with the name the board last drew.
    vi.useFakeTimers();
    try {
      const scheduler = createFrameScheduler({
        render: true,
        ambient: 'display',
      });
      let move!: Move;
      const view = render(
        <Suspense fallback={null}>
          <HoldableBoard
            scheduler={scheduler}
            initial={[agent('a1'), agent('a2', 'drawn')]}
            onMove={next => (move = next)}
          />
        </Suspense>
      );
      const output = () => view.container.querySelector('output')!;
      act(() => vi.advanceTimersByTime(5_000));
      expect(output().getAttribute('data-labels')).toBe('a1,drawn');

      await act(async () =>
        move([agent('a1'), agent('a2', 'discarded')], true)
      );
      expect(output().getAttribute('data-labels')).toBe('a1,drawn');

      await act(async () => move([agent('a1')], false));
      // Departing: still drawn after the survivors, as it was last drawn.
      expect(output().getAttribute('data-rendered')).toBe('a1,a2');
      expect(output().getAttribute('data-labels')).toBe('a1,drawn');

      act(() => vi.advanceTimersByTime(5_000));
      expect(output().getAttribute('data-rendered')).toBe('a1');
    } finally {
      vi.useRealTimers();
    }
  });
});
