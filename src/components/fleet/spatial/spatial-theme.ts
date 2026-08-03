import type { AgentStatus } from '@exawatt/core';
import {
  correctAccentContrast,
  mixHexColors,
  parseHexColor,
} from '@/lib/appearance/color';
import type {
  ResolvedAppearance,
  ThemeMaterialRecipeV1,
} from '@/lib/appearance/types';
import {
  statusLightStateForAgentStatus,
  type StatusLightState,
} from '@/components/status-light/protocol';

/**
 * Project identity is data, not theme state. Keep the shipped six-slot board
 * assignment stable; the active ground may only correct an assigned color far
 * enough to keep the zone edge visible. A preset never chooses the identity.
 */
export const SPATIAL_PROJECT_IDENTITY_PALETTE = [
  '#4FD8C4',
  '#5AA7E8',
  '#B8A76A',
  '#9A8FE8',
  '#6FC487',
  '#5AC4D8',
] as const;

export interface SpatialMaterialSnapshot {
  color: string;
  fallback: string;
  opacity: number;
  blur: number;
  saturation: number;
}

export interface SpatialThemeSnapshot {
  themeId: string;
  appearance: ResolvedAppearance['appearance'];
  enhancedContrast: boolean;
  reducedTransparency: boolean;
  canvas: string;
  grid: string;
  gridMajor: string;
  zone: string;
  zoneHover: string;
  selection: string;
  selectionWash: string;
  unit: string;
  unitMuted: string;
  /** Stable ground directly beneath every D40/Consumption unit mark. */
  markBacking: string;
  label: string;
  labelMuted: string;
  emissive: string;
  emissiveActive: string;
  focus: string;
  attention: string;
  destructive: string;
  destructiveText: string;
  status: Readonly<Record<StatusLightState, string>>;
  consumption: {
    calm: string;
    mid: string;
    warm: string;
    hot: string;
    unknown: string;
  };
  material: {
    chrome: SpatialMaterialSnapshot;
    overlay: SpatialMaterialSnapshot;
    raised: SpatialMaterialSnapshot;
  };
  bloom: {
    /** Air is deliberately complete without postprocessing. */
    enabled: boolean;
    threshold: number;
    strength: number;
    radius: number;
  };
  shadow: string;
}

