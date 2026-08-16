/**
 * Team-altitude keyboard geometry (ENG-015 S6, FIX-002).
 *
 * The Team grid used to move selection by ±1 through a flat list, so Up,
 * Down, Left and Right were four names for "next" and "previous". The
 * operator's report is precisely that the keyboard contradicts what he can
 * see: he wants "Up/Down between grid rows, Left/Right within a row —
 * matching what the 2-D tile layout visually promises."
 *
 * Geometry comes from MEASURED rectangles rather than a column count,
 * because the layout has neither a fixed column count nor uniform tiles:
 * tiles are grouped per Project, a Project's last row is ragged, the docked
 * roadmap rail changes the available width, and an empty Project contributes
 * a single wide row. Anything derived from "columns" would be a second,
 * weaker model of a layout CSS has already solved. Rows are therefore
 * discovered by vertical overlap, which is also what makes a Project
 * boundary behave correctly for free: the first row of the next Project is
 * simply the nearest row below.
 *
 * Pure, so the movement can be reasoned about and tested without a browser.
 *
 * Reopened 2026-08-16 and widened: this module now owns the WHOLE movement
 * contract, including what happens when a tile cannot be measured and who
 * may claim the roving selection. Both used to be decided in the overlay,
 * where the only way to reach them is a live grid with real layout — which
 * is exactly why the second report looked like a geometry regression when
 * the geometry was right.
 */

export interface TeamGridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * One tile as the overlay found it: a rectangle, or `null` for a tile it
 * could not measure — no node yet, or a host with no layout at all.
 *
 * Unmeasurable is its own answer, never a rect. The overlay used to
 * substitute `{0,0,0,0}` for a tile it could not measure, which is not a
 * neutral value: it is a phantom tile at the viewport origin, above and to
 * the left of every real one, and it competed for "nearest row" like any
 * other tile. Making absence representable is what lets the model treat it
 * as absence.
 */
export type TeamGridMeasure = TeamGridRect | null;

export type TeamGridDirection = 'up' | 'down' | 'left' | 'right';

export interface TeamGridPoint {
  x: number;
  y: number;
}

const centerX = (rect: TeamGridRect) => rect.left + rect.width / 2;
const centerY = (rect: TeamGridRect) => rect.top + rect.height / 2;

/** A rect with no area is a tile the host did not lay out (jsdom reports
 *  every rect as zero), so it is unmeasurable rather than a point tile. */
const measured = (measure: TeamGridMeasure): measure is TeamGridRect =>
  measure !== null && (measure.width > 0 || measure.height > 0);

/** Two tiles share a row when their vertical spans overlap at all. Tiles in
 *  one row are the same height in practice; overlap tolerates the odd
 *  taller card without inventing a threshold. */
function sameRow(a: TeamGridRect, b: TeamGridRect): boolean {
  return a.top < b.top + b.height && b.top < a.top + a.height;
}

/**
 * The tile a direction key should land on, or null when there is nothing
 * that way.
 *
 * Left/Right stay in the row and step to the nearest neighbour on that side.
 * At a row's edge they fall through to reading order — the previous row's
 * last tile, or the next row's first — so every tile stays reachable with
 * one key rather than becoming a dead end the operator has to escape with a
 * different key.
 *
 * Up/Down cross rows: nearest row in that direction, then the tile whose
 * horizontal centre is closest, which is what keeps a column feeling like a
 * column while the rows underneath are ragged.
 *
 * The DEGRADED cases are part of this contract rather than the caller's
 * problem, because the caller is a live overlay and anything decided there
 * is reachable only through real layout. With no measurable geometry at all
 * — jsdom, a host that has not laid the grid out yet — movement is reading
 * order, so the behaviour stays defined. With an unmeasurable ORIGIN the
 * answer is the same: geometry cannot be asked a question about a tile
 * whose position is unknown, and inventing one is how a real neighbour gets
 * silently replaced.
 */
