/**
 * A Project's territory border (ENG-031 W15i, operator 2026-10-13: "the
 * project name titles are very missable and it's sort of visually unclear
 * that they map to the fleet of agents, or the team of agents, or the squad
 * that I'm looking at"). A Project is a spiral of rings on the pointy-top
 * grid, so its outermost ring sits on a flat-top hexagon: ring `k`'s corner
 * tiles are `k * sqrt(3)` from the centre at 0, 60, ... degrees and its
 * sides are `1.5 * k` away. The border is that hexagon pushed out past the
 * tiles' own points, its corners rounded: the shape of the land it holds,
 * in the fleet's plane, which the sphere wraps like everything else.
 *
 * Pure: no three.js.
 */

/** Points around one border, evenly spread along its length. */
export const BORDER_SAMPLES = 96;

/** A tile's circumradius: how far its point stands past its centre. */
const TILE_REACH = 0.82;
/** Clear space between the outermost tiles and the border. */
const BORDER_MARGIN = 0.5;
/** How far along each side a corner's curve starts, in tile units, and at
 *  most this share of a side. Fixed, not a share of the side: a share grows
 *  with the Project and a big Project's rounded corner would cut through its
 *  own corner tiles. */
const CORNER_UNITS = 1.5;
const CORNER_SHARE = 0.45;

/** Inradius of the border around `rings` rings (rings may be fractional
 *  while a border eases to a new size). */
export function borderInradius(rings: number): number {
  return 1.5 * rings + TILE_REACH + BORDER_MARGIN;
}

/**
 * Write the border around a Project centred at plane (`cx`, `cy`) holding
 * `rings` rings into `out` as x, y pairs, `BORDER_SAMPLES` of them, and the
 * outward normal of each into `normals`.
 */
export function writeBorder(
  cx: number,
  cy: number,
  rings: number,
  out: Float32Array,
  normals: Float32Array
): void {
  const circum = borderInradius(rings) / Math.cos(Math.PI / 6);
  // The rounded outline is six straight runs and six quadratic corners;
  // sample it by length so the points are evenly spaced.
  const side = circum; // a regular hexagon's side is its circumradius
  const t = Math.min(CORNER_SHARE, CORNER_UNITS / side);
  const straight = side * (1 - 2 * t);
  // length of a quadratic corner, near enough: the chord of its two halves
  const cornerLength = 2 * side * t * 0.95;
  const run = straight + cornerLength;
  const total = run * 6;
  for (let i = 0; i < BORDER_SAMPLES; i += 1) {
    const at = (i / BORDER_SAMPLES) * total;
    const k = Math.min(5, Math.floor(at / run));
    const into = at - k * run;
    // corner k sits at angle 60k degrees; the run starts just past it
    const a0 = (k * Math.PI) / 3;
    const a1 = ((k + 1) * Math.PI) / 3;
    const ax = Math.cos(a0) * circum;
    const ay = Math.sin(a0) * circum;
    const bx = Math.cos(a1) * circum;
    const by = Math.sin(a1) * circum;
    let x: number;
    let y: number;
    let tx: number;
    let ty: number;
    if (into < straight) {
      // along the side from just past corner k to just before corner k+1
      const u = t + (into / straight) * (1 - 2 * t);
      x = ax + (bx - ax) * u;
      y = ay + (by - ay) * u;
      tx = bx - ax;
      ty = by - ay;
    } else {
      // around corner k+1: from the end of this side to the start of the next
      const u = (into - straight) / cornerLength;
      const a2 = ((k + 2) * Math.PI) / 3;
      const cx2 = Math.cos(a2) * circum;
      const cy2 = Math.sin(a2) * circum;
      const sx = ax + (bx - ax) * (1 - t);
      const sy = ay + (by - ay) * (1 - t);
      const ex = bx + (cx2 - bx) * t;
      const ey = by + (cy2 - by) * t;
      const v = 1 - u;
      x = v * v * sx + 2 * v * u * bx + u * u * ex;
      y = v * v * sy + 2 * v * u * by + u * u * ey;
      tx = 2 * v * (bx - sx) + 2 * u * (ex - bx);
      ty = 2 * v * (by - sy) + 2 * u * (ey - by);
    }
    out[i * 2] = cx + x;
    out[i * 2 + 1] = cy + y;
    // counter-clockwise, so outward is the tangent turned clockwise
    const len = Math.hypot(tx, ty) || 1;
    normals[i * 2] = ty / len;
    normals[i * 2 + 1] = -tx / len;
  }
}
