import { describe, expect, it } from 'vitest';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
} from './resolve-appearance';
import {
  rememberedAutoPair,
  selectAutoThemes,
  selectManualTheme,
} from './selection';

describe('appearance selection helpers', () => {
  it('preserves the remembered Auto pair while Manual is active', () => {
    const manual = selectManualTheme(
      DEFAULT_APPEARANCE_PREFERENCES,
      'exawatt-classic-dark'
    );

    expect(manual.selection).toEqual({
      mode: 'manual',
      themeId: 'exawatt-classic-dark',
    });
    expect(rememberedAutoPair(manual)).toEqual({
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-night-dark',
    });
    expect(selectAutoThemes(manual).selection).toEqual({
      mode: 'auto',
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-night-dark',
    });
  });

  it('writes an updated Auto pair into both persistence fields', () => {
    const pair = {
      lightThemeId: 'exawatt-air-light',
      darkThemeId: 'exawatt-classic-dark',
    };
    const automatic = selectAutoThemes(
      CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
      pair
    );

    expect(automatic.selection).toEqual({ mode: 'auto', ...pair });
    expect(automatic.autoPair).toEqual(pair);
    expect(automatic.autoPair).not.toBe(pair);
  });
});
