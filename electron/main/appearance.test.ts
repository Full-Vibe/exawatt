import { describe, expect, it } from 'vitest';
import {
  applyNativeAppearancePreference,
  resolveNativeAppearance,
} from './appearance';
import type { ElectronAppearancePreferencesV1 } from './settings-store';

const CLASSIC: ElectronAppearancePreferencesV1 = {
  schemaVersion: 1,
  selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
  accentSource: 'theme',
  interfaceFont: 'theme',
  interfaceScale: 100,
  contrast: 'system',
  transparency: 'system',
};

describe('resolveNativeAppearance', () => {
  it('resolves an explicit Classic preference and its native source', () => {
    expect(
      resolveNativeAppearance(CLASSIC, { dark: false, safeTheme: false })
    ).toMatchObject({
      themeId: 'exawatt-classic-dark',
      themeSource: 'dark',
      bootstrap: { background: '#04060B', colorScheme: 'dark' },
    });
  });

  it('resolves the promoted Auto pair from the OS appearance', () => {
    const automatic: ElectronAppearancePreferencesV1 = {
      ...CLASSIC,
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
    };
    expect(
      resolveNativeAppearance(automatic, { dark: false, safeTheme: false })
        .themeId
    ).toBe('exawatt-air-light');
    expect(
      resolveNativeAppearance(automatic, { dark: true, safeTheme: false })
        .themeId
    ).toBe('exawatt-night-dark');
  });

  it('uses Auto Air/Night only when the preference is genuinely missing', () => {
    expect(
      resolveNativeAppearance(undefined, { dark: false, safeTheme: false })
    ).toMatchObject({
      themeId: 'exawatt-air-light',
      themeSource: 'system',
    });
    expect(
      resolveNativeAppearance(undefined, { dark: true, safeTheme: false })
    ).toMatchObject({
      themeId: 'exawatt-night-dark',
      themeSource: 'system',
    });
  });

  it('forces Classic for one safe-theme launch without changing settings', () => {
    const resolution = resolveNativeAppearance(CLASSIC, {
      dark: false,
      safeTheme: true,
    });
    expect(resolution.themeId).toBe('exawatt-classic-dark');
    expect(CLASSIC.selection).toEqual({
      mode: 'manual',
      themeId: 'exawatt-classic-dark',
    });
  });

  it('returns to system source before resolving Auto after Manual', () => {
    const automatic: ElectronAppearancePreferencesV1 = {
      ...CLASSIC,
      selection: {
        mode: 'auto',
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
    };
    let source: 'system' | 'light' | 'dark' = 'dark';
    const sourcesAtRead: Array<'system' | 'light' | 'dark'> = [];
    const native = {
      get themeSource() {
        return source;
      },
      set themeSource(value: 'system' | 'light' | 'dark') {
        source = value;
      },
      get shouldUseDarkColors() {
        sourcesAtRead.push(source);
        return source !== 'system';
      },
    };
    applyNativeAppearancePreference(automatic, native, { safeTheme: false });
    expect(sourcesAtRead).toEqual(['system']);
    expect(source).toBe('system');
  });
});
