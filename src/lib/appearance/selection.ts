import { DEFAULT_APPEARANCE_AUTO_PAIR } from './resolve-appearance';
import type { AppearanceAutoPairV1, AppearancePreferencesV1 } from './types';

export function rememberedAutoPair(
  preferences: AppearancePreferencesV1
): AppearanceAutoPairV1 {
  if (preferences.selection.mode === 'auto') {
    return {
      lightThemeId: preferences.selection.lightThemeId,
      darkThemeId: preferences.selection.darkThemeId,
    };
  }
  return {
    ...(preferences.autoPair ?? DEFAULT_APPEARANCE_AUTO_PAIR),
  };
}

export function selectManualTheme(
  preferences: AppearancePreferencesV1,
  themeId: string
): AppearancePreferencesV1 {
  return {
    ...preferences,
    selection: { mode: 'manual', themeId },
    autoPair: rememberedAutoPair(preferences),
  };
}

export function selectAutoThemes(
  preferences: AppearancePreferencesV1,
  pair: AppearanceAutoPairV1 = rememberedAutoPair(preferences)
): AppearancePreferencesV1 {
  const autoPair = { ...pair };
  return {
    ...preferences,
    selection: { mode: 'auto', ...autoPair },
    autoPair,
  };
}
