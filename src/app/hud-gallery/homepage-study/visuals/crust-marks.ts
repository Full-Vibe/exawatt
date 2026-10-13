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
 * - Lit: a thin inlay, in the vendor's own colour where it has one and in
 *   one neutral ink otherwise (LICENSES/brand/harness-marks.md).
 * - Relief: the mark stands proud of the tile in the tile's own material,
 *   tinted toward the vendor's colour.
 * - Coin: a light disc on the tile with the mark in relief on it.
 *
 * A mark is one or more parts (W15g): most are one shape; OpenClaw's pixel
 * lobster is its outline, body, claws and eyes in the artwork's own tones,
 * because the silhouette alone did not read as a lobster (operator
 * 2026-10-13). Marks face the camera, so a logo is upright from wherever
 * the story looks. Antigravity has no mark: Google permits only its own
 * artwork, unaltered.
 *
 * Unit geometries: a part fits a 1 by 1 box centred on the origin and is
 * extruded from y = 0 to y = 1; the visual scales each instance to the size
 * and depth its treatment wants and lifts a raised part by its `raise`.
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

type MarkId = keyof typeof HARNESS_MARK_PATHS;

const MARK_IDS = Object.keys(HARNESS_MARK_PATHS) as MarkId[];

/** The vendor's own colour for its mark, where it supplies one: Anthropic
 *  draws Claude's mark in its terracotta; OpenClaw's lobster is red by its
 *  own artwork. The others are supplied in black and white only and take
 *  the surrounding ink. Study paint, not product chrome: the product draws
 *  every mark in one ink (LICENSES/brand/harness-marks.md). */
const BRAND: Partial<Record<MarkId, string>> = {
  claude: '#D97757',
  openclaw: '#ff4f40',
};

/** The pixel lobster's own tones, the same bytes the SVG paints. */
const ARTWORK_TONES = {
  outline: '#3a0a0d',
  body: '#ff4f40',
  claws: '#ff775f',
  eyeDark: '#081016',
  eyeLight: '#f5fbff',
} as const;

export const MARK_COUNT = MARK_IDS.length;

/** Slot of a harness's mark, or -1 for a harness with no mark. */
export function markIndexFor(adapterId: string): number {
  return (MARK_IDS as readonly string[]).indexOf(adapterId);
}

/** One extruded part of a mark, with how it is coloured and lifted. */
interface MarkPart {
  /** Which mark this part belongs to, in `markIndexFor` order. */
  mark: number;
  geometry: THREE.BufferGeometry;
  /** `ink` takes the surrounding ink, `brand` the vendor's colour, or a
   *  fixed colour of the artwork's own. */
  tone: 'ink' | 'brand' | THREE.Color;
  /** Lift above the mark's base, in mark depths. */
  raise: number;
}

/** The vendor's colour for a mark, or null where it supplies none. */
export function markBrand(index: number): THREE.Color | null {
  const brand = BRAND[MARK_IDS[index]];
  return brand ? new THREE.Color(brand) : null;
}

function partSvg(viewBox: number, fillRule: string, d: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewBox} ${viewBox}"><path d="${d}" fill="#000" fill-rule="${fillRule}"/></svg>`;
}

/** Every part of every mark, in mark order. Caller disposes. */
export function makeMarkParts(): MarkPart[] {
  const loader = new SVGLoader();
  const out: MarkPart[] = [];
  MARK_IDS.forEach((id, index) => {
    const mark = HARNESS_MARK_PATHS[id];
    for (const part of mark.parts) {
      const shapes: THREE.Shape[] = [];
      for (const path of loader.parse(
        partSvg(mark.viewBox, mark.fillRule, part.d)
      ).paths)
        shapes.push(...SVGLoader.createShapes(path));
      const g = new THREE.ExtrudeGeometry(shapes, {
        depth: 1,
        bevelEnabled: false,
        curveSegments: 10,
      });
      // Centre the vendor's box on the origin and fit it to one unit.
      g.translate(-mark.viewBox / 2, -mark.viewBox / 2, 0);
      g.scale(1 / mark.viewBox, 1 / mark.viewBox, 1);
      // SVG y runs down the page. Turned this way the page's up is the
      // tile's local -Z and the extrusion runs down local Y; lifted back up
      // so it stands from 0 to 1 on the tile. No mirror, so the mark reads
      // as drawn.
      g.rotateX(Math.PI / 2);
      g.translate(0, 1, 0);
      g.computeVertexNormals();
      out.push({
        mark: index,
        geometry: g,
        tone:
          part.tone === 'ink' || part.tone === 'brand'
            ? part.tone
            : new THREE.Color(ARTWORK_TONES[part.tone]),
        raise: part.raise,
      });
    }
  });
  return out;
}
