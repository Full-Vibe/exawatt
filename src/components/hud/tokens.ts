/**
 * HUD design tokens — single source of truth shared by DOM (components) and
 * future WebGL (emissive colors / bloom). Values mirror the @theme entries in
 * globals.css. Pure data; safe to import anywhere.
 */
import type { AgentStatus } from '@exawatt/core';

export const HUD = {
  bg: {
    void: '#04060B',
    deep: '#070B14',
    panel: '#0B1220',
    panelFill: 'rgba(7, 12, 20, 0.9)', // near-opaque dark glass: stops the bright edge-layer bleeding through
    hazeTeal: '#0E2230',
    hazeIndigo: '#141033',
    hazeMagenta: '#2A0D24',
  },
  cyan: '#19E6FF',
  cyan2: '#55EAD4',
  cyanDim: '#2B6E78',
  magenta: '#FF3B8B',
  amber: '#FFB02E',
  red: '#FF1F4B',
  green: '#6FE39F',
  idle: '#6A7585',
  text: '#DCEBFF',
  textDim: '#8AA0BE',
  textMono: '#9FE9F2',
  stroke: 'rgba(80,230,255,0.55)',
  strokeSoft: 'rgba(80,230,255,0.22)',
  fill: 'rgba(20,120,160,0.08)',
  fillHi: 'rgba(20,160,200,0.14)',
} as const;

export type HudTone = 'cyan' | 'magenta' | 'amber' | 'red' | 'green' | 'idle';

export const TONE_COLOR: Record<HudTone, string> = {
  cyan: HUD.cyan,
  magenta: HUD.magenta,
  amber: HUD.amber,
  red: HUD.red,
  green: HUD.green,
  idle: HUD.idle,
};

/** Status -> display color (kept in sync with ui-model STATUS_COLORS). */
export const HUD_STATUS_COLOR: Record<AgentStatus, string> = {
  working: HUD.cyan2,
  reviewing: HUD.amber,
  blocked: HUD.red,
  error: '#FF5C7A',
  complete: HUD.green,
  idle: HUD.idle,
};

/** Status -> tone bucket (for tinting frames/pills). */
export const STATUS_TONE: Record<AgentStatus, HudTone> = {
  working: 'cyan',
  reviewing: 'amber',
  blocked: 'red',
  error: 'red',
  complete: 'green',
  idle: 'idle',
};

/** Neon glow recipe (drop-shadow follows the element's alpha shape). */
export function glow(color: string, intensity = 1): string {
  const a = Math.min(1, 0.45 * intensity);
  // crisp inner line + soft outer bloom = neon edge
  return `drop-shadow(0 0 ${1.5 * intensity}px ${color}) drop-shadow(0 0 ${9 * intensity}px ${withAlpha(color, a)})`;
}

function withAlpha(hex: string, a: number): string {
  if (hex.startsWith('rgba') || hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export const FRAME = { chamfer: 12, border: 1.5 } as const;

export type Corner = 'tl' | 'tr' | 'br' | 'bl';

/** clip-path polygon for a panel with chamfered (45deg cut) corners, leg in px. */
export function chamferPolygon(
  corners: ReadonlyArray<Corner>,
  leg: number = FRAME.chamfer
): string {
  const c = (k: Corner) => corners.includes(k);
  const L = `${leg}px`;
  const pts: string[] = [];
  pts.push(c('tl') ? `${L} 0` : '0 0');
  if (c('tr')) pts.push(`calc(100% - ${L}) 0`, `100% ${L}`);
  else pts.push('100% 0');
  if (c('br')) pts.push(`100% calc(100% - ${L})`, `calc(100% - ${L}) 100%`);
  else pts.push('100% 100%');
  if (c('bl')) pts.push(`${L} 100%`, `0 calc(100% - ${L})`);
  else pts.push('0 100%');
  if (c('tl')) pts.push(`0 ${L}`);
  return `polygon(${pts.join(', ')})`;
}

export { withAlpha };
