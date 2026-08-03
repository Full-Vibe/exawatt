import {
  PRODUCTION_THEME_IDS,
  THEME_REGISTRY,
} from '@/generated/theme-registry';
import { AppearancePreferencesSchema } from '../../../themes/contract.mjs';
import type {
  AppearancePreferencesV1,
  ThemeDefinitionV1,
  ThemeRegistry,
} from './types';

const productionIds = new Set<string>(PRODUCTION_THEME_IDS);
const registry: ThemeRegistry = THEME_REGISTRY;

export const PRODUCTION_THEME_REGISTRY: ThemeRegistry = Object.freeze(
  Object.fromEntries(
    PRODUCTION_THEME_IDS.map(themeId => [themeId, THEME_REGISTRY[themeId]])
  ) as Record<string, ThemeDefinitionV1>
);

export function parseProductionAppearancePreferences(
  raw: unknown
): AppearancePreferencesV1 | null {
  const parsed = AppearancePreferencesSchema.safeParse(raw);
  if (!parsed.success) return null;

  const selection = parsed.data.selection;
  if (selection.mode === 'manual') {
    return productionIds.has(selection.themeId) ? parsed.data : null;
  }

  const light = registry[selection.lightThemeId];
  const dark = registry[selection.darkThemeId];
  return productionIds.has(selection.lightThemeId) &&
    productionIds.has(selection.darkThemeId) &&
    light?.appearance === 'light' &&
    dark?.appearance === 'dark'
    ? parsed.data
    : null;
}
