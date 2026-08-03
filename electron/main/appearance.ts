import {
  THEME_BOOTSTRAP_REGISTRY,
  type ThemeBootstrapId,
} from './generated-theme-bootstrap';
import {
  CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES,
  DEFAULT_ELECTRON_APPEARANCE_PREFERENCES,
  type ElectronAppearancePreferencesV1,
} from './settings-store';

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

export interface ElectronAppearanceBootstrapSnapshot {
  preferences: ElectronAppearancePreferencesV1;
  safeTheme: boolean;
}

export interface NativeAppearanceWindow {
  isDestroyed(): boolean;
  setBackgroundColor(color: string): void;
}

export function rendererAppearanceBootstrapSnapshot(
  appearance: ElectronAppearancePreferencesV1 | undefined,
  safeTheme: boolean
): ElectronAppearanceBootstrapSnapshot {
  return {
    preferences: structuredClone(
      safeTheme
        ? CLASSIC_RECOVERY_ELECTRON_APPEARANCE_PREFERENCES
        : (appearance ?? DEFAULT_ELECTRON_APPEARANCE_PREFERENCES)
    ),
    safeTheme,
  };
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
  if (options.safeTheme) {
    return {
      themeId: CLASSIC_BOOTSTRAP_THEME_ID,
      themeSource: 'dark',
      bootstrap: classic,
    };
  }

  const preferences = appearance ?? DEFAULT_ELECTRON_APPEARANCE_PREFERENCES;

  if (preferences.selection.mode === 'manual') {
    const selected = productionTheme(preferences.selection.themeId);
    return selected
      ? {
          themeId: preferences.selection.themeId,
          themeSource: selected.appearance,
          bootstrap: selected,
        }
      : {
          themeId: CLASSIC_BOOTSTRAP_THEME_ID,
          themeSource: 'dark',
          bootstrap: classic,
        };
  }

  const light = productionTheme(preferences.selection.lightThemeId);
  const dark = productionTheme(preferences.selection.darkThemeId);
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
    ? preferences.selection.darkThemeId
    : preferences.selection.lightThemeId;
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
  const preferences = appearance ?? DEFAULT_ELECTRON_APPEARANCE_PREFERENCES;
  if (!options.safeTheme && preferences.selection.mode === 'auto') {
    native.themeSource = 'system';
  }
  const resolved = resolveNativeAppearance(preferences, {
    dark: options.systemDarkOverride ?? native.shouldUseDarkColors,
    safeTheme: options.safeTheme,
  });
  native.themeSource = resolved.themeSource;
  return resolved;
}

/**
 * An OS appearance update arrives after Electron has already recomputed
 * `shouldUseDarkColors`. Re-resolve the generated bootstrap subset without
 * reassigning `themeSource` inside its own update event, then keep every native
 * window background aligned with the renderer's new Auto selection.
 */
export function refreshNativeWindowBackgrounds(
  appearance: ElectronAppearancePreferencesV1 | undefined,
  native: Pick<NativeThemeAdapter, 'shouldUseDarkColors'>,
  windows: readonly NativeAppearanceWindow[],
  options: { safeTheme: boolean }
): NativeAppearanceResolution {
  const resolved = resolveNativeAppearance(appearance, {
    dark: native.shouldUseDarkColors,
    safeTheme: options.safeTheme,
  });
  for (const window of windows) {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(resolved.bootstrap.background);
    }
  }
  return resolved;
}
