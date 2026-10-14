/**
 * Light on the agent's own surface (ENG-031 W15i): the working sheen and the
 * breath of light, drawn by the tile's body and its lit cap themselves, so
 * they cover exactly what is visible and nothing more. The sheen was an
 * overlay in W15g and W15h, a flat outline laid over the face; on a bevelled
 * tile it stood wider than the face it sat on (operator 2026-10-13: "The
 * sheen seems to apply to some greater surface that is larger than the
 * visible surface").
 *
 * Each instance carries `aWork`: x the sheen's phase in turns, y its
 * strength, z a glow of the tile's own colour (Breathe), w unused; and
 * `aWander`: where a light inside the tile is (x, y, in the tile's own
 * plane, tile units) and how strongly it shades the tile (z, 0 to 1), for
 * Wander (W15j): the side nearest the light brightens and the far side
 * dims, so the light reads as moving about inside. The band
 * crosses the tile on the screen's diagonal, lower left to upper right,
 * turned by the same yaw that turns the marks to the camera, so every
 * working agent's sheen travels the same way across the screen, like one
 * light passing over glass.
 *
 * Built once per material. Nothing here runs per frame but the uniform.
 */

import * as THREE from 'three';

/** Seconds for one sweep and its rest. */
const SHEEN_PERIOD = 3.2;

/** The yaw the marks are turned by, shared by every material it lights. */
interface SurfaceLightUniforms {
  uYaw: { value: number };
}

export function makeSurfaceLightUniforms(): SurfaceLightUniforms {
  return { uYaw: { value: 0 } };
}

/** A phase, in turns, for a clock in seconds and a per-agent offset. */
export function sheenPhase(clock: number, offset: number): number {
  return clock / SHEEN_PERIOD + offset;
}

/** Give a geometry its per-instance work and wandering-light attributes. */
export function addWorkAttributes(
  geometry: THREE.BufferGeometry,
  count: number
): void {
  const work = new THREE.InstancedBufferAttribute(
    new Float32Array(count * 4),
    4
  );
  work.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aWork', work);
  const wander = new THREE.InstancedBufferAttribute(
    new Float32Array(count * 3),
    3
  );
  wander.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aWander', wander);
}

const VERTEX_PARS = /* glsl */ `
attribute vec4 aWork;
attribute vec3 aWander;
varying vec4 vWork;
varying vec3 vWander;
varying vec3 vTileLocal;
varying vec3 vTileNormal;
`;

const VERTEX_MAIN = /* glsl */ `
vWork = aWork;
vWander = aWander;
vTileLocal = position;
vTileNormal = normal;
`;

const FRAGMENT_PARS = /* glsl */ `
uniform float uYaw;
uniform float uLocalScale;
varying vec4 vWork;
varying vec3 vWander;
varying vec3 vTileLocal;
varying vec3 vTileNormal;

// How near this point is to a light wandering inside the tile, 1 at it.
float wanderNear() {
  vec2 toLight = vTileLocal.xz * uLocalScale - vWander.xy;
  return 1.0 / (1.0 + dot(toLight, toLight) * 8.0);
}

// The wandering light shades the whole tile: brighter on the side it is
// near, darker across from it, the way a light carried through a block of
// glass lights it (an added glow alone cannot be seen on a bright body).
float wanderShade() {
  return mix(1.0, 0.42 + 0.95 * wanderNear(), vWander.z);
}

vec3 surfaceLight(vec3 own) {
  // where this point sits on the tile, in tile units (radius about 0.8)
  vec2 p = vTileLocal.xz * uLocalScale;
  float c = cos(uYaw);
  float s = sin(uYaw);
  vec2 right = vec2(c, -s);
  vec2 away = vec2(-s, -c);
  float u = dot(p, normalize(right * 0.8192 + away * 0.5736)) / 0.8;
  // half of each period the band travels, eased so it leaves and arrives
  // softly; the other half the tile rests
  float phase = fract(vWork.x);
  float travelling = step(phase, 0.5);
  float x = clamp(phase / 0.5, 0.0, 1.0);
  float centre = mix(-1.6, 1.6, x * x * (3.0 - 2.0 * x));
  float band = 1.0 - smoothstep(0.0, 0.32, abs(u - centre));
  // strongest on the top, a glint on the sides
  float top = smoothstep(0.25, 0.85, normalize(vTileNormal).y);
  float sheen = band * band * travelling * vWork.y * mix(0.3, 1.0, top);
  // and the surface nearest the wandering light glows a little of its own
  return mix(own, vec3(1.0), 0.65) * sheen * 0.95 + own * vWork.z +
    mix(own, vec3(1.0), 0.25) * vWander.z * wanderNear() * 0.6;
}
`;

/**
 * Light a material by the tile's work: a lit material takes it as emitted
 * light, a basic one (the lit cap) adds it to its colour. `localScale` maps
 * the geometry's own units onto the tile's, so the band runs on from the
 * body across the cap.
 */
export function withSurfaceLight<T extends THREE.Material>(
  material: T,
  uniforms: SurfaceLightUniforms,
  localScale: number
): T {
  const scale = { value: localScale };
  // a material may already have a patch of its own
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uYaw = uniforms.uYaw;
    shader.uniforms.uLocalScale = scale;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n${VERTEX_MAIN}`
      );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\n${FRAGMENT_PARS}`
    );
    shader.fragmentShader = shader.fragmentShader.includes(
      '#include <emissivemap_fragment>'
    )
      ? shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\ntotalEmissiveRadiance += surfaceLight(diffuseColor.rgb);'
        )
      : shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          'outgoingLight += surfaceLight(diffuseColor.rgb);\n#include <opaque_fragment>'
        );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      'outgoingLight *= wanderShade();\n#include <opaque_fragment>'
    );
  };
  material.customProgramCacheKey = () => `${key}|crust-surface-light`;
  return material;
}

/** Turn the band with the marks, once a frame. */
export function turnSurfaceLight(
  uniforms: SurfaceLightUniforms,
  yaw: number
): void {
  uniforms.uYaw.value = yaw;
}
