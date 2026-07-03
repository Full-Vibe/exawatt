/**
 * Per-project colors (ENG-002 W0.2–W0.4): tabs of the same project share a
 * color; different projects get DISTINCT colors. Assignment is least-used-
 * first at group creation (hashing collided — two projects could land on
 * the same hue, operator report 2026-07-03) and persists with the layout;
 * the operator can override via the swatch picker on rename. The hash
 * remains only as a fallback for groups with no assigned color yet.
 */
import { HUD } from '@/components/hud';

export const PROJECT_PALETTE = [
  HUD.cyan,
  HUD.magenta,
  HUD.amber,
  HUD.green,
  '#9D7BFF', // violet
  HUD.cyan2,
  '#55A0FF', // blue
  '#FF7A5C', // coral
  '#C8F05A', // lime
  '#FF9BD2', // pink
] as const;

/** the least-used palette color (first wins ties) — guarantees distinct
 *  hues until the palette is exhausted */
export function pickDistinctColor(used: Array<string | undefined>): string {
  const counts = new Map<string, number>(PROJECT_PALETTE.map((c) => [c, 0]));
  for (const c of used) {
    if (c && counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string = PROJECT_PALETTE[0];
  let bestCount = Infinity;
  for (const c of PROJECT_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

/** fallback for groups without an assigned color (pre-W0.4 layouts) */
export function projectColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) >>> 0;
  }
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}
