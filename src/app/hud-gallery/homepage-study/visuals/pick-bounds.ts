/**
 * Keeping instanced meshes pickable (ENG-031 W15h).
 *
 * Three decides whether a ray can touch an instanced mesh by testing it
 * against the mesh's bounding sphere first, and it computes that sphere once,
 * the first time anything asks, from the instances that exist at that moment.
 * This study's meshes are packed and move every frame: at that first moment
 * there may be no agents at all (the first frames), or ten (the landing), and
 * the sphere then excludes every tile that arrives later, or is empty and
 * excludes all of them. The visible symptom was a page where nothing could be
 * hovered or clicked. (It surfaced only when instances were packed; while
 * every tile always had a matrix, the first sphere happened to cover them.)
 *
 * Everything in the study lives on one globe, so one sphere does for every
 * pickable mesh: the globe and a margin for the tallest tile. Per-instance
 * tests still reject quickly, so a generous sphere costs nothing measurable.
 * Asserted every frame because three will recompute and overwrite it if
 * anything calls `computeBoundingSphere`, and it is two comparisons.
 */

import * as THREE from 'three';
import { SPHERE_CENTER, SPHERE_RADIUS } from '../sphere';

/** The globe's radius and room above it for a lifted agent. */
const PICK_RADIUS = SPHERE_RADIUS + 6;

export function keepPickable(mesh: THREE.InstancedMesh) {
  const sphere = mesh.boundingSphere;
  if (sphere === null || sphere.radius !== PICK_RADIUS) {
    mesh.boundingSphere = new THREE.Sphere(SPHERE_CENTER.clone(), PICK_RADIUS);
  }
}
