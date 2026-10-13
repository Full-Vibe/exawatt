/**
 * The sheen (ENG-031 W15g): a soft band of light that sweeps across a
 * working tile's face and rests, drawn as one instanced overlay on the
 * tile's own outline, so it clips to a hex, a rounded hex or a puck without
 * any stencil. The band's position is a per-instance phase; the colour is
 * the instance colour. Additive, depth-tested, never writes depth, drawn
 * after the translucent bodies so it never refracts through them.
 */

import * as THREE from 'three';

/** Seconds for one sweep and its rest. */
const SHEEN_PERIOD = 3.2;
/** The share of the period the band is travelling. The rest is stillness. */
const SWEEP_SHARE = 0.5;

const VERTEX = /* glsl */ `
attribute float aPhase;
varying vec2 vLocal;
varying float vPhase;
varying vec3 vTint;
void main() {
  vLocal = position.xz;
  vPhase = aPhase;
  #ifdef USE_INSTANCING_COLOR
    vTint = instanceColor;
  #else
    vTint = vec3(1.0);
  #endif
  vec4 world = vec4(position, 1.0);
  #ifdef USE_INSTANCING
    world = instanceMatrix * world;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uSweepShare;
varying vec2 vLocal;
varying float vPhase;
varying vec3 vTint;
void main() {
  // across the tile along a diagonal, in tile units (radius is about 0.8)
  float u = dot(vLocal, vec2(0.8192, 0.5736)) / 0.8;
  float p = fract(vPhase);
  float travelling = step(p, uSweepShare);
  float x = clamp(p / uSweepShare, 0.0, 1.0);
  // ease the sweep so the band leaves and arrives softly
  float eased = x * x * (3.0 - 2.0 * x);
  float centre = mix(-1.7, 1.7, eased);
  float band = 1.0 - smoothstep(0.0, 0.42, abs(u - centre));
  float a = band * band * travelling;
  gl_FragColor = vec4(vTint, a);
  #include <colorspace_fragment>
}
`;

export function makeSheenMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uSweepShare: { value: SWEEP_SHARE } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
}

/** A phase, in turns, for a clock in seconds and a per-agent offset. */
export function sheenPhase(clock: number, offset: number): number {
  return clock / SHEEN_PERIOD + offset;
}
