import { describe, expect, it } from 'vitest';
import { teamGridNeighbor, type TeamGridRect } from './team-grid-nav';

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
});
