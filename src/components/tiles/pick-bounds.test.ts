import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { SPHERE_CENTER, SPHERE_RADIUS } from './surface';
import { keepPickable } from '@/components/tiles/pick-bounds';

/** A mesh of packed instances like the study's: a few exist, the rest do not. */
function packedMesh() {
  const mesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    300
  );
  mesh.updateMatrixWorld();
  return mesh;
}

/** Put one instance at a point on the globe's surface and count what a ray
 *  fired straight at it hits (a ray through a face's centre grazes both of
 *  its triangles, so a hit is "at least one", not "exactly one"). */
function hitsAt(mesh: THREE.InstancedMesh, angle: number): number {
  const surface = new THREE.Vector3(
    Math.sin(angle) * SPHERE_RADIUS,
    Math.cos(angle) * SPHERE_RADIUS,
    0
  ).add(SPHERE_CENTER);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(surface));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.count = 1;
  const origin = surface.clone().multiplyScalar(2).sub(SPHERE_CENTER);
  const ray = new THREE.Raycaster(
    origin,
    surface.clone().sub(origin).normalize()
  );
  return ray.intersectObject(mesh).length;
}

describe('picking packed instances', () => {
  it('fails without help when the first sphere was computed with nothing to pick', () => {
    // the first frames: no agents yet, and something asks for the sphere
    const mesh = packedMesh();
    mesh.count = 0;
    mesh.computeBoundingSphere();
    expect(mesh.boundingSphere?.radius).toBeLessThan(0);
    // agents arrive; the cached sphere is empty, so no ray can hit them
    expect(hitsAt(mesh, 0)).toBe(0);
  });

  it('fails without help when the sphere was computed at the landing', () => {
    const mesh = packedMesh();
    mesh.setMatrixAt(0, new THREE.Matrix4());
    mesh.count = 1;
    mesh.computeBoundingSphere();
    // a tile far round the globe, which the fleet stage brings in
    expect(hitsAt(mesh, 0.5)).toBe(0);
  });

  it('is pickable anywhere on the globe once kept pickable', () => {
    for (const first of ['empty', 'landing'] as const) {
      const mesh = packedMesh();
      mesh.count = first === 'empty' ? 0 : 1;
      mesh.computeBoundingSphere();
      keepPickable(mesh);
      for (const angle of [0, 0.2, 0.45, -0.45, 0.7]) {
        expect(hitsAt(mesh, angle)).toBeGreaterThan(0);
      }
    }
  });

  it('puts the sphere back if something recomputes it', () => {
    const mesh = packedMesh();
    keepPickable(mesh);
    mesh.count = 0;
    mesh.computeBoundingSphere();
    expect(mesh.boundingSphere?.radius).toBeLessThan(0);
    keepPickable(mesh);
    expect(hitsAt(mesh, 0.3)).toBeGreaterThan(0);
  });

  it('gives each mesh a sphere of its own, so one cannot corrupt another', () => {
    const a = packedMesh();
    const b = packedMesh();
    keepPickable(a);
    keepPickable(b);
    expect(a.boundingSphere).not.toBe(b.boundingSphere);
    expect(a.boundingSphere?.center.equals(SPHERE_CENTER)).toBe(true);
    expect(a.boundingSphere?.radius).toBeGreaterThan(SPHERE_RADIUS);
  });
});
