import { describe, expect, it } from 'vitest';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import {
  CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
} from '@/lib/appearance/resolve-appearance';
import {
  XTERM_MINIMUM_CONTRAST_RATIO,
  xtermThemeForAppearance,
  xtermThemeFromTerminalPalette,
} from './terminal-theme';

describe('xterm appearance adapter', () => {
  it('projects every authored xterm role without leaking font metrics', () => {
    const palette = THEME_REGISTRY['exawatt-air-light'].terminal;
    const adapted = xtermThemeFromTerminalPalette(palette);

    expect(adapted).toEqual(palette);
    expect(adapted).not.toBe(palette);
    expect(Object.isFrozen(adapted)).toBe(true);
    expect(adapted).not.toHaveProperty('fontFamily');
    expect(adapted).not.toHaveProperty('fontSize');
    expect(XTERM_MINIMUM_CONTRAST_RATIO).toBe(4.5);
  });

  it('uses the current resolved snapshot for preview and Auto changes', () => {
    const classic = resolveAppearance(
      THEME_REGISTRY,
      CLASSIC_RECOVERY_APPEARANCE_PREFERENCES,
      {
        dark: true,
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );
    const airPreview = resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      {
        dark: true,
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      },
      { themeId: 'exawatt-air-light' }
    );

    expect(xtermThemeForAppearance(classic).background).toBe('#04060B');
    expect(xtermThemeForAppearance(airPreview)).toEqual(
      THEME_REGISTRY['exawatt-air-light'].terminal
    );
  });
});
