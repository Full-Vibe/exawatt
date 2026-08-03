import {
  THEME_BOOTSTRAP_REGISTRY,
  type ThemeBootstrapId,
} from './generated-theme-bootstrap';
import type { ElectronAppearancePreferencesV1 } from './settings-store';

export const CLASSIC_BOOTSTRAP_THEME_ID: ThemeBootstrapId =
  'exawatt-classic-dark';

export type NativeAppearanceBootstrap = {
  appearance: 'light' | 'dark';
  availability: 'production' | 'gallery';
  background: string;
  foreground: string;
  signal: string;
  colorScheme: 'light' | 'dark';
  muted: string;
  faint: string;
  danger: string;
  material: {
    tint: string;
    opacity: number;
    blur: number;
    saturation: number;
    fallback: string;
  };
};

export interface NativeAppearanceResolution {
  themeId: ThemeBootstrapId;
  themeSource: 'system' | 'light' | 'dark';
  bootstrap: NativeAppearanceBootstrap;
}

export interface NativeThemeAdapter {
  themeSource: 'system' | 'light' | 'dark';
  readonly shouldUseDarkColors: boolean;
}

function productionTheme(
  themeId: ThemeBootstrapId
): NativeAppearanceBootstrap | null {
  const theme: NativeAppearanceBootstrap = THEME_BOOTSTRAP_REGISTRY[themeId];
  return theme.availability === 'production' ? theme : null;
}

export function resolveNativeAppearance(
  appearance: ElectronAppearancePreferencesV1 | undefined,
  options: { dark: boolean; safeTheme: boolean }
): NativeAppearanceResolution {
  const classic = THEME_BOOTSTRAP_REGISTRY[CLASSIC_BOOTSTRAP_THEME_ID];
  if (options.safeTheme || !appearance) {
    return {
      themeId: CLASSIC_BOOTSTRAP_THEME_ID,
      themeSource: 'dark',
      bootstrap: classic,
    };
  }

  if (appearance.selection.mode === 'manual') {
    const selected = productionTheme(appearance.selection.themeId);
    return selected
      ? {
          themeId: appearance.selection.themeId,
          themeSource: selected.appearance,
          bootstrap: selected,
        }
      : {
          themeId: CLASSIC_BOOTSTRAP_THEME_ID,
          themeSource: 'dark',
          bootstrap: classic,
        };
  }

  const light = productionTheme(appearance.selection.lightThemeId);
  const dark = productionTheme(appearance.selection.darkThemeId);
  if (
    !light ||
    !dark ||
    light.appearance !== 'light' ||
    dark.appearance !== 'dark'
  ) {
    return {
      themeId: CLASSIC_BOOTSTRAP_THEME_ID,
      themeSource: 'dark',
      bootstrap: classic,
    };
  }
  const themeId = options.dark
    ? appearance.selection.darkThemeId
    : appearance.selection.lightThemeId;
  return {
    themeId,
    themeSource: 'system',
    bootstrap: THEME_BOOTSTRAP_REGISTRY[themeId],
  };
}

/**
 * Auto must return Electron to the real system source before reading its
 * effective dark state. Otherwise a preceding Manual dark theme would make
 * the first Auto resolution incorrectly inherit that forced value.
 */
export function applyNativeAppearancePreference(
  appearance: ElectronAppearancePreferencesV1 | undefined,
  native: NativeThemeAdapter,
  options: { safeTheme: boolean; systemDarkOverride?: boolean }
): NativeAppearanceResolution {
  if (!options.safeTheme && appearance?.selection.mode === 'auto') {
    native.themeSource = 'system';
  }
  const resolved = resolveNativeAppearance(appearance, {
    dark: options.systemDarkOverride ?? native.shouldUseDarkColors,
    safeTheme: options.safeTheme,
  });
  native.themeSource = resolved.themeSource;
  return resolved;
}
