import type { SpatialBoardRect } from '@exawatt/ui-model';

/**
 * Pointer-gesture state for the board (ENG-004, decision `0024`).
 *
 * **Why this is a value and not a closure.** Every one of these fields used to
 * live as a `let` inside the effect that registers the pointer listeners, and
 * that effect depends on the board's selection callbacks — which are rebuilt
 * whenever the layout changes, which is every fleet tick. A tick arriving mid
 * drag therefore tore the listeners down and re-registered them with a fresh
 * closure: the in-flight gesture vanished, `pointerup` saw no gesture to end,
 * the selection rectangle was stranded on screen, and pointer capture was never
 * released. Live data could interrupt a hand movement.
 *
 * Holding the gesture in one object that outlives re-registration is the fix,
 * and keeping the DECISIONS pure is what lets them be tested without a GPU, a
 * canvas, or a pointer.
 */
export type BoardGesturePhase = 'idle' | 'band' | 'pan' | 'pinch';

export interface BoardGesturePoint {
  x: number;
  y: number;
}

export interface BoardGestureState {
  phase: BoardGesturePhase;
  /** The pointer that owns the current gesture, for capture release. */
  pointerId: number | null;
  bandStart: BoardGesturePoint;
  bandLast: BoardGesturePoint;
  panLast: BoardGesturePoint;
  touches: Map<number, BoardGesturePoint>;
  pinchDistance: number;
  pinchZoom: number;
  pinchAnchor: BoardGesturePoint;
}

export function createBoardGestureState(): BoardGestureState {
  return {
    phase: 'idle',
    pointerId: null,
    bandStart: { x: 0, y: 0 },
    bandLast: { x: 0, y: 0 },
    panLast: { x: 0, y: 0 },
    touches: new Map(),
    pinchDistance: 1,
    pinchZoom: 1,
    pinchAnchor: { x: 0, y: 0 },
  };
}

/** Movement below this reads as a click, not a drag. */
export const BOARD_BAND_THRESHOLD_PX = 4;

/** Did the pointer travel far enough for this to be a band rather than a click? */
export function bandGestureMoved(
  state: BoardGestureState,
  endX: number,
  endY: number
): boolean {
  return (
    Math.abs(endX - state.bandStart.x) >= BOARD_BAND_THRESHOLD_PX ||
    Math.abs(endY - state.bandStart.y) >= BOARD_BAND_THRESHOLD_PX
  );
}

/** Screen-space rectangle for the marquee overlay, normalised to any drag direction. */
export function bandOverlayRect(
  state: BoardGestureState,
  clientX: number,
  clientY: number,
  bounds: { left: number; top: number }
): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(state.bandStart.x, clientX) - bounds.left,
    top: Math.min(state.bandStart.y, clientY) - bounds.top,
    width: Math.abs(clientX - state.bandStart.x),
    height: Math.abs(clientY - state.bandStart.y),
  };
}

/**
 * Board-space rectangle for a completed band. World y is up and layout rects
 * are y-down, so the caller passes already-projected corners and this only
 * normalises them.
 */
export function bandBoardRect(
  from: BoardGesturePoint,
  to: BoardGesturePoint
): SpatialBoardRect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(-from.y, -to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

/**
 * Release the gesture whatever state it was in.
 *
 * Called on pointerup, pointercancel, and on unmount — a marquee is transient
 * UI in the RTS grammar, so there is no path where it may outlive the hand
 * that drew it.
 */
export function endBoardGesture(state: BoardGestureState): void {
  state.phase = 'idle';
  state.pointerId = null;
}
