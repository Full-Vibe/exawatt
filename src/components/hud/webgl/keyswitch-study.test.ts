import { afterEach, describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import {
  createFloatingKeycapGeometry,
  createKeycapGeometry,
  floatingKeycapDishDepth,
} from './keyswitch-geometry';

const geometries: THREE.BufferGeometry[] = [];

afterEach(() => {
  for (const geometry of geometries.splice(0)) geometry.dispose();
});

describe('createKeycapGeometry', () => {
  it('builds a finite, beveled keycap with a dished crown', () => {
    const geometry = createKeycapGeometry();
    geometries.push(geometry);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');

    for (let index = 0; index < position.count; index += 1) {
      expect(Number.isFinite(position.getX(index))).toBe(true);
      expect(Number.isFinite(position.getY(index))).toBe(true);
      expect(Number.isFinite(position.getZ(index))).toBe(true);
      expect(Number.isFinite(normal.getX(index))).toBe(true);
      expect(Number.isFinite(normal.getY(index))).toBe(true);
      expect(Number.isFinite(normal.getZ(index))).toBe(true);
    }

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox;
    expect(bounds).not.toBeNull();
    expect(bounds!.max.x - bounds!.min.x).toBeGreaterThan(1.75);
    expect(bounds!.max.y - bounds!.min.y).toBeGreaterThan(0.72);
    expect(bounds!.max.z - bounds!.min.z).toBeGreaterThan(1.75);

    const centerTop: number[] = [];
    const edgeTop: number[] = [];
    for (let index = 0; index < position.count; index += 1) {
      const x = Math.abs(position.getX(index));
      const y = position.getY(index);
      const z = Math.abs(position.getZ(index));
      if (y < 0.22) continue;
      if (x < 0.22 && z < 0.22) centerTop.push(y);
      if (x > 0.65 || z > 0.65) edgeTop.push(y);
    }

    expect(centerTop.length).toBeGreaterThan(0);
    expect(edgeTop.length).toBeGreaterThan(0);
    expect(Math.max(...edgeTop) - Math.max(...centerTop)).toBeGreaterThan(
      0.035
    );
  });

  it('builds the floating-key profile with upright walls and a broad face dish', () => {
    const width = 1.98;
    const height = 0.68;
    const geometry = createFloatingKeycapGeometry({
      width,
      height,
      depth: 1.98,
    });
    geometries.push(geometry);
    const position = geometry.getAttribute('position');

    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(width * 0.97);
    expect(bounds.max.x - bounds.min.x).toBeLessThan(width * 1.02);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(height, 4);

    const centerTop: number[] = [];
    const rimTop: number[] = [];
    const middleWidths: number[] = [];
    for (let index = 0; index < position.count; index += 1) {
      const x = Math.abs(position.getX(index));
      const y = position.getY(index);
      const z = Math.abs(position.getZ(index));
      if (x < 0.08 && z < 0.08) centerTop.push(y);
      if (x > width * 0.38 || z > width * 0.38) rimTop.push(y);
      if (Math.abs(y) < height * 0.1) middleWidths.push(Math.max(x, z));
    }

    expect(Math.max(...rimTop) - Math.max(...centerTop)).toBeCloseTo(
      floatingKeycapDishDepth(height),
      2
    );
    expect(Math.max(...middleWidths)).toBeGreaterThan(width * 0.48);
  });
});
