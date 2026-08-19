/**
 * The fold's opening dissolve (ENG-031 W11).
 *
 * The operator's direction, verbatim: "Put the / tom cruise visual above the
 * fold, so scrolling fades him out and the fleet board in."
 *
 * So the page opens on the gesture image, and the reader's first scroll
 * dissolves the human commanding by gesture into the actual fleet he was
 * commanding. This module is the whole of that mapping, kept apart from the
 * component for the same reason `pinned-scroll.ts` is: it is arithmetic over
 * scroll position, and arithmetic can be asserted.
 *
 * THREE PROPERTIES IT HAS TO HAVE, and they are the same three the pinned
 * sequence already lives by:
 *
 * - **A pure function of scroll POSITION.** No latch, no direction test, no
 *   one-shot reveal, so scrolling back up reverses the dissolve exactly and
 *   the page has no hidden state to get wrong.
 * - **A fixed range in viewport heights, never a pixel offset.** The range is
 *   a share of the PINNED BOX (the viewport minus the site header), which is
 *   the same unit the panel geometry is expressed in, so a 720px laptop and a
 *   1440px display see the same dissolve at the same fraction of it.
 * - **It finishes before the sequence's first snap point.** The fold's rest
 *   stays scroll zero and the next rest is the attention panel's keyframe;
 *   between them there is no snap target, so no settle can leave a reader
 *   parked on a half-dissolved image. `crossfadeClearsFirstSnapPoint()` is
 *   that property, and it is asserted rather than eyeballed.
 *
 * THE TWO LAYERS ARE NOT COMPLEMENTARY, deliberately. A straight `1 - t`
 * crossfade of two dark compositions dips through a luminance trough in the
 * middle, because both layers are part-transparent over the same near-black
 * ground at once. The dissolve is composed the way a film dissolve is instead:
 * the OUTGOING layer sits on top and leaves last, the incoming board is
 * already at full strength underneath by the time it does, and there is no
 * point in the move where the frame goes flat.
 */

/**
 * How much scroll the dissolve owns, as a share of the pinned box.
 *
 * Tuned against the one hard constraint below it: the dissolve must finish
 * with room to spare before the attention panel's snap point, which sits at
 * `1.1 viewports + 24px` down the page. At 0.85 it finishes 315px earlier on a
 * 1440x810 frame and keeps a comparable margin at every viewport height,
 * because both numbers scale with the viewport.
 */
export const FOLD_CROSSFADE_SCREENS = 0.85;

/**
 * Where the board reaches full strength, as a fraction of the dissolve.
 *
 * The board is UNDER the image, so it has to be fully painted before the image
 * finishes leaving; anything later and the last of the dissolve reveals a
 * board that is still fading in, which reads as a lag rather than a reveal.
 */
const BOARD_IN_END = 0.72;

/**
 * Where the image starts leaving. It holds for the first eighth so the very
 * top of the page is unambiguously the image, and a reader who nudges the
 * wheel by 40px does not see the hero flicker.
 */
const IMAGE_OUT_START = 0.12;

/**
 * Where the board becomes a surface a pointer may touch.
 *
 * Hover and the pointer lean are gated on this and not on the board being
 * mounted: a hit target over an image is a ghost surface, and the reader would
 * be hovering agents they cannot see. By 0.92 the image is under four percent
 * and the board is the only thing on screen.
 */
export const FOLD_BOARD_INTERACTIVE_AT = 0.92;

/**
 * The dissolve's raw progress, 0..1, for a scroll offset into the sequence.
 *
 * `stickyPx` is the pinned box's own measured height rather than the viewport,
 * so the range tracks the same box the panel geometry is expressed against and
 * a phone's shorter board card gets a proportionally shorter dissolve.
 */
export function foldCrossfadeProgress(
  scrolledPx: number,
  stickyPx: number
): number {
  const range = FOLD_CROSSFADE_SCREENS * stickyPx;
  if (!(range > 0)) return 1;
  return clamp01(scrolledPx / range);
}

/** The gesture image's opacity. It is the layer ON TOP, so it leaves last. */
export function foldImageOpacity(progress: number): number {
  return 1 - smoothstep(IMAGE_OUT_START, 1, clamp01(progress));
}

/** The board's opacity. It is the layer UNDERNEATH, so it arrives first. */
export function foldBoardOpacity(progress: number): number {
  return smoothstep(0, BOARD_IN_END, clamp01(progress));
}

/** Whether the board may answer a pointer yet. */
export function foldBoardInteractive(progress: number): boolean {
  return progress >= FOLD_BOARD_INTERACTIVE_AT;
}

/**
 * Where the sequence's first snap point sits, in pixels below the top of the
 * sequence, given the first two panels' heights.
 *
 * Derived from the same geometry `pinned-board-sequence.tsx` writes into the
 * sentinel's `top`: panel one starts a full panel height down the page, and
 * its keyframe sits `(screens * viewport - sticky) / 2` inside it. Restated
 * here in one place so the property below can be a test rather than a comment.
 */
export function firstSnapPointOffset(
  foldScreens: number,
  nextScreens: number,
  viewportPx: number,
  stickyPx: number
): number {
  return (
    foldScreens * viewportPx + (nextScreens * viewportPx - stickyPx) / 2
  );
}

/**
 * THE PROPERTY THAT KEEPS A READER OFF A HALF-DISSOLVED HERO: the dissolve is
 * over before the first place the browser will settle them.
 */
export function crossfadeClearsFirstSnapPoint(
  foldScreens: number,
  nextScreens: number,
  viewportPx: number,
  stickyPx: number
): boolean {
  return (
    FOLD_CROSSFADE_SCREENS * stickyPx <
    firstSnapPointOffset(foldScreens, nextScreens, viewportPx, stickyPx)
  );
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
