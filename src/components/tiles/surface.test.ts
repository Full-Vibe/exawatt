import { expect, it } from 'vitest';
import * as THREE from 'three';
import {
  surfacePoint,
  surfaceNormal,
  surfaceQuaternion,
  planeToSphere,
  tileQuaternion,
} from './surface';
it('keeps exact sphere mapping and supplies an uncurved plane', () => {
  for (const [x, y] of [
    [0, 0],
    [4, -8],
    [30, 12],
  ]) {
    expect(surfacePoint('sphere', x, y, new THREE.Vector3())).toEqual(
      planeToSphere(x, y, new THREE.Vector3())
    );
    expect(surfaceQuaternion('sphere', x, y, new THREE.Quaternion())).toEqual(
      tileQuaternion(x, y, new THREE.Quaternion())
    );
    expect(
      surfacePoint('plane', x, y, new THREE.Vector3(), 2).toArray()
    ).toEqual([x, 2, y]);
    expect(
      surfaceNormal(
        'plane',
        new THREE.Vector3(x, 2, y),
        new THREE.Vector3()
      ).toArray()
    ).toEqual([0, 1, 0]);
    expect(surfaceQuaternion('plane', x, y, new THREE.Quaternion())).toEqual(
      new THREE.Quaternion()
    );
  }
});
