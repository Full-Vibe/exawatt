'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
} from '@/lib/appearance/resolve-appearance';
import { applyResolvedAppearance } from '@/lib/appearance/dom-adapter';
import {
  createAppearancePreferenceSource,
  readAppearanceMirror,
  readElectronAppearanceBootstrap,
  writeAppearanceMirror,
} from '@/lib/appearance/preference-source';
import {
  parseProductionAppearancePreferences,
  PRODUCTION_THEME_REGISTRY,
} from '@/lib/appearance/preferences';
import type {
  AppearanceOsSignals,
  AppearancePreferencesV1,
  ResolvedAppearance,
} from '@/lib/appearance/types';

const DEFAULT_OS_SIGNALS: AppearanceOsSignals = {
  dark: false,
  highContrast: false,
  forcedColors: false,
  invertedColors: false,
  reducedTransparency: false,
};

interface AppearanceContextValue {
  preferences: AppearancePreferencesV1;
  resolved: ResolvedAppearance;
  ready: boolean;
  previewTheme: (themeId?: string) => void;
  cancelPreview: () => void;
  commitPreferences: (preferences: AppearancePreferencesV1) => Promise<void>;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

interface NativeAppearanceSnapshot {
  dark: boolean;
  highContrast: boolean;
  invertedColors: boolean;
  systemAccent: string | null;
  safeTheme: boolean;
}

export function useAppearance(): AppearanceContextValue {
  const value = useContext(AppearanceContext);
  if (!value) {
    throw new Error('useAppearance must be used within AppearanceProvider');
  }
  return value;
}

function mediaMatches(query: string): boolean {
  return (
    typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  );
}

function webSignals(authoritativeDark?: boolean): AppearanceOsSignals {
  return {
    dark: authoritativeDark ?? mediaMatches('(prefers-color-scheme: dark)'),
    highContrast: mediaMatches('(prefers-contrast: more)'),
    forcedColors: mediaMatches('(forced-colors: active)'),
    invertedColors: mediaMatches('(inverted-colors: inverted)'),
    reducedTransparency: mediaMatches('(prefers-reduced-transparency: reduce)'),
  };
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const source = useMemo(() => createAppearancePreferenceSource(), []);
  const bootstrap = useMemo(() => readElectronAppearanceBootstrap(), []);
  const [preferences, setPreferences] = useState<AppearancePreferencesV1>(
    DEFAULT_APPEARANCE_PREFERENCES
  );
  const [os, setOs] = useState<AppearanceOsSignals>(DEFAULT_OS_SIGNALS);
  const [previewThemeId, setPreviewThemeId] = useState<string>();
  const [bootstrapAdopted, setBootstrapAdopted] = useState(false);
  const [ready, setReady] = useState(false);

  // Keep the server and the first hydration render deterministic. The inline
  // bootstrap has already painted the authoritative root attributes; adopting
  // that same snapshot in a layout effect updates React-owned descendants
  // before the next paint without producing hydration attribute mismatches.
  useLayoutEffect(() => {
    const browser = webSignals(bootstrap?.dark);
    setPreferences(
      bootstrap?.preferences ??
        readAppearanceMirror() ??
        DEFAULT_APPEARANCE_PREFERENCES
    );
    setOs({
      ...browser,
      dark: bootstrap?.dark ?? browser.dark,
      safeTheme: bootstrap?.safeTheme ?? false,
    });
    setBootstrapAdopted(true);
  }, [bootstrap]);

  useEffect(() => {
    let active = true;
    const accept = (next: AppearancePreferencesV1) => {
      if (!active) return;
      setPreferences(next);
      // Safe mode is a non-destructive launch override. Never rewrite either
      // persistence layer merely because recovery Classic is being rendered.
      if (!bootstrap?.safeTheme) writeAppearanceMirror(next);
      setReady(true);
    };
    void source.load().then(accept, () => {
      if (active) setReady(true);
    });
    const unsubscribe = source.subscribe(accept);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [bootstrap?.safeTheme, source]);

  useEffect(() => {
    let active = true;
    const applyNative = (native?: NativeAppearanceSnapshot) => {
      if (!active) return;
      // Electron owns color-scheme state. A native event can advance it; a
      // renderer-only media event must preserve the last native value.
      const browser = webSignals(
        source.kind === 'electron' ? false : undefined
      );
      setOs(current => ({
        ...browser,
        dark:
          native?.dark ??
          (source.kind === 'electron' ? current.dark : browser.dark),
        highContrast: native?.highContrast ?? browser.highContrast,
        invertedColors: native?.invertedColors ?? browser.invertedColors,
        systemAccent: native?.systemAccent ?? undefined,
        safeTheme: native?.safeTheme ?? bootstrap?.safeTheme ?? false,
      }));
    };
    const queries = [
      ...(source.kind === 'web' ? ['(prefers-color-scheme: dark)'] : []),
      '(prefers-contrast: more)',
      '(forced-colors: active)',
      '(inverted-colors: inverted)',
      '(prefers-reduced-transparency: reduce)',
    ]
      .map(query => window.matchMedia?.(query))
      .filter(Boolean) as MediaQueryList[];
    const onMediaChange = () => applyNative();
    for (const query of queries)
      query.addEventListener?.('change', onMediaChange);
    const appearance = window.electron?.app?.appearance;
    if (appearance) void appearance().then(applyNative, () => applyNative());
    else applyNative();
    const unsubscribeNative =
      window.electron?.app?.onAppearanceChanged?.(applyNative);
    return () => {
      active = false;
      for (const query of queries)
        query.removeEventListener?.('change', onMediaChange);
      unsubscribeNative?.();
    };
  }, [bootstrap?.dark, bootstrap?.safeTheme, source.kind]);

  const resolved = useMemo(
    () =>
      resolveAppearance(
        PRODUCTION_THEME_REGISTRY,
        preferences,
        os,
        previewThemeId ? { themeId: previewThemeId } : undefined
      ),
    [os, preferences, previewThemeId]
  );

  useLayoutEffect(() => {
    // The inline bootstrap already owns the first paint. Do not let React's
    // deterministic light/server default overwrite that authoritative DOM
    // snapshot while the saved preference and OS signals are being adopted.
    if (!bootstrapAdopted) return;
    applyResolvedAppearance(document.documentElement, resolved);
  }, [bootstrapAdopted, resolved]);

  const previewTheme = useCallback((themeId?: string) => {
    setPreviewThemeId(
      themeId && PRODUCTION_THEME_REGISTRY[themeId] ? themeId : undefined
    );
  }, []);
  const cancelPreview = useCallback(() => setPreviewThemeId(undefined), []);
  const commitPreferences = useCallback(
    async (next: AppearancePreferencesV1) => {
      const parsed = parseProductionAppearancePreferences(next);
      if (!parsed) throw new Error('Cannot commit an unavailable appearance');
      const saved = await source.save(parsed);
      setPreferences(saved);
      writeAppearanceMirror(saved);
      setPreviewThemeId(undefined);
    },
    [source]
  );

  const value = useMemo(
    () => ({
      preferences,
      resolved,
      ready,
      previewTheme,
      cancelPreview,
      commitPreferences,
    }),
    [
      cancelPreview,
      commitPreferences,
      preferences,
      previewTheme,
      ready,
      resolved,
    ]
  );

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}
