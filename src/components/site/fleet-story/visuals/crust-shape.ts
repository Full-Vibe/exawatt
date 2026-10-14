/**
 * The agent tile's outline (ENG-031 W15g, operator 2026-10-13: "It feels
 * too geometric, I want to see a more rounded / smooth version (less
 * emphasized hexagonality)"). One shape function feeds the body, the lit
 * cap, the ghost and selection rings and the rim band, so every piece of
 * a tile agrees on its corners.
 *
 * A pointy-top hexagon of circumradius `radius` with each corner replaced
 * by a curve that starts `corner` of the radius along each adjacent edge:
 * 0 is the crisp hexagon, a half is as round as a hexagon can get without
 * losing its edges, which is a puck.
 */

import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Faces that meet at less than this share their normals: a bevel's bands
 *  and a rounded corner's facets shade as one smooth surface, while a crisp
 *  hexagon's corners (60 degrees) and a plain prism's top edge stay crisp.
 *  Flat-shaded bands read as a stack of coins on a glossy body (W15i). */
const CREASE = (50 * Math.PI) / 180;

/**
 * Smooth normals, and flat caps. Creasing averages a cap's rim with the
 * bevel band beside it, and a cap is triangulated from its rim alone, so
 * the whole flat top would tilt and wobble with the triangulation (a
 * blotchy highlight on gloss). The cap's rim, and the bevel's first ring
 * where it meets the cap, face straight out again: the top is flat and the
 * bevel rolls off from it smoothly.
 */
function smoothed(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = toCreasedNormals(g, CREASE);
  out.computeBoundingBox();
  const box = out.boundingBox as THREE.Box3;
  const position = out.getAttribute('position');
  const normal = out.getAttribute('normal');
  const near = Math.cos(CREASE);
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    const ny = normal.getY(i);
    if (Math.abs(y - box.max.y) < 1e-5 && ny > near) normal.setXYZ(i, 0, 1, 0);
    else if (Math.abs(y - box.min.y) < 1e-5 && ny < -near)
      normal.setXYZ(i, 0, -1, 0);
  }
  normal.needsUpdate = true;
  return out;
}

export type CrustShapeId = 'hex' | 'rounded' | 'puck';

export const CRUST_SHAPES: {
  id: CrustShapeId;
  name: string;
  note: string;
  /** Corner rounding as a fraction of the circumradius. */
  corner: number;
}[] = [
  { id: 'hex', name: 'Hex', note: 'The crisp hexagon.', corner: 0 },
  {
    id: 'rounded',
    name: 'Rounded',
    note: 'The hexagon with its corners softened.',
    corner: 0.3,
  },
  {
    id: 'puck',
    name: 'Puck',
    note: 'As round as a hexagon gets: six soft lobes, almost a disc.',
    corner: 0.5,
  },
];

export function shapeCorner(id: CrustShapeId): number {
  return CRUST_SHAPES.find(shape => shape.id === id)?.corner ?? 0;
}

function corners(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let k = 0; k < 6; k += 1) {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return out;
}

/** Trace the outline onto a shape or a hole, as a closed path. */
function trace(path: THREE.Shape | THREE.Path, radius: number, corner: number) {
  const pts = corners(radius);
  if (corner <= 0) {
    pts.forEach(([x, y], k) =>
      k === 0 ? path.moveTo(x, y) : path.lineTo(x, y)
    );
    path.closePath();
    return;
  }
  // The edge of a regular hexagon is its circumradius long; `corner` is a
  // fraction of that, capped at half so neighbouring curves meet.
  const t = Math.min(0.5, corner);
  for (let k = 0; k < 6; k += 1) {
    const [x0, y0] = pts[k];
    const [x1, y1] = pts[(k + 1) % 6];
    const [xp, yp] = pts[(k + 5) % 6];
    // leave the previous edge `t` before this corner, rejoin the next edge
    // `t` after it
    const inX = x0 + (xp - x0) * t;
    const inY = y0 + (yp - y0) * t;
    const outX = x0 + (x1 - x0) * t;
    const outY = y0 + (y1 - y0) * t;
    if (k === 0) path.moveTo(inX, inY);
    else path.lineTo(inX, inY);
    path.quadraticCurveTo(x0, y0, outX, outY);
  }
  path.closePath();
}

function tileShape(radius: number, corner: number): THREE.Shape {
  const shape = new THREE.Shape();
  trace(shape, radius, corner);
  return shape;
}

/** The tile's outline as a flat face, lying in XZ, normal +Y. */
export function tileFaceGeometry(
  radius: number,
  corner: number
): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(tileShape(radius, corner), 12);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** The tile's outline extruded one unit up from y = 0: a slab the caller
 *  scales to the thickness it wants. */
export function tileSlabGeometry(
  radius: number,
  corner: number
): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(tileShape(radius, corner), {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 12,
  });
  // Extruded toward +z; turned +90 degrees about x it runs down from y = 0 to
  // y = -1, and the lift brings it to 0 to 1 with its cap facing up. (The
  // other turn put it at 1 to 2, a lamp floating its own thickness above the
  // face.)
  g.rotateX(Math.PI / 2);
  g.translate(0, 1, 0);
  g.computeVertexNormals();
  return g;
}

/** A flat ring of the tile's outline, lying in XZ, normal +Y. */
export function tileRingGeometry(
  outer: number,
  inner: number,
  corner: number
): THREE.BufferGeometry {
  const shape = tileShape(outer, corner);
  const hole = new THREE.Path();
  trace(hole, inner, corner);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 12);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** The tile's outline as a thin band around its edge, `height` tall,
 *  centred on y = 0. */
export function tileBandGeometry(
  radius: number,
  height: number,
  corner: number
): THREE.BufferGeometry {
  const shape = tileShape(radius + 0.005, corner);
  const hole = new THREE.Path();
  trace(hole, radius - 0.035, corner);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 12,
  });
  g.translate(0, 0, -height / 2);
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/**
 * The tile body: the outline extruded `height` tall along +Y, centred on
 * the origin, with the material's edge profile (null is a crisp edge).
 */
export function tilePrismGeometry(
  radius: number,
  height: number,
  corner: number,
  edge: { size: number; thickness: number; segments: number } | null
): THREE.BufferGeometry {
  if (!edge) {
    const g = new THREE.ExtrudeGeometry(tileShape(radius, corner), {
      depth: height,
      bevelEnabled: false,
      curveSegments: 12,
    });
    g.translate(0, 0, -height / 2);
    g.rotateX(-Math.PI / 2);
    return smoothed(g);
  }
  const depth = Math.max(0.02, height - 2 * edge.thickness);
  const g = new THREE.ExtrudeGeometry(tileShape(radius - edge.size, corner), {
    depth,
    bevelEnabled: true,
    bevelThickness: edge.thickness,
    bevelSize: edge.size,
    bevelOffset: 0,
    bevelSegments: edge.segments,
    curveSegments: 12,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateX(-Math.PI / 2);
  return smoothed(g);
}
