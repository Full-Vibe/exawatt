/**
 * Stable per-project colors (ENG-002 W0.2): tabs of the same project share a
 * color; different projects get distinct colors. Deterministic hash of the
 * project name — stable across restarts with nothing to persist. Collisions
 * are acceptable (adjacent grouping carries most of the signal).
 */
import { HUD } from '@/components/hud';

const PALETTE = [
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

export function projectColor(projectName: string): string {
  let h = 0;
  for (let i = 0; i < projectName.length; i++) {
    h = (h * 31 + projectName.charCodeAt(i)) >>> 0;
  }
  return PALETTE[h % PALETTE.length];
}
