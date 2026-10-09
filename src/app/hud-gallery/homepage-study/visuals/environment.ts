'use client';

/**
 * A reflection environment with no network and no asset (ENG-031 W15b):
 * three's procedural room, prefiltered once per canvas. Glass and liquid
 * metal are nothing without something to reflect and refract, and the
 * public site must not fetch an HDR from a CDN on first paint.
 */

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

function applyEnvironment(
  scene: THREE.Scene,
  texture: THREE.Texture | null,
  intensity: number
) {
  scene.environment = texture;
  scene.environmentIntensity = intensity;
}

export function useRoomEnvironment(intensity = 1) {
  const { gl, scene } = useThree();
  const textureRef = useRef<THREE.Texture | null>(null);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const texture = pmrem.fromScene(room, 0.04).texture;
    textureRef.current = texture;
    applyEnvironment(scene, texture, intensity);
    pmrem.dispose();
    return () => {
      if (scene.environment === texture) applyEnvironment(scene, null, 1);
      texture.dispose();
      textureRef.current = null;
    };
  }, [gl, scene, intensity]);
}
