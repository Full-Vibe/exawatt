import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP_REGISTRY } from '../../../electron/main/generated-theme-bootstrap';
import {
  GALLERY_THEME_IDS,
  PRODUCTION_THEME_IDS,
  THEME_DEFINITIONS,
  THEME_REGISTRY,
} from '@/generated/theme-registry';
import {
  AppearancePreferencesSchema,
  ThemeDefinitionSchema,
  validateThemeContrast,
} from '../../../themes/contract.mjs';
import {
  CLASSIC_THEME_ID,
  contrastRatio,
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
  type AppearanceOsSignals,
  type ThemeDefinitionV1,
} from '.';

const LIGHT_OS: AppearanceOsSignals = {
  dark: false,
  highContrast: false,
  forcedColors: false,
  invertedColors: false,
  reducedTransparency: false,
};

describe('ThemeDefinitionV1', () => {
  it('validates all three generated built-ins and their contrast pairs', () => {
    expect(THEME_DEFINITIONS).toHaveLength(3);
    for (const theme of THEME_DEFINITIONS) {
      expect(ThemeDefinitionSchema.parse(theme)).toEqual(theme);
      expect(validateThemeContrast(theme)).toEqual([]);
    }
    expect(PRODUCTION_THEME_IDS).toEqual([CLASSIC_THEME_ID]);
    expect(GALLERY_THEME_IDS).toEqual([
      'exawatt-air-light',
      'exawatt-night-dark',
    ]);
  });

  it('rejects unsafe values and unknown theme properties with a role path', () => {
    const unsafe = structuredClone(
      THEME_REGISTRY[CLASSIC_THEME_ID]
    ) as unknown as ThemeDefinitionV1;
    const candidate = unsafe as unknown as Record<string, unknown>;
    candidate.remoteStylesheet = 'https://example.com/theme.css';
    unsafe.foundation.action = 'url(javascript:alert(1))';

    const result = ThemeDefinitionSchema.safeParse(unsafe);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path.join('.'))).toEqual(
        expect.arrayContaining(['foundation.action'])
      );
      expect(
        result.error.issues.some(issue => issue.code === 'unrecognized_keys')
      ).toBe(true);
    }
  });

  it('keeps Classic aligned with the shipped baseline authorities', () => {
    const classic = THEME_REGISTRY[CLASSIC_THEME_ID];
    expect(classic.foundation).toMatchObject({
      canvas: '#0A0A0A',
      text: '#FAFAFA',
      action: '#19E6FF',
      border: '#262626',
    });
    expect(classic.hud).toMatchObject({
      void: '#04060B',
      deep: '#070B14',
      panel: '#0B1220',
      cyan: '#19E6FF',
      text: '#DCEBFF',
      textDim: '#8AA0BE',
    });
    expect(classic.terminal).toMatchObject({
      background: '#04060B',
      foreground: '#F4F4F4',
      cursor: '#19E6FF',
      red: '#FF1F4B',
      green: '#6FE39F',
      yellow: '#FFB02E',
    });
  });

  it('generates complete CSS and Electron bootstrap subsets', () => {
    const css = readFileSync(
      path.join(process.cwd(), 'src/generated/themes.css'),
      'utf8'
    );
    for (const theme of THEME_DEFINITIONS) {
      expect(css).toContain(`[data-exa-theme='${theme.id}']`);
      expect(css).toContain(
        `--exa-foundation-canvas: ${theme.foundation.canvas}`
      );
      expect(css).toContain(
        `--exa-terminal-foreground: ${theme.terminal.foreground}`
      );
      expect(css).toContain(
        `--exa-spatial-emissive-active: ${theme.spatial.emissiveActive}`
      );
      expect(THEME_BOOTSTRAP_REGISTRY[theme.id]).toMatchObject({
        appearance: theme.appearance,
        background: theme.bootstrap.background,
        foreground: theme.bootstrap.foreground,
        signal: theme.bootstrap.signal,
      });
    }
  });
});

describe('AppearancePreferencesV1 and resolver', () => {
  it('accepts only the bounded preference values', () => {
    expect(
      AppearancePreferencesSchema.parse(DEFAULT_APPEARANCE_PREFERENCES)
    ).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
    expect(
      AppearancePreferencesSchema.safeParse({
        ...DEFAULT_APPEARANCE_PREFERENCES,
        interfaceScale: 137,
      }).success
    ).toBe(false);
  });

  it('falls back to Classic for an invalid Auto light/dark pairing', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        selection: {
          mode: 'auto',
          lightThemeId: 'exawatt-night-dark',
          darkThemeId: 'exawatt-air-light',
        },
      },
      LIGHT_OS
    );
    expect(resolved.themeId).toBe(CLASSIC_THEME_ID);
  });

  it('switches a valid Auto pair with the OS while Manual stays pinned', () => {
    const automatic = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      selection: {
        mode: 'auto' as const,
        lightThemeId: 'exawatt-air-light',
        darkThemeId: 'exawatt-night-dark',
      },
    };
    expect(resolveAppearance(THEME_REGISTRY, automatic, LIGHT_OS).themeId).toBe(
      'exawatt-air-light'
    );
    expect(
      resolveAppearance(THEME_REGISTRY, automatic, { ...LIGHT_OS, dark: true })
        .themeId
    ).toBe('exawatt-night-dark');
    expect(
      resolveAppearance(
        THEME_REGISTRY,
        {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          selection: { mode: 'manual', themeId: 'exawatt-air-light' },
        },
        { ...LIGHT_OS, dark: true }
      ).themeId
    ).toBe('exawatt-air-light');
  });

  it('resolves preview and accessibility overlays without mutating preferences', () => {
    const preferences = structuredClone(DEFAULT_APPEARANCE_PREFERENCES);
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      { ...preferences, transparency: 'reduced' },
      { ...LIGHT_OS, highContrast: true },
      { themeId: 'exawatt-air-light' }
    );

    expect(resolved.themeId).toBe('exawatt-air-light');
    expect(resolved.preview).toBe(true);
    expect(resolved.enhancedContrast).toBe(true);
    expect(resolved.reducedTransparency).toBe(true);
    expect(resolved.theme.foundation.textMuted).toBe(
      resolved.theme.foundation.text
    );
    expect(resolved.theme.material.chrome).toMatchObject({
      opacity: 1,
      blur: 0,
    });
    expect(preferences).toEqual(DEFAULT_APPEARANCE_PREFERENCES);
  });

  it('contrast-corrects an unreadable system accent', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      { ...DEFAULT_APPEARANCE_PREFERENCES, accentSource: 'system' },
      { ...LIGHT_OS, dark: true, systemAccent: '#101010' }
    );
    expect(
      contrastRatio(
        resolved.theme.foundation.action,
        resolved.theme.foundation.actionText
      )
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('forces Classic during a safe-theme launch, including over preview', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      { ...LIGHT_OS, safeTheme: true },
      { themeId: 'exawatt-air-light' }
    );
    expect(resolved.themeId).toBe(CLASSIC_THEME_ID);
    expect(resolved.preview).toBe(false);
  });

  it('treats inverted colors as an unconditional contrast request', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      { ...LIGHT_OS, invertedColors: true }
    );
    expect(resolved.enhancedContrast).toBe(true);
  });
});
