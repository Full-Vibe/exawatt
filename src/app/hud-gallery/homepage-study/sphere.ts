/**
 * The shared sphere every visual option draws on (ENG-031 W15).
 *
 * The fleet is laid out on a plane in tile units and wrapped onto a sphere
 * whose pole sits at the world origin with its normal up (+Y). The sphere's
 * centre is therefore `(0, -RADIUS, 0)`. Wrapping is by arc length: a planar
 * point at distance `d` from the origin lands `d / RADIUS` radians down from
 * the pole, in the same azimuth. Near the pole this is the plane; far out it
 * is unmistakably a sphere, which is the operator's brief: "a section of a
 * 3D sphere, like a section of Earth's crust", demonstrably 3D, with the
 * territory growing to take over more of the surface as the fleet grows.
 *
 * All three options share this mapping, so the same agent sits at the same
 * world point in each, and the options differ only in how they draw it.
 */

import * as THREE from 'three';

/** In tile units (hex circumradius 1). A 300-agent fleet spans roughly 30
 *  units, so the full fleet covers about 45 degrees of arc. */
export const SPHERE_RADIUS = 38;

export const SPHERE_CENTER = new THREE.Vector3(0, -SPHERE_RADIUS, 0);

/** Planar (x, y) in tile units to a world point on the sphere. */
export function planeToSphere(
  x: number,
  y: number,
  out: THREE.Vector3,
  radius = SPHERE_RADIUS,
  lift = 0
): THREE.Vector3 {
  const d = Math.hypot(x, y);
  const theta = d / radius;
  const rr = radius + lift;
  if (d < 1e-6) return out.set(0, rr - radius, 0);
  const s = Math.sin(theta) * rr;
  return out.set((x / d) * s, Math.cos(theta) * rr - radius, (y / d) * s);
}

const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const n = new THREE.Vector3();
const p0 = new THREE.Vector3();
const p1 = new THREE.Vector3();
const p2 = new THREE.Vector3();
const basis = new THREE.Matrix4();

/**
 * Orientation of a tile at planar (x, y): local +X follows planar +x, local
 * +Z follows planar +y, local +Y is the sphere normal. Neighbouring tiles
 * therefore agree on their edge directions, which a plain look-at would not
 * give (it twists about the normal away from the pole).
 */
export function tileQuaternion(
  x: number,
  y: number,
  out: THREE.Quaternion
): THREE.Quaternion {
  const eps = 0.05;
  planeToSphere(x, y, p0);
  planeToSphere(x + eps, y, p1);
  planeToSphere(x, y + eps, p2);
  e1.subVectors(p1, p0).normalize();
  e2.subVectors(p2, p0).normalize();
  n.crossVectors(e2, e1).normalize();
  // re-orthogonalise e2 against the normal and e1
  e2.crossVectors(n, e1).normalize();
  basis.makeBasis(e1, n, e2);
  return out.setFromRotationMatrix(basis);
}
