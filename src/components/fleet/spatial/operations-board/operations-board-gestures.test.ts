import { describe, expect, it } from 'vitest';
import {
  BOARD_BAND_THRESHOLD_PX,
  bandBoardRect,
  bandGestureMoved,
  bandOverlayRect,
  createBoardGestureState,
  endBoardGesture,
} from './operations-board-gestures';

/**
 * The operator's report: "I click and drag to make a rectangle selection
 * (didn't select anything) and it stayed on screen after releasing my mouse."
 *
 * The marquee is transient UI in the RTS grammar (decision `0024`) — it belongs
 * to the hand drawing it and to nothing else.
 */
describe('board gesture state', () => {
  it('survives being read by listeners registered at a different time', () => {
    // The listener effect used to own this state as closure locals, and it
    // re-registers whenever the board's selection callbacks change — which is
    // every fleet tick. A tick mid-drag then lost the gesture entirely.
    const state = createBoardGestureState();
    state.phase = 'band';
    state.bandStart = { x: 10, y: 10 };
    const laterListenerView = state;
    expect(laterListenerView.phase).toBe('band');
    expect(laterListenerView.bandStart).toEqual({ x: 10, y: 10 });
  });

  it('ends the gesture from any phase, so a release always resolves', () => {
    for (const phase of ['band', 'pan', 'pinch', 'idle'] as const) {
      const state = createBoardGestureState();
      state.phase = phase;
      state.pointerId = 7;
      endBoardGesture(state);
      expect(state.phase).toBe('idle');
      expect(state.pointerId).toBeNull();
    }
  });

  it('treats a still click as a click, not an empty band', () => {
    const state = createBoardGestureState();
    state.bandStart = { x: 100, y: 100 };
    expect(bandGestureMoved(state, 100, 100)).toBe(false);
    expect(
      bandGestureMoved(state, 100 + BOARD_BAND_THRESHOLD_PX - 1, 100)
    ).toBe(false);
    expect(bandGestureMoved(state, 100 + BOARD_BAND_THRESHOLD_PX, 100)).toBe(
      true
    );
  });

  it('normalises the overlay rect for a drag in any direction', () => {
    const state = createBoardGestureState();
    state.bandStart = { x: 200, y: 150 };
    const bounds = { left: 50, top: 20 };
    const downRight = bandOverlayRect(state, 260, 210, bounds);
    const upLeft = bandOverlayRect(state, 140, 90, bounds);
    expect(downRight).toEqual({ left: 150, top: 130, width: 60, height: 60 });
    expect(upLeft).toEqual({ left: 90, top: 70, width: 60, height: 60 });
  });

  it('normalises the board rect, flipping world y to layout y', () => {
    // World y is up; layout rects are y-down.
    const rect = bandBoardRect({ x: 4, y: 9 }, { x: -2, y: 1 });
    expect(rect).toEqual({ x: -2, y: -9, width: 6, height: 8 });
  });

  it('reports a zero-area band rather than inventing one', () => {
    expect(bandBoardRect({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({
      x: 3,
      y: -3,
      width: 0,
      height: 0,
    });
  });

  it('keeps touch points independent of the drag phase', () => {
    const state = createBoardGestureState();
    state.touches.set(1, { x: 0, y: 0 });
    state.touches.set(2, { x: 10, y: 0 });
    endBoardGesture(state);
    // Ending a gesture does not forget which fingers are still down; the
    // pointer events own that, and dropping it stranded pinches.
    expect(state.touches.size).toBe(2);
  });
});