export function teamGridNeighbor(
  measures: readonly TeamGridMeasure[],
  from: number,
  direction: TeamGridDirection
): number | null {
  if (from < 0 || from >= measures.length) return null;
  const forward = direction === 'down' || direction === 'right';
  // Reading order: the fallback that keeps every tile one key away, and the
  // whole of movement where there is nothing to measure.
  const readingOrder = (): number | null => {
    const next = forward ? from + 1 : from - 1;
    return next >= 0 && next < measures.length ? next : null;
  };

  const origin = measures[from];
  if (!measured(origin)) return readingOrder();
  const tiles = measures.flatMap((measure, index) =>
    index !== from && measured(measure) ? [{ rect: measure, index }] : []
  );
  if (tiles.length === 0) return readingOrder();

  const nearestColumn = (row: typeof tiles) =>
    row.reduce((best, entry) =>
      Math.abs(centerX(entry.rect) - centerX(origin)) <
      Math.abs(centerX(best.rect) - centerX(origin))
        ? entry
        : best
    ).index;

  if (direction === 'left' || direction === 'right') {
    const candidates = tiles.filter(
      entry =>
        sameRow(origin, entry.rect) &&
        (forward
          ? centerX(entry.rect) > centerX(origin)
          : centerX(entry.rect) < centerX(origin))
    );
    if (candidates.length > 0) return nearestColumn(candidates);
    // Row edge: continue in reading order so nothing is a dead end.
    return readingOrder();
  }

  const candidates = tiles.filter(
    entry =>
      !sameRow(origin, entry.rect) &&
      (forward
        ? centerY(entry.rect) > centerY(origin)
        : centerY(entry.rect) < centerY(origin))
  );
  if (candidates.length === 0) return null;

  // Nearest row first, then nearest column inside it. "The nearest row" is
  // whatever row the closest candidate belongs to — resolved by overlap
  // rather than by a distance threshold, so a taller card cannot split its
  // own row in two.
  const closest = candidates.reduce((best, entry) =>
    Math.abs(centerY(entry.rect) - centerY(origin)) <
    Math.abs(centerY(best.rect) - centerY(origin))
      ? entry
      : best
  );
  return nearestColumn(
    candidates.filter(entry => sameRow(entry.rect, closest.rect))
  );
}

/**
 * May a pointer event claim the roving selection? (FIX-002, reopened.)
 *
 * Only if the pointer actually MOVED. Chromium re-dispatches mouse events
 * at the LAST KNOWN cursor position whenever content moves underneath a
 * stationary cursor — which the Team grid does on every arrow key that
 * scrolls, and crossing into the next Project's row almost always scrolls.
 * So the sequence was: the arrow key selects the geometrically correct
 * tile, `scrollIntoView` brings it into view, the scroll re-dispatches a
 * mouse event at the resting cursor, and whatever tile has slid under the
 * cursor takes the selection back. The operator sees the selection land one
 * tile to the left of where the geometry put it, and the geometry gets the
 * blame.
 *
 * The rule is exact rather than timed: a synthetic re-dispatch carries the
 * coordinates the cursor already had, so comparing them is the whole test.
 * A first event has nothing to compare against and never claims, which is
 * also what the overlay's mount needs — the same re-dispatch fires when the
 * overview first appears under a resting cursor.
 */
export function teamPointerMoved(
  previous: TeamGridPoint | null,
  next: TeamGridPoint
): boolean {
  if (previous === null) return false;
  return previous.x !== next.x || previous.y !== next.y;
}

/**
 * Does this key event belong to something else on screen?
 *
 * The Team grid's key handler used to claim every key that was not Escape,
 * Enter or an arrow — including plain `j` and `k`, which are the D9
 * list-navigation mirror of down and up. Inside a text field that is
 * indistinguishable from a broken input: focus lands, `j` and `k` never
 * arrive, Enter navigates away instead of committing, Escape closes the
 * whole altitude instead of cancelling the edit (FIX-006, reported live in a
 * partner demo). The field D49 later deleted is gone, but the rule it needed
 * is the durable half, and the grid must not have to be told again.
 *
 * So the grid yields to any focused control that owns text or its own
 * activation, the same way the roadmap rail already does.
 */
const YIELDS_TO =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="menuitem"], [cmdk-root], .xterm-helper-textarea';

export function teamGridYieldsTo(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(YIELDS_TO) !== null;
}
