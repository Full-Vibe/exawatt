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
 * strength, z a glow of the tile's own colour (Breathe), w how far the tile
 * has gone over to ground (the handover, below); and
 * `aWander`: where a light inside the tile is (x, y, in the tile's own
 * plane, tile units) and how strongly it shades the tile (z, 0 to 1), for
 * Wander (W15j): the side nearest the light brightens and the far side
 * dims, so the light reads as moving about inside. The band
 * crosses the tile on the screen's diagonal, lower left to upper right,
 * turned by the same yaw that turns the marks to the camera, so every
 * working agent's sheen travels the same way across the screen, like one
 * light passing over glass.
 *
 * The handover (W15o). An agent that leaves its tile becomes ground, which
 * the ground mesh draws in the ground's own material: a matte one, or a
 * clearer or glossier one than the body's. Easing the body's colour to the
 * ground's was not enough: on the frame the tile changed mesh its finish
 * changed at once, the clear coat, the glass and the gloss gone in a frame
 * (operator 2026-10-14, on the tiles around the one agent left: they
 * "transition from silvery to black and that kind of snaps"). So the body
 * takes on the ground's finish as it goes, by `aWork.w`, and is all ground
 * on the frame it changes mesh; an arriving agent starts as ground the same
 * way.
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

/**
 * What the ground looks like: the finish an agent's body takes on as it
 * becomes ground, read off the ground's material. A standard material has
 * no clear coat and no transmission, and reflects as an index of 1.5 does.
 * Every option's environment comes from the scene at one intensity, so the
 * two materials' own `envMapIntensity` never differs on screen.
 */
interface GroundFinish {
  roughness: number;
  metalness: number;
  ior: number;
  clearcoat: number;
  clearcoatRoughness: number;
  transmission: number;
  thickness: number;
}

export function groundFinish(material: THREE.Material): GroundFinish {
  const standard = material as THREE.MeshStandardMaterial;
  const physical = (material as THREE.MeshPhysicalMaterial)
    .isMeshPhysicalMaterial
    ? (material as THREE.MeshPhysicalMaterial)
    : null;
  return {
    roughness: standard.isMeshStandardMaterial ? standard.roughness : 1,
    metalness: standard.isMeshStandardMaterial ? standard.metalness : 0,
    ior: physical ? physical.ior : 1.5,
    clearcoat: physical ? physical.clearcoat : 0,
    clearcoatRoughness: physical ? physical.clearcoatRoughness : 0,
    transmission: physical ? physical.transmission : 0,
    thickness: physical ? physical.thickness : 0,
  };
}

/**
 * How far a tile has gone over to ground (`aWork.w`), from how much of an
 * agent it still is: not at all on an agent, and all the way at `swapAt`,
 * the agentness below which the ground's mesh draws the tile, so the frame
 * it changes mesh changes nothing on screen.
 */
export function handoverAt(agentness: number, swapAt: number): number {
  return Math.min(1, Math.max(0, (1 - agentness) / (1 - swapAt)));
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

const HANDOVER_PARS = /* glsl */ `
uniform float uGroundRoughness;
uniform float uGroundMetalness;
uniform float uGroundIor;
uniform float uGroundClearcoat;
uniform float uGroundClearcoatRoughness;
uniform float uGroundTransmission;
uniform float uGroundThickness;
`;

/** Gloss and metal, before the material is set up from them. */
const HANDOVER_SURFACE = /* glsl */ `
roughnessFactor = mix( roughnessFactor, uGroundRoughness, vWork.w );
metalnessFactor = mix( metalnessFactor, uGroundMetalness, vWork.w );
`;

/** The reflectance, the clear coat and the brushing, once the material is
 *  set up, as three's own setup computes them. */
const HANDOVER_MATERIAL = /* glsl */ `
#ifdef IOR
	material.ior = mix( material.ior, uGroundIor, vWork.w );
	material.specularColor = min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor;
	material.specularColorBlended = mix( material.specularColor, diffuseColor.rgb, metalnessFactor );
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = mix( material.clearcoat, uGroundClearcoat, vWork.w );
	material.clearcoatRoughness = mix( material.clearcoatRoughness, min( max( uGroundClearcoatRoughness, 0.0525 ) + geometryRoughness, 1.0 ), vWork.w );
#endif
#ifdef USE_ANISOTROPY
	material.anisotropy *= 1.0 - vWork.w;
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
#endif
`;

const TRANSMISSION_SETUP = 'material.transmission = transmission;';
const THICKNESS_SETUP = 'material.thickness = thickness;';

/** How clear the body is, as three sets it up, eased to the ground's. The
 *  setup lives inside its chunk, which `onBeforeCompile` sees as an
 *  unresolved include, so the include is replaced by the chunk's own text
 *  with the two lines changed. */
export const HANDOVER_TRANSMISSION = THREE.ShaderChunk.transmission_fragment
  .replace(
    TRANSMISSION_SETUP,
    'material.transmission = mix( transmission, uGroundTransmission, vWork.w );'
  )
  .replace(
    THICKNESS_SETUP,
    'material.thickness = mix( thickness, uGroundThickness, vWork.w );'
  );

/**
 * Light a material by the tile's work: a lit material takes it as emitted
 * light, a basic one (the lit cap) adds it to its colour. `localScale` maps
 * the geometry's own units onto the tile's, so the band runs on from the
 * body across the cap. Given the ground's material, the body also takes on
 * the ground's finish by the handover.
 */
export function withSurfaceLight<T extends THREE.Material>(
  material: T,
  uniforms: SurfaceLightUniforms,
  localScale: number,
  ground?: THREE.Material
): T {
  const scale = { value: localScale };
  const finish = ground ? groundFinish(ground) : null;
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
    if (finish) {
      shader.uniforms.uGroundRoughness = { value: finish.roughness };
      shader.uniforms.uGroundMetalness = { value: finish.metalness };
      shader.uniforms.uGroundIor = { value: finish.ior };
      shader.uniforms.uGroundClearcoat = { value: finish.clearcoat };
      shader.uniforms.uGroundClearcoatRoughness = {
        value: finish.clearcoatRoughness,
      };
      shader.uniforms.uGroundTransmission = { value: finish.transmission };
      shader.uniforms.uGroundThickness = { value: finish.thickness };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${HANDOVER_PARS}`)
        .replace(
          '#include <metalnessmap_fragment>',
          `#include <metalnessmap_fragment>\n${HANDOVER_SURFACE}`
        )
        .replace(
          '#include <lights_physical_fragment>',
          `#include <lights_physical_fragment>\n${HANDOVER_MATERIAL}`
        )
        // a function, so nothing in the chunk is read as a replacement pattern
        .replace(
          '#include <transmission_fragment>',
          () => HANDOVER_TRANSMISSION
        );
    }
  };
  material.customProgramCacheKey = () =>
    `${key}|crust-surface-light${finish ? '|ground-handover' : ''}`;
  return material;
}

/** Turn the band with the marks, once a frame. */
export function turnSurfaceLight(
  uniforms: SurfaceLightUniforms,
  yaw: number
): void {
  uniforms.uYaw.value = yaw;
}
