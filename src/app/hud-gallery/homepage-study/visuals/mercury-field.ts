/**
 * The liquid surface of one Project's pool (ENG-031 W15b), as a height map
 * rasterised into a marching-cubes field.
 *
 * Metaballs alone cannot make a thin sheet: a ball wide enough to touch its
 * neighbour is also tall. So the pool is built the other way round. A 2D
 * height map is splatted from the territory (a flat sheet with a soft edge,
 * combined by max) and from the agents (gaussian bumps, combined by sum so
 * neighbours merge into one body), bent down to follow the sphere, and then
 * written column by column into the 3D field so the iso-surface sits at
 * exactly that height. One pass over the cells, no per-cell search.
 *
 * Pure functions over typed arrays; no three.js here.
 */

import { SPHERE_RADIUS } from '../sphere';

interface PoolField {
  size: number;
  height: Float32Array;
  color: Float32Array;
  colorWeight: Float32Array;
}

export function makePoolField(size: number): PoolField {
  return {
    size,
    height: new Float32Array(size * size),
    color: new Float32Array(size * size * 3),
    colorWeight: new Float32Array(size * size),
  };
}

export function clearPoolField(field: PoolField) {
  field.height.fill(0);
  field.color.fill(0);
  field.colorWeight.fill(0);
}

/**
 * A flat disc of liquid, soft-edged, combined by max so overlapping tiles
 * make one sheet at one height. Coordinates are normalised 0..1 across the
 * volume; `radius` and `height` too.
 */
export function splatSheet(
  field: PoolField,
  cx: number,
  cz: number,
  radius: number,
  height: number,
  r: number,
  g: number,
  b: number
) {
  const n = field.size;
  const minX = Math.max(0, Math.floor((cx - radius) * n));
  const maxX = Math.min(n - 1, Math.ceil((cx + radius) * n));
  const minZ = Math.max(0, Math.floor((cz - radius) * n));
  const maxZ = Math.min(n - 1, Math.ceil((cz + radius) * n));
  for (let z = minZ; z <= maxZ; z += 1) {
    const dz = z / n - cz;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x / n - cx;
      const d = Math.sqrt(dx * dx + dz * dz) / radius;
      if (d >= 1) continue;
      // flat top, soft rim
      const t = d < 0.6 ? 1 : 1 - (d - 0.6) / 0.4;
      const h = height * t * t * (3 - 2 * t);
      const i = z * n + x;
      if (h > field.height[i]) field.height[i] = h;
      const w = t * 0.25;
      field.color[i * 3] += r * w;
      field.color[i * 3 + 1] += g * w;
      field.color[i * 3 + 2] += b * w;
      field.colorWeight[i] += w;
    }
  }
}

/** A gaussian bump, combined by sum, so adjacent droplets merge. */
export function splatBump(
  field: PoolField,
  cx: number,
  cz: number,
  radius: number,
  height: number,
  r: number,
  g: number,
  b: number
) {
  const n = field.size;
  const reach = radius * 2.6;
  const minX = Math.max(0, Math.floor((cx - reach) * n));
  const maxX = Math.min(n - 1, Math.ceil((cx + reach) * n));
  const minZ = Math.max(0, Math.floor((cz - reach) * n));
  const maxZ = Math.min(n - 1, Math.ceil((cz + reach) * n));
  const inv = 1 / (radius * radius);
  for (let z = minZ; z <= maxZ; z += 1) {
    const dz = z / n - cz;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x / n - cx;
      const g2 = Math.exp(-(dx * dx + dz * dz) * inv * 1.5);
      if (g2 < 0.01) continue;
      const i = z * n + x;
      field.height[i] += height * g2;
      const w = g2 * 2;
      field.color[i * 3] += r * w;
      field.color[i * 3 + 1] += g * w;
      field.color[i * 3 + 2] += b * w;
      field.colorWeight[i] += w;
    }
  }
}

/**
 * Write the height map into a marching-cubes field so the surface sits at
 * `floor + height`, bent down with the sphere away from the pool's centre.
 * `worldPerUnit` converts normalised units to world units for the bend.
 */
export function writeVolume(
  field: PoolField,
  volume: Float32Array,
  palette: Float32Array,
  floor: number,
  isolation: number,
  worldPerUnit: number,
  /** Depth of the liquid under its surface, normalised. */
  thickness: number,
  /** The sheet height, normalised, so the rim taper knows what full is. */
  sheet: number
) {
  const n = field.size;
  const n2 = n * n;
  const steep = 60 * n;
  for (let z = 0; z < n; z += 1) {
    const dz = (z / n - 0.5) * worldPerUnit;
    for (let x = 0; x < n; x += 1) {
      const dx = (x / n - 0.5) * worldPerUnit;
      const i2 = z * n + x;
      const h = field.height[i2];
      // the sphere falls away from the tangent plane by about d^2 / 2R
      const drop = (dx * dx + dz * dz) / (2 * SPHERE_RADIUS) / worldPerUnit;
      const surface = h > 0 ? floor + h - drop : -1;
      // a sheet, not a slab: the liquid is `thickness` deep under its
      // surface, tapering to nothing at the rim so the edge is a meniscus
      const rim = Math.min(1, h / sheet);
      const bottom = surface - thickness * rim * (2 - rim) - 0.002;
      const cw = field.colorWeight[i2];
      const cr = cw > 0 ? field.color[i2 * 3] / cw : 0;
      const cg = cw > 0 ? field.color[i2 * 3 + 1] / cw : 0;
      const cb = cw > 0 ? field.color[i2 * 3 + 2] / cw : 0;
      // three's field is indexed z, then y, then x
      for (let y = 0; y < n; y += 1) {
        const i = z * n2 + y * n + x;
        const fy = y / n;
        volume[i] =
          surface < 0
            ? 0
            : isolation + Math.min(surface - fy, fy - bottom) * steep;
        palette[i * 3] = cr;
        palette[i * 3 + 1] = cg;
        palette[i * 3 + 2] = cb;
      }
    }
  }
}
