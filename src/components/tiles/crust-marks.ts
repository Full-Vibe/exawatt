/**
 * Harness marks on the agent tile (ENG-031 W15f, operator 2026-10-12: "when
 * I see the Claude Code or OpenClaw logos on the game board in the fleet,
 * then I instantly know what this product does... avoid messily slapping
 * the logo onto the 3D surface... make sure it appears first class on the
 * 3D agent itself").
 *
 * The marks are path data: the vendors' own, the same bytes the product's
 * chrome draws (`harness-icons.tsx`), and for the agents the product does
 * not run yet, the concept marks (`concept-marks.ts`). Each is extruded into
 * real geometry: no texture and no decal, so a mark is lit by the light that
 * lights the tile and can take the tile's material. Three ways to carry it, all a study
 * switch:
 *
 * - Lit: a thin inlay, in the vendor's own colour where it has one and in
 *   one neutral ink otherwise (LICENSES/brand/harness-marks.md).
 * - Relief: the mark stands proud of the tile in the tile's own material,
 *   tinted toward the vendor's colour.
 * - Coin: a light disc on the tile with the mark in relief on it.
 *
 * A mark is one or more parts (W15g). OpenClaw's mascot is a body, two
 * claws, two antennae, two eyes and their glints, in the artwork's own
 * tones; parts that overlap stand on different layers, so no two surfaces
 * ever share a plane (the fluttering the operator saw on the pixel lobster's
 * sides was exactly that: coplanar parts at one height, z-fighting). Marks
 * face the camera, so a logo is upright from wherever the story looks.
 * Antigravity has no mark: Google permits only its own artwork, unaltered.
 *
 * Unit geometries: a part fits a 1 by 1 box centred on the origin and is
 * extruded from y = 0 to y = 1; the visual scales each instance to the size
 * and depth its treatment wants and lifts a part by its layer.
 */

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import type { HarnessMarkPart } from '@/components/workspace/harness-icons';
import type { TileMarkRegistry } from './tile-contract';

export type CrustMarkId = 'off' | 'lit' | 'relief' | 'coin';

export const CRUST_MARKS: { id: CrustMarkId; name: string; note: string }[] = [
  { id: 'off', name: 'Off', note: 'No harness mark on the tile.' },
  {
    id: 'lit',
    name: 'Lit',
    note: 'A thin inlay in the vendor’s own colour, or one neutral ink where the vendor supplies none.',
  },
  {
    id: 'relief',
    name: 'Relief',
    note: 'The mark stands proud of the tile in the tile’s own material, like a stamped coin.',
  },
  {
    id: 'coin',
    name: 'Coin',
    note: 'A light disc on the tile, the mark in relief on it.',
  },
];

/** Registry order is the shared geometry's mark index. */
export function markIndexFor(
  registry: TileMarkRegistry,
  adapterId: string
): number {
  return Object.keys(registry.paths).indexOf(adapterId);
}

