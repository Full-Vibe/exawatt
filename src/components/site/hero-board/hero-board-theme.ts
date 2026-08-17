/**
 * One resolved spatial theme snapshot for the hero board (ENG-031 W2).
 *
 * The hero consumes the SAME renderer adapter the production Operations Board
 * consumes (`spatialThemeFromResolvedAppearance`), so a marketing board and a
 * product board cannot drift into two palettes. Concrete sRGB strings cross
 * this boundary; no CSS variables, no OS state.
 *
 * The public site is one fixed register (no dynamic dark mode — operator,
 * 2026-08-14). The study exposes the other presets only so a palette decision
 * in W7 can be read against a real board.
 */
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import type { BuiltInThemeId } from '@/lib/appearance/types';
import {
  spatialThemeFromResolvedAppearance,
  type SpatialThemeSnapshot,
} from '@/components/fleet/spatial/spatial-theme';

export const HERO_THEMES = {
  classic: 'exawatt-classic-dark',
  night: 'exawatt-night-dark',
  air: 'exawatt-air-light',
} as const satisfies Record<string, BuiltInThemeId>;

export type HeroThemeKey = keyof typeof HERO_THEMES;

/** The register the site ships in until W7's palette comps land. */
export const HERO_DEFAULT_THEME: HeroThemeKey = 'classic';

export function heroBoardTheme(key: HeroThemeKey): SpatialThemeSnapshot {
  const themeId = HERO_THEMES[key];
  const theme = THEME_REGISTRY[themeId];
  return spatialThemeFromResolvedAppearance(
    resolveAppearance(
      THEME_REGISTRY,
      {
        schemaVersion: 1,
        selection: { mode: 'manual', themeId },
        accentSource: 'theme',
        interfaceFont: 'theme',
        interfaceScale: 100,
        contrast: 'system',
        transparency: 'system',
      },
      {
        dark: theme.appearance === 'dark',
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    )
  );
}
