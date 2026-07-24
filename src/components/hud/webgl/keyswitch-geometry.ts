import * as THREE from 'three';

const KEYCAP_WIDTH = 1.92;
const KEYCAP_HEIGHT = 0.86;
const KEYCAP_DEPTH = 1.92;

export interface FloatingKeycapGeometryOptions {
  width: number;
  height: number;
  depth: number;
  dishDepth?: number;
}

export function floatingKeycapDishDepth(height: number) {
  return Math.min(0.14, height * 0.18);
}

/**
 * Creates a closed, sculpted keycap volume. A lofted superellipse provides the
 * rounded-square footprint, tapered wall, rolled lower edge, and triangulated
 * dish needed for stable physically based transmission.
 */
export function createKeycapGeometry() {
  const segments = 64;
  const topRings = 10;
  const halfWidth = KEYCAP_WIDTH / 2;
  const halfDepth = KEYCAP_DEPTH / 2;
  const halfHeight = KEYCAP_HEIGHT / 2;
  const sideProfiles = [
    { y: -halfHeight, scale: 0.92 },
    { y: -halfHeight + 0.045, scale: 1.035 },
    { y: -halfHeight + 0.13, scale: 1.045 },
    { y: halfHeight - 0.18, scale: 0.92 },
    { y: halfHeight - 0.075, scale: 0.885 },
    { y: halfHeight, scale: 0.855 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const exponent = 2 / 4.8;

  const addRoundedLoop = (y: number, radial: number, scale: number) => {
    const start = positions.length / 3;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      const x =
        Math.sign(cosine) *
        Math.pow(Math.abs(cosine), exponent) *
        halfWidth *
        scale *
        radial;
      const z =
        Math.sign(sine) *
        Math.pow(Math.abs(sine), exponent) *
        halfDepth *
        scale *
        radial;
      positions.push(x, y, z);
    }
    return start;
  };

  const sideLoops = sideProfiles.map(profile =>
    addRoundedLoop(profile.y, 1, profile.scale)
  );
  for (let level = 0; level < sideLoops.length - 1; level += 1) {
    const lower = sideLoops[level];
    const upper = sideLoops[level + 1];
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(
        lower + segment,
        upper + segment,
        upper + next,
        lower + segment,
        upper + next,
        lower + next
      );
    }
  }

  const topLoops = [sideLoops.at(-1)!];
  for (let ring = 1; ring < topRings; ring += 1) {
    const radial = 1 - ring / topRings;
    const dish = 0.085 * (1 - radial * radial);
    topLoops.push(addRoundedLoop(halfHeight - dish, radial, 0.855));
  }
  for (let ring = 0; ring < topLoops.length - 1; ring += 1) {
    const outer = topLoops[ring];
    const inner = topLoops[ring + 1];
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(
        outer + segment,
        inner + segment,
        inner + next,
        outer + segment,
        inner + next,
        outer + next
      );
    }
  }

  const topCenter = positions.length / 3;
  positions.push(0, halfHeight - 0.085, 0);
  const innerTop = topLoops.at(-1)!;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(innerTop + segment, topCenter, innerTop + next);
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, -halfHeight, 0);
  const bottom = sideLoops[0];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(bottomCenter, bottom + segment, bottom + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Creates the chunky floating-key geometry used by the newer Work Louder
 * studies: nearly vertical walls, a rolled perimeter, and a broad recessed
 * face rather than the older keyboard-like taper.
 */
export function createFloatingKeycapGeometry({
  width,
  height,
  depth,
  dishDepth = floatingKeycapDishDepth(height),
}: FloatingKeycapGeometryOptions) {
  const segments = 72;
  const topRings = 14;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const halfHeight = height / 2;
  const sideProfiles = [
    { y: -halfHeight, scale: 0.9 },
    { y: -halfHeight + height * 0.055, scale: 0.94 },
    { y: -halfHeight + height * 0.16, scale: 0.985 },
    { y: -halfHeight + height * 0.42, scale: 1 },
    { y: halfHeight - height * 0.18, scale: 0.988 },
    { y: halfHeight - height * 0.065, scale: 0.968 },
    { y: halfHeight, scale: 0.94 },
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const exponent = 2 / 4.4;

  const addRoundedLoop = (y: number, radial: number, scale: number) => {
    const start = positions.length / 3;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);
      positions.push(
        Math.sign(cosine) *
          Math.pow(Math.abs(cosine), exponent) *
          halfWidth *
          scale *
          radial,
        y,
        Math.sign(sine) *
          Math.pow(Math.abs(sine), exponent) *
          halfDepth *
          scale *
          radial
      );
    }
    return start;
  };

  const connectLoops = (outer: number, inner: number) => {
    for (let segment = 0; segment < segments; segment += 1) {
      const next = (segment + 1) % segments;
      indices.push(
        outer + segment,
        inner + segment,
        inner + next,
        outer + segment,
        inner + next,
        outer + next
      );
    }
  };

  const sideLoops = sideProfiles.map(profile =>
    addRoundedLoop(profile.y, 1, profile.scale)
  );
  for (let level = 0; level < sideLoops.length - 1; level += 1) {
    connectLoops(sideLoops[level], sideLoops[level + 1]);
  }

  const topLoops = [sideLoops.at(-1)!];
  for (let ring = 1; ring < topRings; ring += 1) {
    const radial = 1 - ring / topRings;
    const inset = 1 - radial;
    const progress = THREE.MathUtils.clamp((inset - 0.055) / 0.66, 0, 1);
    const smoothDish = progress * progress * (3 - 2 * progress);
    topLoops.push(
      addRoundedLoop(
        halfHeight - dishDepth * smoothDish,
        radial,
        sideProfiles.at(-1)!.scale
      )
    );
  }
  for (let ring = 0; ring < topLoops.length - 1; ring += 1) {
    connectLoops(topLoops[ring], topLoops[ring + 1]);
  }

  const topCenter = positions.length / 3;
  positions.push(0, halfHeight - dishDepth, 0);
  const innerTop = topLoops.at(-1)!;
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(innerTop + segment, topCenter, innerTop + next);
  }

  const bottomCenter = positions.length / 3;
  positions.push(0, -halfHeight, 0);
  const bottom = sideLoops[0];
  for (let segment = 0; segment < segments; segment += 1) {
    const next = (segment + 1) % segments;
    indices.push(bottomCenter, bottom + segment, bottom + next);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
