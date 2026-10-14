/**
 * Where the open agent's panel stands (ENG-031 W15h, operator 2026-10-13:
 * "it shouldn't occlude the middle of the scene, put it off to the side a
 * bit, such that it can change its position a little bit depending on what's
 * selected but not veer too far from a kind of pinned location").
 *
 * The panel is pinned to a side of the stage, not hung off the tile. On a
 * wide screen it docks to the edge opposite the reading column (or opposite
 * the tile when the type is centred), a little above the vertical middle, and
 * only drifts: a few pixels toward where the selected tile is, never far.
 * It never covers the tile it describes: if the pinned spot would, it slides
 * up or down clear of it, and failing that takes the other edge. On a narrow
 * screen it is a sheet across the width, at the top or the foot, whichever
 * is farther from the tile.
 *
 * Pure geometry in screen pixels, so it is tested without a browser.
 */

export type PanelSide = -1 | 0 | 1;

export interface PanelPlacementInput {
  stage: { width: number; height: number };
  /** The selected tile on screen. */
  tile: { x: number; y: number };
  panel: { width: number; height: number };
  /** The side the reading column is on: -1 left, 1 right, 0 centred. */
  column: PanelSide;
  narrow: boolean;
  /** Chrome over the stage's edges the panel keeps clear of. */
  inset: { top: number; bottom: number };
  /** The side it stood on last frame, so a tile near the middle does not
   *  make it flip back and forth. */
  previousSide?: PanelSide;
}

interface PanelPlacement {
  /** Top-left of the panel in stage pixels. */
  x: number;
  y: number;
  side: PanelSide;
}

/** Wide panel width, and the most a sheet on a narrow screen takes. */
const WIDE_WIDTH = 300;
const SHEET_MAX = 340;
/** Where the panel is pinned vertically, as a share of the stage's height. */
const PIN_Y = 0.44;
/** How much it follows the tile: a share of the tile's offset, capped. */
const FOLLOW_Y = 0.28;
const FOLLOW_Y_MAX = 0.12;
const FOLLOW_X = 0.04;
const FOLLOW_X_MAX = 20;
/** Clear space kept around the selected tile: a little over the tile's own
 *  radius on screen, which grows with the stage. */
function tileClear(stage: { width: number; height: number }): number {
  return clamp(Math.min(stage.width, stage.height) * 0.1, 48, 92);
}
/** A tile this close to the middle keeps the panel on the side it was on. */
const MIDDLE_HOLD = 0.08;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function panelWidth(stageWidth: number, narrow: boolean): number {
  return narrow
    ? Math.min(stageWidth - 2 * edgeMargin(stageWidth), SHEET_MAX)
    : WIDE_WIDTH;
}

function edgeMargin(stageWidth: number): number {
  return clamp(stageWidth * 0.03, 16, 40);
}

/** Whether a panel at (x, y) comes within the tile's clear space. */
function covers(
  x: number,
  y: number,
  panel: { width: number; height: number },
  tile: { x: number; y: number },
  clear: number
): boolean {
  const nearestX = clamp(tile.x, x, x + panel.width);
  const nearestY = clamp(tile.y, y, y + panel.height);
  return Math.hypot(tile.x - nearestX, tile.y - nearestY) < clear;
}

export function placePanel(input: PanelPlacementInput): PanelPlacement {
  const { stage, tile, panel, column, narrow, inset } = input;
  const clear = tileClear(stage);
  const margin = edgeMargin(stage.width);
  const minY = inset.top;
  const maxY = Math.max(minY, stage.height - inset.bottom - panel.height);

  if (narrow) {
    const x = clamp((stage.width - panel.width) / 2, 0, stage.width);
    // The end the reading column is not at first: on a phone a scene's
    // column stands at the foot when the scene reads beside the world and at
    // the top when it reads centred over it. The other end only when the
    // tile is in the way, and when the tile is in the way at both, the end
    // farther from it (W15j: the full agent card is tall enough on a short
    // phone for both ends to reach the middle).
    const first = column === 0 ? maxY : minY;
    const second = first === minY ? maxY : minY;
    if (!covers(x, first, panel, tile, clear)) return { x, y: first, side: 0 };
    if (!covers(x, second, panel, tile, clear))
      return { x, y: second, side: 0 };
    const gap = (y: number) => Math.abs(y + panel.height / 2 - tile.y);
    return { x, y: gap(first) >= gap(second) ? first : second, side: 0 };
  }

  const middle = stage.width / 2;
  const prefer: -1 | 1 =
    column !== 0 ? (column === 1 ? -1 : 1) : tile.x <= middle ? 1 : -1;
  const previous = input.previousSide ?? 0;
  const first: -1 | 1 =
    column === 0 &&
    previous !== 0 &&
    Math.abs(tile.x - middle) < stage.width * MIDDLE_HOLD
      ? previous
      : prefer;

  const pinY = stage.height * PIN_Y;
  const followY = clamp(
    (tile.y - pinY) * FOLLOW_Y,
    -stage.height * FOLLOW_Y_MAX,
    stage.height * FOLLOW_Y_MAX
  );
  const followX = clamp(
    (tile.x - middle) * FOLLOW_X,
    -FOLLOW_X_MAX,
    FOLLOW_X_MAX
  );
  const yPinned = clamp(pinY + followY - panel.height / 2, minY, maxY);

  const stand = (side: -1 | 1, y: number): PanelPlacement => ({
    x: clamp(
      (side === 1 ? stage.width - margin - panel.width : margin) + followX,
      margin,
      stage.width - margin - panel.width
    ),
    y: clamp(y, minY, maxY),
    side,
  });
  // Pinned, then slid clear above or below the tile, on each side in turn.
  const other: -1 | 1 = first === 1 ? -1 : 1;
  for (const side of [first, other]) {
    const pinned = stand(side, yPinned);
    if (!covers(pinned.x, pinned.y, panel, tile, clear)) return pinned;
    const above = tile.y - clear - panel.height - 8;
    const below = tile.y + clear + 8;
    const slides = [above, below]
      .filter(y => y >= minY && y <= maxY)
      .sort((a, b) => Math.abs(a - yPinned) - Math.abs(b - yPinned));
    for (const y of slides) {
      const slid = stand(side, y);
      if (!covers(slid.x, slid.y, panel, tile, clear)) return slid;
    }
  }
  return stand(first, yPinned);
}
