import { correctAccentContrast } from './color';
import {
  AIR_THEME_ID,
  CLASSIC_THEME_ID,
  NIGHT_THEME_ID,
  type AppearanceAutoPairV1,
  type AppearanceOsSignals,
  type AppearancePreferencesV1,
  type AppearancePreview,
  type ResolvedAppearance,
  type ThemeDefinitionV1,
  type ThemeRegistry,
} from './types';

export const DEFAULT_APPEARANCE_AUTO_PAIR: AppearanceAutoPairV1 = {
  lightThemeId: AIR_THEME_ID,
  darkThemeId: NIGHT_THEME_ID,
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferencesV1 = {
  schemaVersion: 1,
  selection: {
    mode: 'auto',
    ...DEFAULT_APPEARANCE_AUTO_PAIR,
  },
  autoPair: DEFAULT_APPEARANCE_AUTO_PAIR,
  accentSource: 'theme',
  interfaceFont: 'theme',
  interfaceScale: 100,
  contrast: 'system',
  transparency: 'system',
};

export const CLASSIC_RECOVERY_APPEARANCE_PREFERENCES: AppearancePreferencesV1 =
  {
    schemaVersion: 1,
    selection: {
      mode: 'manual',
      themeId: CLASSIC_THEME_ID,
    },
    autoPair: DEFAULT_APPEARANCE_AUTO_PAIR,
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  };

function validTheme(
  registry: ThemeRegistry,
  themeId: string | undefined
): ThemeDefinitionV1 | undefined {
  return themeId ? registry[themeId] : undefined;
}

function selectedTheme(
  registry: ThemeRegistry,
  preferences: AppearancePreferencesV1,
  os: AppearanceOsSignals,
  preview?: AppearancePreview
): { theme: ThemeDefinitionV1; preview: boolean } {
  const classic = registry[CLASSIC_THEME_ID];
  if (!classic) {
    throw new Error(`Theme registry is missing ${CLASSIC_THEME_ID}`);
  }
  if (os.safeTheme) return { theme: classic, preview: false };

  const previewTheme = validTheme(registry, preview?.themeId);
  if (previewTheme) return { theme: previewTheme, preview: true };

  const selection = preferences.selection;
  const selected =
    selection.mode === 'manual'
      ? validTheme(registry, selection.themeId)
      : validTheme(
          registry,
          os.dark ? selection.darkThemeId : selection.lightThemeId
        );

  const pairingIsValid =
    selection.mode === 'manual' ||
    selected?.appearance === (os.dark ? 'dark' : 'light');
  return {
    theme: selected && pairingIsValid ? selected : classic,
    preview: false,
  };
}

function withRuntimeOverlays(
  theme: ThemeDefinitionV1,
  preferences: AppearancePreferencesV1,
  os: AppearanceOsSignals
): ThemeDefinitionV1 {
  const enhancedContrast =
    os.highContrast || os.forcedColors || os.invertedColors;
  const reducedTransparency = os.reducedTransparency;

  const action =
    preferences.accentSource === 'system' && os.systemAccent
      ? correctAccentContrast(
          os.systemAccent,
          theme.foundation.actionText,
          theme.foundation.action
        )
      : theme.foundation.action;

  const material = Object.fromEntries(
    Object.entries(theme.material).map(([role, recipe]) => [
      role,
      reducedTransparency
        ? {
            ...recipe,
            tint: recipe.fallback,
            opacity: 1,
            blur: 0,
            saturation: 1,
          }
        : recipe,
    ])
  ) as unknown as ThemeDefinitionV1['material'];

  return {
    ...theme,
    foundation: {
      ...theme.foundation,
      action,
      textMuted: enhancedContrast
        ? theme.foundation.text
        : theme.foundation.textMuted,
      textFaint: enhancedContrast
        ? theme.foundation.textMuted
        : theme.foundation.textFaint,
      border: enhancedContrast
        ? theme.foundation.borderStrong
        : theme.foundation.border,
    },
    hud: {
      ...theme.hud,
      textDim: enhancedContrast ? theme.hud.text : theme.hud.textDim,
      strokeSoft: enhancedContrast ? theme.hud.stroke : theme.hud.strokeSoft,
      strokeFaint: enhancedContrast
        ? theme.hud.strokeSoft
        : theme.hud.strokeFaint,
    },
    material,
  };
}

export function resolveAppearance(
  registry: ThemeRegistry,
  preferences: AppearancePreferencesV1,
  os: AppearanceOsSignals,
  preview?: AppearancePreview
): ResolvedAppearance {
  const selected = selectedTheme(registry, preferences, os, preview);
  const theme = withRuntimeOverlays(selected.theme, preferences, os);
  return Object.freeze({
    themeId: theme.id,
    appearance: theme.appearance,
    theme,
    interfaceFont: preferences.interfaceFont,
    interfaceScale: preferences.interfaceScale,
    enhancedContrast: os.highContrast || os.forcedColors || os.invertedColors,
    reducedTransparency: os.reducedTransparency,
    preview: selected.preview,
  });
}
