import { describe, expect, it } from 'vitest';
import { hexSpiral } from '@/components/tiles/hex';
import { axialToPlane } from '@/components/site/fleet-story/fleet-model';
import {
  BORDER_SAMPLES,
  borderInradius,
  writeBorder,
} from '@/components/tiles/territory';

const points = new Float32Array(BORDER_SAMPLES * 2);
const normals = new Float32Array(BORDER_SAMPLES * 2);

describe('territory border', () => {
  it.each([0, 1, 3, 8])('holds every tile of %s rings inside it', rings => {
    writeBorder(0, 0, rings, points, normals);
    // nearest distance from the border to any tile centre is past the tile's reach
    const tiles = hexSpiral({ q: 0, r: 0 }, rings).map(t =>
      axialToPlane(t.axial)
    );
    let nearest = Infinity;
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      for (const [x, y] of tiles) {
        nearest = Math.min(
          nearest,
          Math.hypot(points[i * 2] - x, points[i * 2 + 1] - y)
        );
      }
    }
    expect(nearest).toBeGreaterThan(0.82);
    // and it hugs them: no point further out than its rounded corner allows
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const d = Math.hypot(points[i * 2], points[i * 2 + 1]);
      expect(d).toBeLessThanOrEqual(
        borderInradius(rings) / Math.cos(Math.PI / 6) + 1e-4
      );
      expect(d).toBeGreaterThanOrEqual(borderInradius(rings) - 1e-4);
    }
  });

  it('spreads its points evenly and points its normals outward', () => {
    writeBorder(2, -1, 4, points, normals);
    const gaps: number[] = [];
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const j = (i + 1) % BORDER_SAMPLES;
      gaps.push(
        Math.hypot(
          points[j * 2] - points[i * 2],
          points[j * 2 + 1] - points[i * 2 + 1]
        )
      );
      const ox = points[i * 2] - 2;
      const oy = points[i * 2 + 1] + 1;
      expect(ox * normals[i * 2] + oy * normals[i * 2 + 1]).toBeGreaterThan(0);
    }
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.6);
  });
});
