/**
 * The curve of a paged move (ENG-031 W15h). A move between two frames is
 * animated in story progress, not in pixels, and shaped so the camera's own
 * parameter follows an S-curve across almost the whole of it.
 *
 * Why: the camera moves only while progress is inside a stage's rail window
 * (the middle half of its screen; the first and last quarters are dwell, the
 * camera standing still). An ease applied to the scroll position alone is
 * compressed by that window: with an ease-in-out cubic over the scroll, the
 * camera crosses its window during the fastest fifth of the animation, a
 * swing in about a sixth of a second however long the move is. So the move
 * crosses the dwell quickly (it is invisible, nothing moves) and spends its
 * time inside the window, where the S-curve is inverted through the rail's
 * own smoothstep, so the camera parameter itself is the S-curve.
 */

import { RAIL_DWELL } from './stages';

/** The share of a move spent crossing a dwell at either end. */
const DWELL_SHARE = 0.05;

/** How long a paged move takes, in milliseconds. */
export const MOVE_MS = 880;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The inverse of smoothstep on [0, 1]: the u for which u*u*(3-2u) = y. */
export function invSmoothstep(y: number): number {
  const c = clamp(y, 0, 1);
  return 0.5 - Math.sin(Math.asin(1 - 2 * c) / 3);
}

export function easeInOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2;
}

interface RailMove {
  /** Story progress the move starts and ends at. */
  from: number;
  to: number;
  /** The edges of the rail window the move crosses, near edge first. */
  near: number;
  far: number;
}

/** The move between two adjacent frames, forward or back. */
export function railMove(
  fromFrame: number,
  toFrame: number,
  last: number
): RailMove {
  const forward = toFrame > fromFrame;
  // the scene whose window this move crosses
  const base = Math.min(fromFrame, toFrame);
  return {
    from: clamp(fromFrame, RAIL_DWELL, last - RAIL_DWELL),
    to: clamp(toFrame, RAIL_DWELL, last - RAIL_DWELL),
    near: forward ? base + RAIL_DWELL : base + 1 - RAIL_DWELL,
    far: forward ? base + 1 - RAIL_DWELL : base + RAIL_DWELL,
  };
}

/** Story progress at time tau (0 to 1) of a move. */
export function pagedProgress(tau: number, move: RailMove): number {
  const t = clamp(tau, 0, 1);
  if (t <= 0) return move.from;
  if (t >= 1) return move.to;
  // a move that starts or ends at its window's edge has no dwell to cross
  const lead = Math.abs(move.near - move.from) > 1e-6 ? DWELL_SHARE : 0;
  const tail = Math.abs(move.to - move.far) > 1e-6 ? DWELL_SHARE : 0;
  if (t < lead) return move.from + (move.near - move.from) * (t / lead);
  if (t > 1 - tail)
    return move.far + (move.to - move.far) * ((t - (1 - tail)) / tail);
  const m = (t - lead) / (1 - lead - tail);
  return move.near + (move.far - move.near) * invSmoothstep(easeInOutCubic(m));
}

/**
 * Where the type that follows the scroll shows a paged move at time tau
 * (W15p): one ease from the move's start to its end. The scroll itself
 * (`pagedProgress`) slows almost to a stop at the edge of the window and
 * then crosses the hold beyond it in a blink. The camera never sees that,
 * since nothing moves in a hold, but the reading column follows the scroll
 * through the hold (W15l), and it slowed short of its place and covered the
 * last of the way in three frames (operator 2026-10-14: "80% smooth but the
 * last 20%... snaps and looks a bit glitchy").
 */
export function shownProgress(tau: number, move: RailMove): number {
  return move.from + (move.to - move.from) * easeInOutCubic(tau);
}

/** How fast the reading column closes its way to the scroll after a paged
 *  move ends short of its frame, per second. */
const REJOIN_RATE = 14;
/** Closer than this, in stages (a tenth of a pixel), it is the scroll's. */
const REJOINED = 1e-4;

interface ColumnFollow {
  /** The progress the column shows. */
  shown: number;
  /** Its way from the scroll, closing. */
  gap: number;
  /** Whether a paged move had it at the last frame. */
  paged: boolean;
}

export function columnFollow(): ColumnFollow {
  return { shown: Number.NaN, gap: 0, paged: false };
}

/**
 * Where the reading column shows the story this frame (W15p): through a
 * paged move, the move's own ease (`shownProgress`); otherwise the scroll
 * itself, `raw`. A move that ends short of its frame (a finger catches it,
 * a step is pressed) leaves the column where it was and closes its way to
 * the scroll at `REJOIN_RATE`, so it never jumps; once closed, the column
 * is the scroll's exactly, as a finger needs it.
 */
export function followColumn(
  state: ColumnFollow,
  raw: number,
  paged: number | undefined,
  dt: number
): number {
  if (paged !== undefined) {
    state.paged = true;
    state.shown = paged;
    return paged;
  }
  if (state.paged) {
    // the move is over: carry on from where the column is
    state.paged = false;
    state.gap = Number.isNaN(state.shown) ? 0 : state.shown - raw;
  } else {
    state.gap *= Math.exp(-REJOIN_RATE * Math.max(0, dt));
    if (Math.abs(state.gap) < REJOINED) state.gap = 0;
  }
  state.shown = raw + state.gap;
  return state.shown;
}
