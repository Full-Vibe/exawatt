/**
 * Kind marks (ENG-031 W15c). The inlay on top of an agent tile is a glyph
 * for the harness that runs it, so a fleet reads what kind of agents it is
 * made of without a label: Claude Code is the hexagon (the tile's own
 * shape), Codex an open ring, OpenCode a triangle, Grok Build a square,
 * OpenClaw a ring, Antigravity a bar. Working agents turn their glyph
 * slowly, so the open ring is a spinner and the hexagon a nut; a still
 * glyph is waiting or done. With marks off every agent wears the hexagon.
 *
 * Flat extrusions, one geometry per glyph, instanced per glyph.
 */

import * as THREE from 'three';

const GLYPH_SOURCES = [
  'Claude Code',
  'Codex',
  'OpenCode',
  'Grok Build',
  'OpenClaw',
  'Antigravity',
] as const;

export const GLYPH_COUNT = GLYPH_SOURCES.length;

export function glyphIndexFor(source: string): number {
  const i = (GLYPH_SOURCES as readonly string[]).indexOf(source);
  return i < 0 ? 0 : i;
}

const DEPTH = 0.1;

function polygon(sides: number, radius: number, rotate = 0): THREE.Shape {
  const shape = new THREE.Shape();
  for (let k = 0; k < sides; k += 1) {
    const a = rotate + (k * Math.PI * 2) / sides;
    const x = Math.cos(a) * radius;
    const y = Math.sin(a) * radius;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

function extrude(shape: THREE.Shape, curveSegments = 24): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: false,
    curveSegments,
  });
  g.translate(0, 0, -DEPTH / 2);
  g.rotateX(-Math.PI / 2);
  return g;
}

function ring(outer: number, inner: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  return shape;
}

function openRing(outer: number, inner: number, gap: number): THREE.Shape {
  const shape = new THREE.Shape();
  const a0 = gap / 2;
  const a1 = Math.PI * 2 - gap / 2;
  shape.absarc(0, 0, outer, a0, a1, false);
  shape.absarc(0, 0, inner, a1, a0, true);
  shape.closePath();
  return shape;
}

function bar(length: number, width: number): THREE.Shape {
  const shape = new THREE.Shape();
  const r = width / 2;
  shape.moveTo(-length / 2 + r, -r);
  shape.lineTo(length / 2 - r, -r);
  shape.absarc(length / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
  shape.lineTo(-length / 2 + r, r);
  shape.absarc(-length / 2 + r, 0, r, Math.PI / 2, (Math.PI * 3) / 2, false);
  shape.closePath();
  return shape;
}

/** One geometry per glyph, in GLYPH_SOURCES order. Caller disposes. */
export function makeGlyphGeometries(): THREE.BufferGeometry[] {
  return [
    extrude(polygon(6, 0.56, Math.PI / 2), 1),
    extrude(openRing(0.5, 0.3, 1.1)),
    extrude(polygon(3, 0.56, Math.PI / 2), 1),
    extrude(polygon(4, 0.5, Math.PI / 4), 1),
    extrude(ring(0.5, 0.3)),
    extrude(bar(1.0, 0.26)),
  ];
}
