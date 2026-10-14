import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  tileBandGeometry,
  tileFaceGeometry,
  tilePrismGeometry,
  tileRingGeometry,
  tileSlabGeometry,
} from './crust-shape';

function bounds(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox as THREE.Box3;
}

/** The mean y of the vertices whose normal points up. */
function upFacingY(g: THREE.BufferGeometry): number | null {
  const position = g.getAttribute('position');
  const normal = g.getAttribute('normal');
  let sum = 0;
  let n = 0;
  for (let i = 0; i < position.count; i += 1)
    if (normal.getY(i) > 0.9) {
      sum += position.getY(i);
      n += 1;
    }
  return n ? sum / n : null;
}

describe.each([0, 0.3, 0.5])('tile geometry at corner %s', corner => {
  it('stands a slab from the face up, its cap facing up', () => {
    const slab = tileSlabGeometry(0.5, corner);
    const b = bounds(slab);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(1, 6);
    expect(upFacingY(slab)).toBeCloseTo(1, 6);
  });

  it('lays a face flat at y = 0, facing up', () => {
    const face = tileFaceGeometry(0.8, corner);
    const b = bounds(face);
    expect(b.min.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0, 6);
    expect(upFacingY(face)).toBeCloseTo(0, 6);
  });

  it('lays a ring flat, with a hole', () => {
    const ring = tileRingGeometry(0.8, 0.7, corner);
    const b = bounds(ring);
    expect(b.max.y - b.min.y).toBeCloseTo(0, 6);
    // a ring of this width has no vertex near its centre
    const position = ring.getAttribute('position');
    for (let i = 0; i < position.count; i += 1)
      expect(Math.hypot(position.getX(i), position.getZ(i))).toBeGreaterThan(
        0.5
      );
  });

  it('centres a band and a prism on the origin', () => {
    const band = bounds(tileBandGeometry(0.8, 0.07, corner));
    expect(band.min.y).toBeCloseTo(-0.035, 6);
    expect(band.max.y).toBeCloseTo(0.035, 6);
    for (const edge of [null, { size: 0.1, thickness: 0.1, segments: 3 }]) {
      const prism = bounds(tilePrismGeometry(0.82, 0.42, corner, edge));
      expect(prism.min.y).toBeCloseTo(-0.21, 5);
      expect(prism.max.y).toBeCloseTo(0.21, 5);
    }
  });
});

describe('the corner', () => {
  it('rounds the outline: the puck reaches less far than the hexagon', () => {
    const reach = (corner: number) => {
      const b = bounds(tileFaceGeometry(0.8, corner));
      return Math.max(b.max.x, b.max.z, -b.min.x, -b.min.z);
    };
    expect(reach(0.3)).toBeLessThan(reach(0));
    expect(reach(0.5)).toBeLessThan(reach(0.3));
  });
});

describe.each([
  null,
  { size: 0.07, thickness: 0.05, segments: 2 },
  { size: 0.22, thickness: 0.17, segments: 6 },
])('a tile body with edge %o', edge => {
  it.each([0, 0.3, 0.5])('keeps its top flat at corner %s', corner => {
    const g = tilePrismGeometry(0.82, 0.42, corner, edge);
    g.computeBoundingBox();
    const top = (g.boundingBox as THREE.Box3).max.y;
    const position = g.getAttribute('position');
    const normal = g.getAttribute('normal');
    let capVertices = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getY(i) - top) > 1e-5) continue;
      if (normal.getY(i) < 0.6) continue; // a side wall's top edge
      capVertices += 1;
      expect(normal.getX(i)).toBe(0);
      expect(normal.getY(i)).toBe(1);
      expect(normal.getZ(i)).toBe(0);
    }
    expect(capVertices).toBeGreaterThan(0);
  });
});
