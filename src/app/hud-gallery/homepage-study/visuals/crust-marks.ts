/**
 * Harness marks on the agent tile (ENG-031 W15f, operator 2026-10-12: "when
 * I see the Claude Code or OpenClaw logos on the game board in the fleet,
 * then I instantly know what this product does... avoid messily slapping
 * the logo onto the 3D surface... make sure it appears first class on the
 * 3D agent itself").
 *
 * The marks are the vendors' own path data, the same bytes the product's
 * chrome draws (`harness-icons.tsx`), extruded into real geometry: no
 * texture and no decal, so a mark is lit by the light that lights the tile
 * and can take the tile's material. Three ways to carry it, all a study
 * switch:
 *
 * - Lit: a thin inlay in one neutral ink, the way the product's chrome
 *   draws every mark (one ink, never a tint: LICENSES/brand/harness-marks.md).
 * - Relief: the mark stands proud of the tile in the tile's own material,
 *   like a stamped coin.
 * - Coin: a light disc on the tile with the mark in relief on it.
 *
 * Marks face the camera, so a logo is upright from wherever the story looks.
 * Antigravity has no mark: Google permits only its own artwork, unaltered.
 *
 * Unit geometries: a mark fits a 1 by 1 box centred on the origin and is
 * extruded from y = 0 to y = 1; the visual scales each instance to the size
 * and depth its treatment wants.
 */

import * as THREE from 'three';
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';

export type CrustMarkId = 'off' | 'lit' | 'relief' | 'coin';

export const CRUST_MARKS: { id: CrustMarkId; name: string; note: string }[] = [
  { id: 'off', name: 'Off', note: 'No harness mark on the tile.' },
  {
    id: 'lit',
    name: 'Lit',
    note: 'A thin lit inlay in one neutral ink, the way the product draws every mark.',
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

const MARK_IDS = Object.keys(
  HARNESS_MARK_PATHS
) as (keyof typeof HARNESS_MARK_PATHS)[];

export const MARK_COUNT = MARK_IDS.length;

/** Slot of a harness's mark geometry, or -1 for a harness with no mark. */
export function markIndexFor(adapterId: string): number {
  return (MARK_IDS as readonly string[]).indexOf(adapterId);
}

function markSvg(id: keyof typeof HARNESS_MARK_PATHS): string {
  const mark = HARNESS_MARK_PATHS[id];
  const paths = mark.d
    .map(d => `<path d="${d}" fill="#000" fill-rule="${mark.fillRule}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${mark.viewBox} ${mark.viewBox}">${paths}</svg>`;
}

/** One unit geometry per mark, in `markIndexFor` order. Caller disposes. */
export function makeMarkGeometries(): THREE.BufferGeometry[] {
  const loader = new SVGLoader();
  return MARK_IDS.map(id => {
    const box = HARNESS_MARK_PATHS[id].viewBox;
    const shapes: THREE.Shape[] = [];
    for (const path of loader.parse(markSvg(id)).paths)
      shapes.push(...SVGLoader.createShapes(path));
    const g = new THREE.ExtrudeGeometry(shapes, {
      depth: 1,
      bevelEnabled: false,
      curveSegments: 10,
    });
    // Centre the vendor's box on the origin and fit it to one unit.
    g.translate(-box / 2, -box / 2, 0);
    g.scale(1 / box, 1 / box, 1);
    // SVG y runs down the page. Turned this way the page's up is the tile's
    // local -Z and the extrusion runs down local Y; lifted back up so it
    // stands from 0 to 1 on the tile. No mirror, so the mark reads as drawn.
    g.rotateX(Math.PI / 2);
    g.translate(0, 1, 0);
    g.computeVertexNormals();
    return g;
  });
}
