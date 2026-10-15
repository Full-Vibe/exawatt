'use client';

/**
 * A reflection environment with no network and no asset (ENG-031 W15b):
 * prefiltered once per canvas. Glass and liquid metal are nothing without
 * something to reflect and refract, and the public site must not fetch an
 * HDR from a CDN on first paint.
 *
 * Two rooms (W15d). `room` is three's procedural room: soft, grey, even,
 * which is why metal in it read as satin stone. `studio` is a dark box with
 * a few bright strips: a wide warm key overhead, a long cool strip to one
 * side, a thin warm rim behind, so a metal face shows a crisp band of light
 * against dark and glass gets one sharp highlight instead of a wash.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type EnvironmentKind = 'room' | 'studio';

function applyEnvironment(
  scene: THREE.Scene,
  texture: THREE.Texture | null,
  intensity: number
) {
  scene.environment = texture;
  scene.environmentIntensity = intensity;
}

function strip(
  scene: THREE.Scene,
  width: number,
  height: number,
  color: number,
  intensity: number,
  position: [number, number, number]
) {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(intensity),
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.position.set(...position);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
}

function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(40, 40, 40),
    new THREE.MeshBasicMaterial({ color: 0x0b0d12, side: THREE.BackSide })
  );
  scene.add(box);
  // a wide, soft key above and in front
  strip(scene, 14, 6, 0xfff1e0, 5, [0, 12, 8]);
  // a long cool strip to the left, the band metal shows
  strip(scene, 1.2, 16, 0xcfe4ff, 14, [-14, 4, -2]);
  // a thin warm rim behind and to the right
  strip(scene, 0.7, 12, 0xffd9b0, 9, [11, 3, -12]);
  // a faint floor bounce in front
  strip(scene, 18, 4, 0x8fa4c2, 1.2, [0, -6, 12]);
  return scene;
}

export function useRoomEnvironment(
  intensity = 1,
  kind: EnvironmentKind = 'room'
) {
  const { gl, scene } = useThree();
  const textureRef = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = kind === 'studio' ? studioScene() : new RoomEnvironment();
    const texture = pmrem.fromScene(
      room,
      kind === 'studio' ? 0.02 : 0.04
    ).texture;
    textureRef.current = texture;
    applyEnvironment(scene, texture, intensity);
    pmrem.dispose();
    return () => {
      if (scene.environment === texture) applyEnvironment(scene, null, 1);
      texture.dispose();
      textureRef.current = null;
    };
  }, [gl, scene, intensity, kind]);
}
