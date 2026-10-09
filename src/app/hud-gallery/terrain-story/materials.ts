import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SITES, surfaceY, teamOf, type WorldStyle } from './model';

export function agentGeometry(kind: WorldStyle) {
  if (kind === 'acrylic') {
    const slab = new RoundedBoxGeometry(0.55, 0.72, 0.22, 4, 0.08);
    slab.rotateZ(-0.16);
    const disc = new THREE.CylinderGeometry(0.31, 0.31, 0.1, 48);
    disc.rotateX(Math.PI / 2);
    disc.translate(0.08, 0.13, -0.13);
    const slabFlat = slab.index ? slab.toNonIndexed() : slab;
    const discFlat = disc.toNonIndexed();
    const merged = mergeGeometries([slabFlat, discFlat]);
    slabFlat.dispose();
    discFlat.dispose();
    slab.dispose();
    disc.dispose();
    return merged;
  }
  if (kind === 'prism') {
    const positions: number[] = [];
    const levels = [
      [-0.43, 0.13],
      [-0.3, 0.34],
      [0.25, 0.31],
      [0.43, 0.17],
    ];
    const point = (ring: number, side: number) => {
      const [y, r] = levels[ring];
      const angle = (side * Math.PI * 2) / 5 + 0.2;
      return [Math.cos(angle) * r, y, Math.sin(angle) * r];
    };
    for (let ring = 0; ring < 3; ring++)
      for (let side = 0; side < 5; side++) {
        const a = point(ring, side),
          b = point(ring, side + 1),
          c = point(ring + 1, side + 1),
          d = point(ring + 1, side);
        positions.push(...a, ...d, ...b, ...b, ...d, ...c);
      }
    for (let side = 0; side < 5; side++)
      positions.push(
        0,
        0.43,
        0,
        ...point(3, side + 1),
        ...point(3, side),
        0,
        -0.43,
        0,
        ...point(0, side),
        ...point(0, side + 1)
      );
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    geo.computeVertexNormals();
    return geo;
  }
  const geo = new THREE.SphereGeometry(0.39, 32, 24);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const deformation = 1 + 0.12 * Math.sin(y * 9 + x * 4) * Math.cos(z * 7);
    pos.setXYZ(i, x * deformation, y * 1.2, z * deformation);
  }
  geo.computeVertexNormals();
  return geo;
}

export function bodyMaterial(kind: WorldStyle, wire: boolean) {
  return new THREE.MeshPhysicalMaterial({
    color:
      kind === 'mercury'
        ? '#d8e4ec'
        : kind === 'acrylic'
          ? '#cfdbff'
          : '#e5edff',
    metalness: kind === 'mercury' ? 1 : 0,
    roughness: kind === 'mercury' ? 0.085 : kind === 'acrylic' ? 0.12 : 0.07,
    transmission: kind === 'mercury' ? 0 : kind === 'acrylic' ? 0.96 : 0.98,
    thickness: kind === 'acrylic' ? 0.3 : 0.55,
    ior: kind === 'prism' ? 1.52 : 1.46,
    dispersion: kind === 'prism' ? 0.5 : 0.025,
    iridescence: kind === 'prism' ? 0.65 : kind === 'mercury' ? 0.04 : 0.14,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [160, 420],
    attenuationColor: new THREE.Color(
      kind === 'acrylic' ? '#adc8f7' : '#d6e4ff'
    ),
    attenuationDistance: 2,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    envMapIntensity: kind === 'mercury' ? 1.8 : 1.2,
    wireframe: wire,
  });
}

// Rounded convex team territory. This is geometry generation, not a second camera mapping.
export function teamGeometry(team: number, count: number) {
  const points: { x: number; y: number }[] = [];
  for (const site of SITES.slice(0, count))
    if (teamOf(site.id) === team) {
      for (let i = 0; i < 12; i++)
        points.push({
          x: site.x + Math.cos((i * Math.PI) / 6) * 0.82,
          y: site.z + Math.sin((i * Math.PI) / 6) * 0.82,
        });
    }

  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: (typeof points)[number], b: typeof a, c: typeof a) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower: typeof points = [],
    upper: typeof points = [];
  for (const p of points) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (const p of [...points].reverse()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
  // Fixed topology lets fleet growth morph the same territory rather than swap meshes.
  const segments = 96,
    positions: number[] = [],
    indices: number[] = [];
  const center = { x: 0, y: 0 };
  for (const p of hull) {
    center.x += p.x / hull.length;
    center.y += p.y / hull.length;
  }
  const distances = [0];
  for (let i = 0; i < hull.length; i++)
    distances.push(
      distances[i] +
        Math.hypot(
          hull[(i + 1) % hull.length].x - hull[i].x,
          hull[(i + 1) % hull.length].y - hull[i].y
        )
    );
  const perimeter = distances.at(-1) ?? 0;
  for (let ring = 0; ring < 4; ring++)
    for (let i = 0; i < segments; i++) {
      const distance = (i / segments) * perimeter;
      let edge = 0;
      while (edge < hull.length - 1 && distances[edge + 1] < distance) edge++;
      const a = hull[edge] ?? center,
        b = hull[(edge + 1) % hull.length] ?? center;
      const t =
        (distance - distances[edge]) /
        Math.max(0.0001, (distances[edge + 1] ?? 0) - distances[edge]);
      const radial =
        ring === 0 ? 0.48 : ring === 1 ? 0.96 : ring === 2 ? 1 : 0.97;
      const x = center.x + (a.x + (b.x - a.x) * t - center.x) * radial,
        z = center.y + (a.y + (b.y - a.y) * t - center.y) * radial;
      positions.push(
        x,
        surfaceY(x, z) - (ring < 2 ? 0.28 : ring === 2 ? 0.35 : 0.47),
        z
      );
    }
  positions.push(center.x, surfaceY(center.x, center.y) - 0.28, center.y);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(segments * 4, next, i);
    for (let ring = 0; ring < 3; ring++) {
      const a = ring * segments + i,
        b = ring * segments + next,
        c = (ring + 1) * segments + i,
        d = (ring + 1) * segments + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
