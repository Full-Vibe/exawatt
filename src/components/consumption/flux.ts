/**
 * Consumption's own visual channel (ENG-008 design exploration).
 *
 * The D40 status-light protocol already owns white / blue / green / peach /
 * red, and the workspace chrome owns cyan and amber. Consumption therefore
 * gets a violet→magenta plasma ramp that cannot be mistaken for agent status:
 * nothing in the status protocol is violet, and nothing here is ever green,
 * peach, or fault-red. A meter going "hot" must never look like an agent
 * needing you.
 *
 * Inside the ramp, luminance encodes MARGINAL COST and area encodes RAW
 * VOLUME. Cache reads are the cheapest unit and the largest by volume, so
 * they render as dim ballast; output and reasoning are the expensive units and
 * glow. The eye reads "a small bright core inside a big dim mass", which is
 * the literal truth of a cache-heavy agent session.
 */

export const FLUX = {
  /** capacity at rest — plenty of headroom */
  calm: '#5D6BE8',
  /** working through the window at an unremarkable pace */
  mid: '#9B6BF5',
  /** the window will be tight */
  warm: '#D95CEE',
  /** the window is about to run out, or is projected to */
  hot: '#FF4FB4',
  /** empty capacity track */
  track: 'rgba(150, 120, 255, 0.13)',
  trackLine: 'rgba(150, 120, 255, 0.28)',
  /** nothing was reported — never a fill, never a zero */
  unknown: '#77839A',
  unknownLine: 'rgba(119, 131, 154, 0.5)',
  panel: 'rgba(10, 8, 26, 0.92)',
} as const;

/**
 * DOM projection of the Consumption channel.
 *
 * Keep this separate from `FLUX`: Fleet's burn lens still consumes concrete
 * sRGB values until its T4 spatial adapter lands, while DOM paint must retain
 * the `var()` references so preview, Auto, and accessibility overlays repaint
 * in place without remounting the Consumption surface.
 */
export const FLUX_CSS = {
  calm: 'var(--exa-consumption-calm)',
  mid: 'var(--exa-consumption-mid)',
  warm: 'var(--exa-consumption-warm)',
  hot: 'var(--exa-consumption-hot)',
  track: 'var(--exa-consumption-track)',
  trackLine: 'var(--exa-consumption-track-line)',
  unknown: 'var(--exa-consumption-unknown)',
  unknownLine: 'var(--exa-consumption-unknown-line)',
  panel: 'var(--exa-consumption-panel)',
} as const satisfies Record<keyof typeof FLUX, string>;

/** Generated, theme-aware chrome roles used only to frame Consumption data. */
export const CONSUMPTION_CHROME = {
  canvas: 'var(--exa-foundation-canvas)',
  surface: FLUX_CSS.panel,
  text: 'var(--exa-hud-text)',
  textDim: 'var(--exa-hud-text-dim)',
  textFaint: 'var(--exa-foundation-text-faint)',
  border: 'var(--exa-foundation-border)',
  borderStrong: 'var(--exa-foundation-border-strong)',
  hover: 'var(--exa-hud-fill)',
  selection: 'var(--exa-foundation-selection)',
  selectionText: 'var(--exa-foundation-selection-text)',
  focus: 'var(--exa-foundation-focus)',
} as const;

/** Raw unit channel. Order is stack order: ballast first, expensive last. */
export const UNIT_ORDER = [
  'cacheRead',
  'cacheWrite',
  'input',
  'output',
  'reasoning',
] as const;

export type UnitKey = (typeof UNIT_ORDER)[number];

export const UNIT_COLOR: Record<UnitKey, string> = {
  cacheRead: '#404A8F',
  cacheWrite: '#6355C9',
  input: '#8B6BF7',
  output: '#CE6BF4',
  reasoning: '#FF6BD6',
};

/** DOM projection of the raw-unit visualization channel. */
export const UNIT_COLOR_CSS: Record<UnitKey, string> = {
  cacheRead: 'var(--exa-consumption-units-cache-read)',
  cacheWrite: 'var(--exa-consumption-units-cache-write)',
  input: 'var(--exa-consumption-units-input)',
  output: 'var(--exa-consumption-units-output)',
  reasoning: 'var(--exa-consumption-units-reasoning)',
};