/** One extruded part of a mark, with how it is coloured and stacked. */
interface MarkPart {
  /** Which mark this part belongs to, in `markIndexFor` order. */
  mark: number;
  geometry: THREE.BufferGeometry;
  /** `ink` takes the surrounding ink, or the vendor's or the artwork's own
   *  colour. */
  tone: 'ink' | THREE.Color;
  /** Stacking layer: a higher layer stands on a lower one. */
  layer: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function partSvg(viewBox: number, fillRule: string, d: string): string {
  return `<svg xmlns="${SVG_NS}" viewBox="0 0 ${viewBox} ${viewBox}"><path d="${d}" fill="#000" fill-rule="${fillRule}"/></svg>`;
}

/** Points on the half circle that turns a stroke around at one end. */
const CAP_SEGMENTS = 8;

/**
 * A stroked centreline as a filled outline, with round caps: the left edge
 * out, a half circle round the far end, the right edge back, a half circle
 * round the near end. The vendor strokes the antennae; a relief needs a
 * shape to extrude.
 */
function strokeOutline(points: THREE.Vector2[], half: number): THREE.Shape {
  const n = points.length;
  const normals: THREE.Vector2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const t = b.clone().sub(a).normalize();
    normals.push(new THREE.Vector2(-t.y, t.x));
  }
  const left = points.map((p, i) =>
    p.clone().addScaledVector(normals[i], half)
  );
  const right = points.map((p, i) =>
    p.clone().addScaledVector(normals[i], -half)
  );
  const shape = new THREE.Shape();
  shape.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i += 1) shape.lineTo(left[i].x, left[i].y);
  // far end: from the left normal's angle, turning by -PI through the tangent
  const endAngle = Math.atan2(normals[n - 1].y, normals[n - 1].x);
  for (let k = 1; k <= CAP_SEGMENTS; k += 1) {
    const a = endAngle - (Math.PI * k) / (CAP_SEGMENTS + 1);
    shape.lineTo(
      points[n - 1].x + Math.cos(a) * half,
      points[n - 1].y + Math.sin(a) * half
    );
  }
  for (let i = n - 1; i >= 0; i -= 1) shape.lineTo(right[i].x, right[i].y);
  // near end: from the right normal's angle, turning by -PI through -tangent
  const startAngle = Math.atan2(normals[0].y, normals[0].x) + Math.PI;
  for (let k = 1; k <= CAP_SEGMENTS; k += 1) {
    const a = startAngle - (Math.PI * k) / (CAP_SEGMENTS + 1);
    shape.lineTo(
      points[0].x + Math.cos(a) * half,
      points[0].y + Math.sin(a) * half
    );
  }
  shape.closePath();
  return shape;
}

function partShapes(
  loader: SVGLoader,
  viewBox: number,
  fillRule: string,
  part: HarnessMarkPart
): THREE.Shape[] {
  const data = loader.parse(partSvg(viewBox, fillRule, part.d));
  const shapes: THREE.Shape[] = [];
  for (const path of data.paths) {
    if (part.stroke === undefined) {
      shapes.push(...SVGLoader.createShapes(path));
    } else {
      for (const sub of path.subPaths)
        shapes.push(strokeOutline(sub.getPoints(24), part.stroke / 2));
    }
  }
  return shapes;
}

/** Every part of every mark, in mark order. Caller disposes. */
export function makeMarkParts(registry: TileMarkRegistry): MarkPart[] {
  const loader = new SVGLoader();
  const out: MarkPart[] = [];
  Object.keys(registry.paths).forEach((id, index) => {
    const mark = registry.paths[id];
    const [dx, dy] = mark.translate ?? [0, 0];
    for (const part of mark.parts) {
      const g = new THREE.ExtrudeGeometry(
        partShapes(loader, mark.viewBox, mark.fillRule, part),
        // A mark is at most a hundred pixels across; six segments a curve is
        // smooth at that size, and twelve put a million vertices on the board
        // at three hundred agents.
        { depth: 1, bevelEnabled: false, curveSegments: 6 }
      );
      // Centre the vendor's box on the origin and fit it to one unit.
      g.translate(dx - mark.viewBox / 2, dy - mark.viewBox / 2, 0);
      g.scale(1 / mark.viewBox, 1 / mark.viewBox, 1);
      // SVG y runs down the page. Turned this way the page's up is the
      // tile's local -Z and the extrusion runs down local Y; lifted back up
      // so it stands from 0 to 1 on the tile. No mirror, so the mark reads
      // as drawn.
      g.rotateX(Math.PI / 2);
      g.translate(0, 1, 0);
      g.computeVertexNormals();
      const hex = registry.tone(id, part.tone);
      out.push({
        mark: index,
        geometry: g,
        tone: hex ? new THREE.Color(hex) : 'ink',
        layer: part.layer,
      });
    }
  });
  return out;
}
