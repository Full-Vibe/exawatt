/**
 * Where the pinned board is, given where the page is (ENG-031 W4).
 *
 * The sticky-canvas pattern needs exactly one number derived from scroll
 * position, and it needs to be a PURE function of it, for two reasons the
 * brief states outright:
 *
 * - **No scroll-jacking.** The page never takes the scroll. There is no
 *   `preventDefault`, no `scrollTo`, no wheel binding and no snap. The board
 *   reads the scroll position the browser already produced and nothing else,
 *   which is also why the whole sequence reads correctly going UP: a pure
 *   function of position has no direction.
 * - **Progress over a FIXED range, never a raw pixel offset.** Every input
 *   here is in viewport heights, so a 900px laptop and a 1440px display see
 *   the same story at the same fraction of the sequence.
 *
 * The geometry, in viewport heights. A sequence of N panels declares its own
 * `screens` (the band contract's "one idea per screen", 1.0 to 1.4). The
 * container is `sum(screens)` tall and its sticky child is exactly 1 tall, so
 * the board stays pinned for `sum(screens) - 1` of travel. Panel k's centre
 * crosses the viewport centre at a known point in that travel, and THAT is the
 * point where the board must be exactly at panel k's altitude. Between two
 * panels the board interpolates; before the first and after the last it holds.
 *
 * Panel heights and altitude spacing are therefore decoupled: a 1.4-screen
 * panel holds its altitude longer without dragging the keyframe off centre.
 */

/**
 * The DOM address of a panel's SETTLE POINT (ENG-031 W12).
 *
 * `pinned-board-sequence.tsx` already renders one zero-height sentinel per
 * panel at the camera keyframe, and `globals.css` snaps the document scroller
 * to it. Giving that sentinel an id makes the same position addressable as an
 * ordinary in-page link, which is what the fold's scroll affordance uses: an
 * `<a href>` to this id lands the reader exactly where a scroll settle would,
 * because it IS the settle target rather than a second pixel offset computed
 * beside it. No `scrollTo`, no measurement, and nothing to keep in step.
 *
 * The prefix exists because a band id is also the anchor of a `BandSection`
 * (`close`, and every band on `/`), and two elements cannot share an id.
 */
export function panelStepId(bandId: string): string {
  return `step-${bandId}`;
}

/**
 * Viewport heights of scroll the board stays pinned for.
 *
 * `sticky` is the pinned element's own height in viewport heights, which is
 * not 1: the board sits under a sticky site header, so it is slightly shorter
 * than the viewport, and the caller measures the real ratio rather than
 * assuming it.
 */
export function pinnedTravelScreens(
  screens: readonly number[],
  sticky = 1
): number {
  return Math.max(
    0.001,
    screens.reduce((total, value) => total + value, 0) - sticky
  );
}

/**
 * Where each panel's centre sits in the sticky travel, as a fraction 0..1.
 *
 * Panel k's centre is at `sum(screens[0..k-1]) + screens[k]/2` from the top of
 * the container, and it reaches the viewport centre half a screen earlier than
 * that, which is where the subtraction comes from.
 */
export function panelAnchors(screens: readonly number[], sticky = 1): number[] {
  const travel = pinnedTravelScreens(screens, sticky);
  let cumulative = 0;
  return screens.map(value => {
    const centre = cumulative + value / 2;
    cumulative += value;
    return clamp01((centre - sticky / 2) / travel);
  });
}

/**
 * The board's altitude progress, 0..1, for a scroll fraction of the sticky
 * travel. Piecewise linear through the panel anchors, so panel k lands exactly
 * on keyframe k and nothing between them is a surprise.
 */
export function boardProgressAt(
  scrolled: number,
  anchors: readonly number[]
): number {
  if (anchors.length <= 1) return 0;
  const s = clamp01(scrolled);
  const last = anchors.length - 1;
  if (s <= anchors[0]!) return 0;
  if (s >= anchors[last]!) return 1;
  for (let index = 0; index < last; index += 1) {
    const from = anchors[index]!;
    const to = anchors[index + 1]!;
    if (s >= from && s <= to) {
      const span = to - from;
      const local = span > 0 ? (s - from) / span : 0;
      return (index + local) / last;
    }
  }
  return 1;
}

/**
 * How present panel k is, 0..1, so it can fade in as it arrives and out as it
 * leaves. Symmetric in distance, which is what makes scrolling up read the
 * same as scrolling down.
 *
 * `scrolled` is NOT clamped here, and that is the whole repair (ENG-031 W6b).
 * Clamping it meant the last panel's distance from its own anchor stopped
 * growing at the end of the travel, so its presence stayed at 1 while the
 * sequence released and the column carried on up the page, straight under the
 * sticky header at full strength. Board PROGRESS is still clamped, because the
 * camera holds at the last altitude; presence is about a column that is still
 * moving.
 */
export function panelPresence(
  scrolled: number,
  screens: readonly number[],
  anchors: readonly number[],
  index: number,
  sticky = 1
): number {
  const travel = pinnedTravelScreens(screens, sticky);
  const half = (screens[index] ?? 1) / 2 / travel;
  if (half <= 0) return 1;
  const position = Number.isFinite(scrolled) ? scrolled : 0;
  const distance = Math.abs(position - (anchors[index] ?? 0)) / half;
  // Full strength across the middle of its own screen, gone by its edge.
  return 1 - smoothstep(0.45, 1, distance);
}

/** Which panel currently owns the board. Semantic, so it drives the highlight
 *  and nothing else; it changes a handful of times over the whole sequence. */
export function activePanel(
  scrolled: number,
  anchors: readonly number[]
): number {
  if (anchors.length === 0) return -1;
  const s = clamp01(scrolled);
  let best = 0;
  let bestDistance = Infinity;
  anchors.forEach((anchor, index) => {
    const distance = Math.abs(s - anchor);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