function byte(value: number): string {
  return Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** A concrete sRGB color with composed alpha, safe for DOM paint. */
export function spatialColorWithAlpha(color: string, opacity: number): string {
  const parsed = parseHexColor(color);
  if (!parsed)
    throw new Error(`Expected an sRGB theme color, received ${color}`);
  return `#${byte(parsed.r)}${byte(parsed.g)}${byte(parsed.b)}${byte(
    parsed.a * opacity * 255
  )}`;
}

function materialSnapshot(
  recipe: ThemeMaterialRecipeV1
): SpatialMaterialSnapshot {
  return Object.freeze({
    color: spatialColorWithAlpha(recipe.tint, recipe.opacity),
    fallback: recipe.fallback,
    opacity: recipe.opacity,
    blur: recipe.blur,
    saturation: recipe.saturation,
  });
}

/**
 * Pure renderer adapter. It accepts one immutable resolver result and emits
 * concrete authored/derived sRGB strings only: no CSS variables, media-query
 * reads, Three objects, route state, or mutable scene data cross this boundary.
 */
export function spatialThemeFromResolvedAppearance(
  resolved: ResolvedAppearance
): SpatialThemeSnapshot {
  const { theme } = resolved;
  const { spatial } = theme;
  const enhanced = resolved.enhancedContrast;
  const grid = enhanced
    ? correctAccentContrast(spatial.grid, spatial.canvas, spatial.label, 3)
    : spatial.grid;
  const gridMajor = enhanced
    ? correctAccentContrast(spatial.grid, spatial.canvas, spatial.label, 4.5)
    : mixHexColors(spatial.grid, spatial.labelMuted, 0.18);
  const zone = enhanced
    ? mixHexColors(
        spatial.zone,
        spatial.label,
        theme.appearance === 'light' ? 0.12 : 0.18
      )
    : spatial.zone;
  const unit = enhanced
    ? correctAccentContrast(spatial.unit, spatial.canvas, spatial.label, 4.5)
    : spatial.unit;
  const unitMuted = enhanced
    ? correctAccentContrast(spatial.unitMuted, spatial.canvas, spatial.label, 3)
    : spatial.unitMuted;
  const status = Object.freeze({
    off: theme.status.off,
    active: theme.status.active,
    result: theme.status.result,
    'needs-you': theme.status.needsYou,
    fault: theme.status.fault,
  });
  const material = Object.freeze({
    chrome: materialSnapshot(theme.material.chrome),
    overlay: materialSnapshot(theme.material.overlay),
    raised: materialSnapshot(theme.material.raised),
  });
  const shadowSource =
    theme.appearance === 'light' ? theme.foundation.text : spatial.canvas;

  return Object.freeze({
    themeId: resolved.themeId,
    appearance: resolved.appearance,
    enhancedContrast: resolved.enhancedContrast,
    reducedTransparency: resolved.reducedTransparency,
    canvas: spatial.canvas,
    grid,
    gridMajor,
    zone,
    zoneHover: mixHexColors(zone, unitMuted, enhanced ? 0.52 : 0.36),
    selection: spatial.selection,
    selectionWash: spatialColorWithAlpha(
      spatial.selection,
      enhanced ? 0.18 : 0.1
    ),
    unit,
    unitMuted,
    markBacking: spatial.canvas,
    label: spatial.label,
    labelMuted: enhanced ? spatial.label : spatial.labelMuted,
    emissive: spatial.emissive,
    emissiveActive: spatial.emissiveActive,
    focus: theme.foundation.focus,
    attention: theme.hud.amber,
    destructive: theme.foundation.destructive,
    destructiveText: theme.foundation.destructiveText,
    status,
    consumption: Object.freeze({
      calm: theme.consumption.calm,
      mid: theme.consumption.mid,
      warm: theme.consumption.warm,
      hot: theme.consumption.hot,
      unknown: theme.consumption.unknown,
    }),
    material,
    bloom: Object.freeze({
      enabled: theme.appearance === 'dark' && spatial.bloom.strength > 0,
      threshold: spatial.bloom.threshold,
      strength: spatial.bloom.strength,
      radius: spatial.bloom.radius,
    }),
    shadow: spatialColorWithAlpha(
      shadowSource,
      theme.appearance === 'light' ? 0.16 : 0.48
    ),
  });
}

export interface SpatialCalloutTheme {
  background: string;
  border: string;
  text: string;
  detail: string;
  signal: string;
}

/** D40 operator gates keep needs-you semantics without sacrificing body copy. */
export function spatialNeedsOperatorCallout(
  theme: SpatialThemeSnapshot
): SpatialCalloutTheme {
  return Object.freeze({
    background: theme.material.raised.fallback,
    border: theme.status['needs-you'],
    text: theme.label,
    detail: theme.labelMuted,
    signal: theme.status['needs-you'],
  });
}

/** Fault handoff messages use the authored solid destructive text pair. */
export function spatialFaultCallout(
  theme: SpatialThemeSnapshot
): SpatialCalloutTheme {
  return Object.freeze({
    background: theme.destructive,
    border: theme.destructive,
    text: theme.destructiveText,
    detail: theme.destructiveText,
    signal: theme.destructiveText,
  });
}

function hashId(id: string): number {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function spatialProjectIdentityColor(
  theme: SpatialThemeSnapshot,
  projectId: string
): string {
  const assigned =
    SPATIAL_PROJECT_IDENTITY_PALETTE[
      hashId(projectId) % SPATIAL_PROJECT_IDENTITY_PALETTE.length
    ]!;
  const corrected = correctAccentContrast(
    assigned,
    theme.zone,
    theme.selection,
    3
  );
  // The boundary is painted over its softly identity-tinted zone rather than
  // the raw zone ground. Correct against that final ground too, with a small
  // buffer for antialiasing at the one-pixel R3F/SVG edge.
  const tintedGround = mixHexColors(
    theme.zone,
    corrected,
    theme.appearance === 'light' ? 0.08 : 0.12
  );
  return correctAccentContrast(corrected, tintedGround, theme.selection, 3.3);
}

export function spatialProjectZoneFill(
  theme: SpatialThemeSnapshot,
  projectId: string
): string {
  return mixHexColors(
    theme.zone,
    spatialProjectIdentityColor(theme, projectId),
    theme.appearance === 'light' ? 0.08 : 0.12
  );
}

export function spatialStatusColor(
  theme: SpatialThemeSnapshot,
  status: AgentStatus
): string {
  return theme.status[statusLightStateForAgentStatus(status)];
}

/** Continuous Consumption pressure ramp, expressed as concrete sRGB hex. */
export function spatialPressureColor(
  theme: SpatialThemeSnapshot,
  ratio: number
): string {
  const t = Math.max(0, Math.min(1, ratio));
  if (t <= 0.62) {
    return mixHexColors(
      theme.consumption.calm,
      theme.consumption.mid,
      t / 0.62
    );
  }
  if (t <= 0.85) {
    return mixHexColors(
      theme.consumption.mid,
      theme.consumption.warm,
      (t - 0.62) / 0.23
    );
  }
  return mixHexColors(
    theme.consumption.warm,
    theme.consumption.hot,
    (t - 0.85) / 0.15
  );
}
