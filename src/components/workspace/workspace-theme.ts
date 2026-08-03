/**
 * DOM-safe workspace theme roles.
 *
 * Workspace and roadmap surfaces render against the generated appearance
 * variables. Project identity and harness brand colors deliberately do not
 * live here: those are data/brand channels, not presentation paint.
 *
 * Classic fallbacks preserve the pre-ENG-032 rendering if a component is
 * mounted outside the application root (for example in an isolated test).
 */
export const WORKSPACE_HUD = {
  bg: {
    void: 'var(--exa-hud-void, #04060b)',
    deep: 'var(--exa-hud-deep, #070b14)',
    panel: 'var(--exa-hud-panel, #0b1220)',
    panelFill: 'var(--exa-hud-panel-fill, rgba(7, 12, 20, 0.9))',
    hazeTeal: 'var(--exa-hud-haze-teal, #0e2230)',
    hazeIndigo: 'var(--exa-hud-haze-indigo, #141033)',
    hazeMagenta: 'var(--exa-hud-haze-magenta, #2a0d24)',
  },
  cyan: 'var(--exa-hud-cyan, #19e6ff)',
  cyan2: 'var(--exa-hud-cyan2, #55ead4)',
  cyanDim: 'var(--exa-hud-cyan-dim, #2b6e78)',
  magenta: 'var(--exa-hud-magenta, #ff3b8b)',
  amber: 'var(--exa-hud-amber, #ffb02e)',
  red: 'var(--exa-hud-red, #ff1f4b)',
  green: 'var(--exa-hud-green, #6fe39f)',
  idle: 'var(--exa-hud-idle, #6a7585)',
  text: 'var(--exa-hud-text, #dcebff)',
  textDim: 'var(--exa-hud-text-dim, #8aa0be)',
  textMono: 'var(--exa-hud-text-mono, #9fe9f2)',
  stroke: 'var(--exa-hud-stroke, rgba(80, 230, 255, 0.55))',
  strokeSoft: 'var(--exa-hud-stroke-soft, rgba(80, 230, 255, 0.22))',
  strokeFaint: 'var(--exa-hud-stroke-faint, rgba(80, 230, 255, 0.14))',
  divider: 'var(--exa-hud-divider, rgba(80, 230, 255, 0.1))',
  surfaceInput:
    'var(--exa-hud-surface-input, rgba(8, 13, 22, 0.78))',
  surfaceInputSoft:
    'var(--exa-hud-surface-input-soft, rgba(8, 13, 22, 0.6))',
  fill: 'var(--exa-hud-fill, rgba(20, 120, 160, 0.08))',
  fillHi: 'var(--exa-hud-fill-hi, rgba(20, 160, 200, 0.14))',
} as const;

export const WORKSPACE_FOUNDATION = {
  canvas: 'var(--exa-foundation-canvas, #04060b)',
  overlay: 'var(--exa-foundation-overlay, #070c14)',
  text: 'var(--exa-foundation-text, #f4f4f4)',
  actionText: 'var(--exa-foundation-action-text, #031114)',
} as const;

/** Alpha composition that works for generated CSS variables and data colors. */
export function withThemeAlpha(color: string, alpha: number): string {
  const percentage = Math.round(Math.min(1, Math.max(0, alpha)) * 10_000) / 100;
  return `color-mix(in srgb, ${color} ${percentage}%, transparent)`;
}
