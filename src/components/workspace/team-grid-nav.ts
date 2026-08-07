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
 */

export interface TeamGridRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type TeamGridDirection = 'up' | 'down' | 'left' | 'right';

const centerX = (rect: TeamGridRect) => rect.left + rect.width / 2;
const centerY = (rect: TeamGridRect) => rect.top + rect.height / 2;

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
 */
export function teamGridNeighbor(
  rects: readonly TeamGridRect[],
  from: number,
  direction: TeamGridDirection
): number | null {
  const origin = rects[from];
  if (!origin || rects.length === 0) return null;

  if (direction === 'left' || direction === 'right') {
    const forward = direction === 'right';
    const candidates = rects
      .map((rect, index) => ({ rect, index }))
      .filter(
        entry =>
          entry.index !== from &&
          sameRow(origin, entry.rect) &&
          (forward
            ? centerX(entry.rect) > centerX(origin)
            : centerX(entry.rect) < centerX(origin))
      );
    if (candidates.length > 0) {
      return candidates.reduce((best, entry) =>
        Math.abs(centerX(entry.rect) - centerX(origin)) <
        Math.abs(centerX(best.rect) - centerX(origin))
          ? entry
          : best
      ).index;
    }
    // Row edge: continue in reading order so nothing is a dead end.
    const next = forward ? from + 1 : from - 1;
    return next >= 0 && next < rects.length ? next : null;
  }

  const down = direction === 'down';
  const candidates = rects
    .map((rect, index) => ({ rect, index }))
    .filter(
      entry =>
        entry.index !== from &&
        !sameRow(origin, entry.rect) &&
        (down
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
  const row = candidates.filter(entry => sameRow(entry.rect, closest.rect));
  return row.reduce((best, entry) =>
    Math.abs(centerX(entry.rect) - centerX(origin)) <
    Math.abs(centerX(best.rect) - centerX(origin))
      ? entry
      : best
  ).index;
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
