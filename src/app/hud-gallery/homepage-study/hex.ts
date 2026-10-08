/**
 * Pointy-top hex grid in axial coordinates, circumradius 1 (ENG-031 W15).
 * Pure functions, no three.js, so the fleet model can be tested without a
 * renderer.
 */

export interface Axial {
  q: number;
  r: number;
}

export interface SpiralTile {
  axial: Axial;
  ring: number;
}

const DIRECTIONS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** Tiles of one ring at distance `k`, in walking order. */
export function hexRing(center: Axial, k: number): Axial[] {
  if (k === 0) return [{ ...center }];
  const out: Axial[] = [];
  let q = center.q + DIRECTIONS[4].q * k;
  let r = center.r + DIRECTIONS[4].r * k;
  for (let side = 0; side < 6; side += 1) {
    for (let step = 0; step < k; step += 1) {
      out.push({ q, r });
      q += DIRECTIONS[side].q;
      r += DIRECTIONS[side].r;
    }
  }
  return out;
}

/** Centre first, then each ring outward. `1 + 3k(k+1)` tiles. */
export function hexSpiral(center: Axial, rings: number): SpiralTile[] {
  const out: SpiralTile[] = [];
  for (let k = 0; k <= rings; k += 1) {
    for (const axial of hexRing(center, k)) out.push({ axial, ring: k });
  }
  return out;
}

export function axialKey(a: Axial): string {
  return `${a.q},${a.r}`;
}
