import { describe, expect, it } from 'vitest';
import {
  teamGridNeighbor,
  teamPointerMoved,
  type TeamGridMeasure,
  type TeamGridRect,
} from './team-grid-nav';

/** A 3-wide grid of 200x140 tiles, the shape the Team altitude actually
 *  renders: index order is reading order, rows wrap every three. */
const grid = (count: number, columns = 3): TeamGridRect[] =>
  Array.from({ length: count }, (_, index) => ({
    left: (index % columns) * 220,
    top: Math.floor(index / columns) * 160,
    width: 200,
    height: 140,
  }));

describe('teamGridNeighbor (FIX-002)', () => {
  // The report: Up/Down step next/previous through the flat order while the
  // layout promises rows and columns.
  it('moves Up and Down between rows, not to the adjacent tile', () => {
    const rects = grid(9);
    expect(teamGridNeighbor(rects, 1, 'down')).toBe(4);
    expect(teamGridNeighbor(rects, 4, 'down')).toBe(7);
    expect(teamGridNeighbor(rects, 7, 'up')).toBe(4);
    expect(teamGridNeighbor(rects, 4, 'up')).toBe(1);
  });

  it('moves Left and Right within the row', () => {
    const rects = grid(9);
    expect(teamGridNeighbor(rects, 3, 'right')).toBe(4);
    expect(teamGridNeighbor(rects, 5, 'left')).toBe(4);
  });

  it('stops at the top and bottom instead of wrapping the grid', () => {
    const rects = grid(9);
    expect(teamGridNeighbor(rects, 1, 'up')).toBeNull();
    expect(teamGridNeighbor(rects, 7, 'down')).toBeNull();
  });

  it('leaves no tile stranded at a row edge', () => {
    const rects = grid(9);
    // Right at the end of a row continues in reading order rather than
    // dead-ending, which is how every tile stays one key away.
    expect(teamGridNeighbor(rects, 2, 'right')).toBe(3);
    expect(teamGridNeighbor(rects, 3, 'left')).toBe(2);
    expect(teamGridNeighbor(rects, 0, 'left')).toBeNull();
    expect(teamGridNeighbor(rects, 8, 'right')).toBeNull();
  });

  it('lands on the nearest column when the row below is ragged', () => {
    // 5 tiles: a full row of 3, then a short row of 2. Down from the last
    // tile of the top row has no tile directly beneath it.
    const rects = grid(5);
    expect(teamGridNeighbor(rects, 2, 'down')).toBe(4);
    expect(teamGridNeighbor(rects, 4, 'up')).toBe(1);
  });

  it('crosses a Project boundary as an ordinary next row', () => {
    // Two Projects stacked: three tiles, then a gap, then two tiles. The
    // boundary needs no special case — it is simply the nearest row down.
    const rects: TeamGridRect[] = [
      ...grid(3),
      { left: 0, top: 420, width: 200, height: 140 },
      { left: 220, top: 420, width: 200, height: 140 },
    ];
    expect(teamGridNeighbor(rects, 1, 'down')).toBe(4);
    expect(teamGridNeighbor(rects, 3, 'up')).toBe(0);
  });

  it('treats a full-width row (an empty Project) as one row', () => {
    const rects: TeamGridRect[] = [
      ...grid(3),
      { left: 0, top: 160, width: 640, height: 90 },
      { left: 0, top: 270, width: 200, height: 140 },
    ];
    expect(teamGridNeighbor(rects, 1, 'down')).toBe(3);
    expect(teamGridNeighbor(rects, 3, 'down')).toBe(4);
    expect(teamGridNeighbor(rects, 4, 'up')).toBe(3);
  });

  it('does not split a row when one card is taller than its neighbours', () => {
    const rects: TeamGridRect[] = [
      { left: 0, top: 0, width: 200, height: 140 },
      { left: 220, top: 0, width: 200, height: 190 },
      { left: 440, top: 0, width: 200, height: 140 },
      { left: 0, top: 210, width: 200, height: 140 },
    ];
    expect(teamGridNeighbor(rects, 0, 'right')).toBe(1);
    expect(teamGridNeighbor(rects, 1, 'right')).toBe(2);
    expect(teamGridNeighbor(rects, 0, 'down')).toBe(3);
  });

  it('answers null rather than guessing on an empty or unknown origin', () => {
    expect(teamGridNeighbor([], 0, 'down')).toBeNull();
    expect(teamGridNeighbor(grid(4), 9, 'up')).toBeNull();
  });

  it('walks a single column with Up and Down, not with Left and Right', () => {
    const rects = grid(4, 1);
    expect(teamGridNeighbor(rects, 0, 'down')).toBe(1);
    expect(teamGridNeighbor(rects, 3, 'up')).toBe(2);
    // one tile per row, so Left/Right have no in-row neighbour and fall
    // through to reading order rather than dead-ending
    expect(teamGridNeighbor(rects, 1, 'right')).toBe(2);
    expect(teamGridNeighbor(rects, 1, 'left')).toBe(0);
  });

  // ── The 2026-08-16 reopen: "ArrowDown from the last Exawatt tile moved
  // left to the preceding tile rather than to the immediate-below tile in
  // the next Project row." Down out of a Project's RAGGED last row must
  // reach the tile beneath it, never the one before it.
  it('lands beneath the last tile of a ragged row, not on the tile before it', () => {
    const rects: TeamGridRect[] = [
      // Project A: a full row of three, then a ragged row of two
      ...grid(3),
      { left: 0, top: 160, width: 200, height: 140 },
      { left: 220, top: 160, width: 200, height: 140 },
      // Project B, after a section header: a full row of three
      { left: 0, top: 400, width: 200, height: 140 },
      { left: 220, top: 400, width: 200, height: 140 },
      { left: 440, top: 400, width: 200, height: 140 },
    ];
    // index 4 is the LAST tile of Project A, in the middle column
    expect(teamGridNeighbor(rects, 4, 'down')).toBe(6);
    expect(teamGridNeighbor(rects, 6, 'up')).toBe(4);
    // and the first tile of that ragged row keeps its own column
    expect(teamGridNeighbor(rects, 3, 'down')).toBe(5);
  });

  // ── Unmeasurable tiles. The overlay used to substitute a zero rect for a
  // tile it had no node for, which is a phantom tile at the viewport
  // origin: above and to the left of every real tile, and a legitimate
  // "nearest row" for anything that looked up. Absence is now absence.
  it('skips a tile it could not measure instead of placing it top-left', () => {
    const measures: TeamGridMeasure[] = [...grid(6)];
    measures[3] = null; // the first tile of row two never reported a rect
    // Down from row one's first tile crosses to the nearest MEASURED tile
    // in the row below rather than to the phantom.
    expect(teamGridNeighbor(measures, 0, 'down')).toBe(4);
    // and Up from row two does not get pulled to the origin
    expect(teamGridNeighbor(measures, 5, 'up')).toBe(2);
    expect(teamGridNeighbor(measures, 1, 'up')).toBeNull();
  });

  it('treats a zero-area rect as unmeasured, not as a tile at the origin', () => {
    const measures: TeamGridMeasure[] = [...grid(6)];
    measures[3] = { left: 0, top: 0, width: 0, height: 0 };
    expect(teamGridNeighbor(measures, 0, 'down')).toBe(4);
    expect(teamGridNeighbor(measures, 1, 'up')).toBeNull();
  });

  it('falls back to reading order when the ORIGIN could not be measured', () => {
    const measures: TeamGridMeasure[] = [...grid(6)];
    measures[4] = null;
    // Geometry cannot answer a question about a tile whose position is
    // unknown, so movement stays defined instead of inventing an origin.
    expect(teamGridNeighbor(measures, 4, 'down')).toBe(5);
    expect(teamGridNeighbor(measures, 4, 'up')).toBe(3);
  });

  it('moves in reading order on a host with no layout at all', () => {
    // jsdom reports every rect as zero. Behaviour stays defined, and the
    // decision lives here rather than in the overlay where no unit test
    // could reach it.
    const measures: TeamGridMeasure[] = Array.from({ length: 4 }, () => null);
    expect(teamGridNeighbor(measures, 1, 'down')).toBe(2);
    expect(teamGridNeighbor(measures, 1, 'right')).toBe(2);
    expect(teamGridNeighbor(measures, 1, 'up')).toBe(0);
    expect(teamGridNeighbor(measures, 0, 'up')).toBeNull();
    expect(teamGridNeighbor(measures, 3, 'down')).toBeNull();
  });
});

describe('teamPointerMoved (FIX-002, reopened)', () => {
  // Chromium re-dispatches a mouse event at the LAST KNOWN cursor position
  // whenever content moves under a stationary pointer. Crossing into the
  // next Project's row scrolls the grid, so the arrow key selected the
  // right tile and the re-dispatch handed the selection to whatever slid
  // under the resting cursor.
  it('refuses a re-dispatch at coordinates the pointer already had', () => {
    expect(teamPointerMoved({ x: 200, y: 500 }, { x: 200, y: 500 })).toBe(
      false
    );
  });

  it('never claims on the first event, which is the one a mount re-dispatches', () => {
    expect(teamPointerMoved(null, { x: 200, y: 500 })).toBe(false);
  });

  it('claims on real movement, including a single pixel', () => {
    expect(teamPointerMoved({ x: 200, y: 500 }, { x: 201, y: 500 })).toBe(true);
    expect(teamPointerMoved({ x: 200, y: 500 }, { x: 200, y: 501 })).toBe(true);
  });
});
