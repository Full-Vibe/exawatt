import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { statusMarkRendering } from './status-mark-rendering';

describe('status mark depth ownership', () => {
  it('retains scene occlusion unless a presentation explicitly opts into annotations', () => {
    expect(statusMarkRendering()).toBe(statusMarkRendering('scene'));
    expect(statusMarkRendering().depthTest).toBe(true);
    expect(statusMarkRendering('overlay').depthTest).toBe(false);
  });

  it('never writes decorative depth and preserves backing, signal, unread ordering', () => {
    for (const policy of ['scene', 'overlay'] as const) {
      const rendering = statusMarkRendering(policy);
      const material = new THREE.MeshBasicMaterial({
        depthTest: rendering.depthTest,
        depthWrite: rendering.depthWrite,
      });
      expect(material.depthWrite).toBe(false);
      expect(rendering.backing).toBeLessThan(rendering.glyph);
      expect(rendering.glyph).toBeLessThanOrEqual(rendering.cutout);
      expect(rendering.cutout).toBeLessThan(rendering.unread);
      material.dispose();
    }
    expect(statusMarkRendering('overlay').glyph).toBeLessThan(
      statusMarkRendering('overlay').cutout
    );
    // An annotation's contrast plate also clears the existing world glyphs.
    expect(statusMarkRendering('overlay').backing).toBeGreaterThan(
      statusMarkRendering('scene').unread
    );
  });
});
