import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fleetAt, fleetModel } from '../fleet-model';
import { SPHERE_CENTER } from '../sphere';
import { VisualAnchor } from '../visual-contract';
import { placeTiles, RIM_NOW, writeLabelAnchors } from './shared';

describe('a Project name pinned to its border', () => {
  it('moves smoothly as the camera turns, never in steps', () => {
    const model = fleetModel();
    const placements = placeTiles(model);
    const at = fleetAt(model, 100);
    const anchor = new VisualAnchor();
    const camera = new THREE.PerspectiveCamera(42, 1440 / 860, 0.5, 400);
    // look at the first Project from above and to one side, then turn the
    // world the way the slow orbit and a nudge of the pointer do
    const target = placements[0].position.clone();
    const up = target.clone().sub(SPHERE_CENTER).normalize();
    let previous: { x: number; y: number } | null = null;
    let largest = 0;
    for (let step = 0; step <= 400; step += 1) {
      const angle = step * 0.002;
      const offset = new THREE.Vector3(
        Math.sin(angle) * 14,
        0,
        Math.cos(angle) * 14
      );
      camera.position.copy(target).addScaledVector(up, 18).add(offset);
      camera.lookAt(target);
      camera.updateMatrixWorld();
      writeLabelAnchors(
        model,
        at,
        placements,
        camera,
        1440,
        860,
        anchor,
        1.8,
        RIM_NOW
      );
      const label = anchor.labels[0];
      expect(label.rimVisible).toBe(true);
      if (previous)
        largest = Math.max(
          largest,
          Math.hypot(label.rimX - previous.x, label.rimY - previous.y)
        );
      previous = { x: label.rimX, y: label.rimY };
    }
    // a turn of 0.002 radians moves the world a pixel or two; a step from
    // one sample of the outline to the next moved the name by many more
    expect(largest).toBeLessThan(4);
  });
});
