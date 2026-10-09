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

export type CrustMaterialId =
  | 'matte'
  | 'glazed'
  | 'gummy'
  | 'acrylic'
  | 'anodized';

export const CRUST_MATERIALS: {
  id: CrustMaterialId;
  name: string;
  note: string;
}[] = [
  { id: 'matte', name: 'Matte', note: 'Painted ceramic. The W15 baseline.' },
  {
    id: 'glazed',
    name: 'Glazed',
    note: 'A clear glaze over the painted body. Wet highlights, nothing see-through.',
  },
  {
    id: 'gummy',
    name: 'Gummy',
    note: 'Soft translucent body, rounded edges, status light scattering from inside.',
  },
  {
    id: 'acrylic',
    name: 'Acrylic',
    note: 'Satin coloured slabs on frosted clear ground. After together.ai.',
  },
  {
    id: 'anodized',
    name: 'Anodized',
    note: 'Brushed metal body with the status as an inlaid light.',
  },
];

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
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.34,
          metalness: 0,
          transmission: 0.58,
          thickness: 1.3,
          ior: 1.42,
          attenuationColor: new THREE.Color(0xffffff),
          attenuationDistance: 2.5,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
          envMapIntensity: 0.45,
        }),
        ground: new THREE.MeshStandardMaterial({
          roughness: 0.72,
          metalness: 0.05,
          envMapIntensity: 0.25,
        }),
        edge: { size: 0.15, thickness: 0.12, segments: 4 },
        core: true,
        bodyTint: 1,
        pastel: 0,
        groundPale: 0,
        environment: 0.8,
        inlayGlow: 0.45,
        liftScale: 1,
        lightScale: 0.7,
      };
    case 'acrylic':
      return {
        id,
        // Frosted, with the status light inside: over a dark world there is
        // nothing to see through, so what reads as acrylic is the light the
        // body diffuses from within, the way a lit sign does.
        agent: new THREE.MeshPhysicalMaterial({
          roughness: 0.48,
          metalness: 0,
          transmission: 0.72,
          thickness: 1.2,
          ior: 1.49,
          attenuationColor: new THREE.Color(0xffffff),
          attenuationDistance: 3,
          clearcoat: 0.3,
          clearcoatRoughness: 0.3,
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
        pastel: 0.1,
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

/**
 * A hex prism along +Y with the requested edge profile. Circumradius
 * `radius`, overall height `height`, centred on the origin like three's
 * CylinderGeometry, with a vertex on +Z so it matches the ghost rings.
 */
export function hexPrismGeometry(
  radius: number,
  height: number,
  edge: CrustEdge | null
): THREE.BufferGeometry {
  if (!edge) return new THREE.CylinderGeometry(radius, radius, height, 6, 1);
  const shape = new THREE.Shape();
  const r = radius - edge.size;
  for (let k = 0; k < 6; k += 1) {
    const a = Math.PI / 2 + (k * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const depth = Math.max(0.02, height - 2 * edge.thickness);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: edge.thickness,
    bevelSize: edge.size,
    bevelOffset: 0,
    bevelSegments: edge.segments,
    curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