export const UNIT_LABEL: Record<UnitKey, string> = {
  cacheRead: 'cache read',
  cacheWrite: 'cache write',
  input: 'input',
  output: 'output',
  reasoning: 'reasoning',
};

// The normalization weight truth lives in ONE place: `@exawatt/core`'s
// model-weights module, stated for display by `units.ts`
// (`NORMALIZED_BASIS_SENTENCE`). The early design-exploration ratio table
// that used to sit here diverged from core's arithmetic (codex 1.4,
// reasoning ×5) and moved to its only remaining consumer, the frozen
// consumption-lab workbench (`src/app/hud-gallery/consumption-lab/weights.ts`).

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`;
}

function mixCss(a: string, b: string, t: number): string {
  const bounded = Math.max(0, Math.min(1, t));
  if (bounded === 0) return a;
  if (bounded === 1) return b;
  const aPercent = Math.round((1 - bounded) * 10_000) / 100;
  return `color-mix(in srgb, ${a} ${aPercent}%, ${b})`;
}

/** Alpha composition that remains live when `color` is a CSS variable. */
export function consumptionAlpha(color: string, alpha: number): string {
  const bounded = Math.max(0, Math.min(1, alpha));
  if (bounded === 1) return color;
  const percent = Math.round(bounded * 10_000) / 100;
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

/**
 * Pressure colour for a 0..100 window figure. Continuous rather than bucketed:
 * bucketing made 73% and 91% render as the same alarming magenta, which
 * flattened exactly the distinction the operator needs. Never green, never
 * fault-red — this ramp is indigo → violet → magenta and nothing else.
 */
export function pressureColor(usedPercent: number): string {
  const t = Math.max(0, Math.min(100, usedPercent)) / 100;
  if (t <= 0.62) return mix(FLUX.calm, FLUX.mid, t / 0.62);
  if (t <= 0.85) return mix(FLUX.mid, FLUX.warm, (t - 0.62) / 0.23);
  return mix(FLUX.warm, FLUX.hot, (t - 0.85) / 0.15);
}

/** Theme-aware DOM sibling of `pressureColor` over the same ramp stops. */
export function pressureColorCss(usedPercent: number): string {
  const t = Math.max(0, Math.min(100, usedPercent)) / 100;
  if (t === 0) return FLUX_CSS.calm;
  if (t === 0.62) return FLUX_CSS.mid;
  if (t === 0.85) return FLUX_CSS.warm;
  if (t === 1) return FLUX_CSS.hot;
  if (t <= 0.62) return mixCss(FLUX_CSS.calm, FLUX_CSS.mid, t / 0.62);
  if (t <= 0.85) {
    return mixCss(FLUX_CSS.mid, FLUX_CSS.warm, (t - 0.62) / 0.23);
  }
  return mixCss(FLUX_CSS.warm, FLUX_CSS.hot, (t - 0.85) / 0.15);
}

/** Diagonal hatch used wherever a source did not report — visibly not a fill. */
export function unknownHatch(alpha = 0.34): string {
  return `repeating-linear-gradient(-45deg, rgba(119,131,154,${alpha}) 0 1px, transparent 1px 5px)`;
}

/** Theme-aware DOM sibling of `unknownHatch`. */
export function unknownHatchCss(alpha = 0.34): string {
  return `repeating-linear-gradient(-45deg, ${consumptionAlpha(
    FLUX_CSS.unknown,
    alpha
  )} 0 1px, transparent 1px 5px)`;
}

/** Forward projection hatch — "where this lands if the pace holds". */
export function projectionHatch(color: string): string {
  return `repeating-linear-gradient(-45deg, ${color} 0 1.5px, transparent 1.5px 4.5px)`;
}

const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** 12_400_000 -> "12.4M". Tokens are read at a glance, never digit by digit. */
export function tokens(n: number): string {
  if (n === 0) return '0';
  if (n < 1000) return String(n);
  return COMPACT.format(n);
}

/** Exact figure for tooltips and titles, where precision is actually wanted. */
export function exact(n: number): string {
  return n.toLocaleString('en-US');
}

/** "2h 41m" / "3d 4h" / "18m". */
export function duration(ms: number): string {
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return remH === 0 ? `${days}d` : `${days}d ${remH}h`;
}

export function percent(n: number): string {
  return `${Math.round(n)}%`;
}

/** US dollars, only ever shown behind an explicit opt-in. */
export function dollars(n: number): string {
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
