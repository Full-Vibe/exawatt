import { describe, expect, it } from 'vitest';
import { agentGeometry, teamGeometry } from './materials';
import { WORLDS, TEAMS } from './model';

describe('persistent terrain geometry', () => {
  it('keeps matching topology through empty, sparse and large fleets so growth can morph', () => {
    for (let team = 0; team < TEAMS.length; team++) {
      const shapes = [0, 1, 10, 100].map(count => teamGeometry(team, count));
      const lengths = shapes.map(g => g.attributes.position.array.length);
      expect(new Set(lengths).size).toBe(1);
      for (const shape of shapes) {
        expect(
          Array.from(shape.attributes.position.array).every(Number.isFinite)
        ).toBe(true);
        expect(
          Array.from(shape.attributes.normal.array).every(Number.isFinite)
        ).toBe(true);
        shape.dispose();
      }
    }
  });
  it('produces finite volumetric agent geometry for every available material', () => {
    for (const direction of WORLDS) {
      const shape = agentGeometry(direction.id);
      shape.computeBoundingBox();
      const box = shape.boundingBox!;
      expect(box.max.x).toBeGreaterThan(box.min.x);
      expect(box.max.y).toBeGreaterThan(box.min.y);
      expect(box.max.z).toBeGreaterThan(box.min.z);
      expect(
        Array.from(shape.attributes.position.array).every(Number.isFinite)
      ).toBe(true);
      shape.dispose();
    }
  });
});
