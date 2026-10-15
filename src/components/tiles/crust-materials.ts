/**
 * Material options for the Crust geometry (ENG-031 W15c, operator
 * 2026-10-09: "I like the geometry, but I want a few other options for the
 * material of the agents"). Each option is a body material for agent tiles,
 * a ground material for territory, an edge profile and how the status
 * light is carried: painted on the body, inlaid on top, or lit from inside.
 *
 * Built once per option and disposed with it. Nothing here runs per frame.
 */

import * as THREE from 'three';

import {
  FLEET_MATERIALS,
  type FleetMaterial,
} from '@exawatt/core/desktop-bridge';

export type CrustMaterialId = FleetMaterial;
export const CRUST_MATERIALS = FLEET_MATERIALS;

interface CrustEdge {
  /** Outline inset taken by the bevel, tile units. */
  size: number;
  /** Depth of the bevel along the prism axis. */
  thickness: number;
  segments: number;
}

interface CrustMaterialSpec {
  id: CrustMaterialId;
  agent: THREE.Material;
  ground: THREE.Material;
  /** Null is a crisp extruded hex. */
  edge: CrustEdge | null;
  /** The status light sits inside the body (translucent options). */
  core: boolean;
  /** 1: the body is the status colour. 0: a neutral body, status on the inlay. */
  bodyTint: number;
  /** Status colour mixed toward white on the body. */
  pastel: number;
  /** Ground tiles mixed toward a pale frosted tint. */
  groundPale: number;
  /** Room environment intensity. 0 keeps the lights only. */
  environment: number;
  /** Multiplier on the inlay's emissive. */
  inlayGlow: number;
  /** Multiplier on how far an agent rises for its status. */
  liftScale: number;
  /** Multiplier on the scene lights, so a glossy body is not over-lit. */
  lightScale: number;
}

export function makeCrustMaterial(id: CrustMaterialId): CrustMaterialSpec {
  switch (id) {
    case 'glazed':
      return {
        id,
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.55,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          envMapIntensity: 0.35,
        }),
        ground: new THREE.MeshPhysicalMaterial({
          roughness: 0.62,
          metalness: 0,
          clearcoat: 0.8,
          clearcoatRoughness: 0.25,
          envMapIntensity: 0.3,
        }),
        edge: { size: 0.05, thickness: 0.04, segments: 2 },
        core: false,
        bodyTint: 1,
        pastel: 0,
        groundPale: 0,
        environment: 0.45,
        inlayGlow: 1,
        liftScale: 1,
        lightScale: 0.8,
      };
    case 'gummy':
      return {
        id,
        // A jelly (operator 2026-10-13: "Revisit the gummy material to make
        // it even more gelatinous and lickable and delightfully gummy", then
        // "slightly more transparent"): more than half clear, the rest the
        // jelly's own colour, softly blurred through (over a dark world a
        // clearer body only shows the dark), a wet clear coat over a smooth
        // body, puffy edges. It wobbles too: its springs are looser
        // (`crust-visual.tsx`).
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.26,
          metalness: 0,
          transmission: 0.6,
          thickness: 0.9,
          ior: 1.4,
          attenuationColor: new THREE.Color(0xffffff),
          attenuationDistance: 1.6,
          specularIntensity: 1,
          clearcoat: 1,
          clearcoatRoughness: 0.04,
          envMapIntensity: 0.75,
        }),
        ground: new THREE.MeshStandardMaterial({
          roughness: 0.72,
          metalness: 0.05,
          envMapIntensity: 0.25,
        }),
        edge: { size: 0.22, thickness: 0.17, segments: 6 },
        core: true,
        bodyTint: 1,
        pastel: 0,
        groundPale: 0,
        environment: 0.9,
        inlayGlow: 0.45,
        liftScale: 1,
        lightScale: 0.7,
      };
    case 'acrylic':
      return {
        id,
        // Frosted, with the status light inside: over a dark world there is
        // little to see through, so what reads as acrylic is the light the
        // body diffuses from within, the way a lit sign does. Clearer in
        // W15i and again in W15j (operator 2026-10-13: "Make acrylic
        // slightly more translucent", then "slightly more transparent"): the
        // lit cap and the depth show through a satin body with a glossier
        // edge.
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.34,
          metalness: 0,
          transmission: 0.87,
          thickness: 1.0,
          ior: 1.49,
          attenuationColor: new THREE.Color(0xffffff),
          attenuationDistance: 2.6,
          clearcoat: 0.45,
          clearcoatRoughness: 0.2,
          envMapIntensity: 0.9,
        }),
        ground: new THREE.MeshPhysicalMaterial({
          roughness: 0.62,
          metalness: 0,
          transmission: 0.55,
          thickness: 0.6,
          ior: 1.49,
          envMapIntensity: 0.6,
        }),
        edge: { size: 0.07, thickness: 0.05, segments: 2 },
        core: true,
        bodyTint: 1,
        pastel: 0.07,
        groundPale: 0.3,
        environment: 1.0,
        inlayGlow: 0.6,
        liftScale: 1.1,
        lightScale: 0.7,
      };
    case 'anodized':
      return {
        id,
        // Coloured metal with a brushed, anisotropic highlight. Metal is
        // only metal when the environment has a bright band to reflect.
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.24,
          metalness: 1,
          anisotropy: 0.7,
          clearcoat: 0.25,
          clearcoatRoughness: 0.2,
          envMapIntensity: 2.2,
        }),
        ground: new THREE.MeshStandardMaterial({
          roughness: 0.36,
          metalness: 0.85,
          envMapIntensity: 1.4,
        }),
        edge: { size: 0.05, thickness: 0.04, segments: 1 },
        core: false,
        bodyTint: 0.8,
        pastel: 0,
        groundPale: 0,
        environment: 1.6,
        inlayGlow: 1.15,
        liftScale: 0.85,
        lightScale: 0.7,
      };
    case 'matte':
    default:
      return {
        id: 'matte',
        agent: new THREE.MeshStandardMaterial({
          roughness: 0.6,
          metalness: 0.15,
        }),
        ground: new THREE.MeshStandardMaterial({
          roughness: 0.6,
          metalness: 0.15,
        }),
        edge: null,
        core: false,
        bodyTint: 1,
        pastel: 0,
        groundPale: 0,
        environment: 0,
        inlayGlow: 1,
        liftScale: 1,
        lightScale: 1,
      };
  }
}

export function disposeCrustMaterial(spec: CrustMaterialSpec) {
  spec.agent.dispose();
  spec.ground.dispose();
}
