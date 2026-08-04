// Named as a DOM suite because this adapter's contract is root-element state.
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import {
  applyResolvedAppearance,
  resolvedAppearanceCssVariables,
} from './dom-adapter';
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  resolveAppearance,
} from './resolve-appearance';

afterEach(() => {
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

describe('appearance DOM adapter', () => {
  it('publishes resolved theme, accessibility, typography, and material state', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        interfaceFont: 'system',
        interfaceScale: 110,
        contrast: 'system',
        transparency: 'system',
      },
      {
        dark: false,
        highContrast: true,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: true,
      },
      { themeId: 'exawatt-air-light' }
    );

    applyResolvedAppearance(document.documentElement, resolved);
    const root = document.documentElement;
    expect(root.dataset).toMatchObject({
      exaTheme: 'exawatt-air-light',
      exaAppearance: 'light',
      exaContrast: 'enhanced',
      exaTransparency: 'reduced',
      exaFont: 'system',
      exaTypography: 'air',
    });
    expect(root.style.getPropertyValue('--exa-interface-scale')).toBe('1.1');
    expect(root.style.getPropertyValue('--exa-material-chrome-blur')).toBe(
      '0px'
    );
    expect(root.classList.contains('light')).toBe(true);
    expect(root.classList.contains('dark')).toBe(false);
    expect(resolvedAppearanceCssVariables(resolved)).toMatchObject({
      '--exa-interface-scale': 1.1,
      '--exa-foundation-text-muted': resolved.theme.foundation.text,
      '--exa-material-chrome-opacity': 1,
      '--exa-material-chrome-blur': '0px',
    });
  });

  it('does not invalidate root style for an identical resolved snapshot', async () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      {
        dark: false,
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );
    const root = document.documentElement;
    applyResolvedAppearance(root, resolved);
    const records: MutationRecord[] = [];
    const observer = new MutationObserver(next => records.push(...next));
    observer.observe(root, { attributes: true });

    applyResolvedAppearance(root, resolved);
    await Promise.resolve();
    observer.disconnect();

    expect(records).toEqual([]);
  });

  it('leaves authored preset paint to generated CSS on the standard path', () => {
    const resolved = resolveAppearance(
      THEME_REGISTRY,
      DEFAULT_APPEARANCE_PREFERENCES,
      {
        dark: false,
        highContrast: false,
        forcedColors: false,
        invertedColors: false,
        reducedTransparency: false,
      }
    );

    applyResolvedAppearance(document.documentElement, resolved);

    expect(
      document.documentElement.style.getPropertyValue('--exa-foundation-action')
    ).toBe('');
    expect(
      document.documentElement.style.getPropertyValue(
        '--exa-material-chrome-tint'
      )
    ).toBe('');
    expect(
      document.documentElement.style.getPropertyValue('--exa-interface-scale')
    ).toBe('1');
  });
});
