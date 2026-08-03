import {
  PRODUCTION_THEME_IDS,
  THEME_REGISTRY,
} from '@/generated/theme-registry';
import { APPEARANCE_MIRROR_STORAGE_KEY } from './preference-source';
import { DEFAULT_APPEARANCE_PREFERENCES } from './resolve-appearance';

const bootstrapThemes = Object.fromEntries(
  PRODUCTION_THEME_IDS.map(themeId => [
    themeId,
    {
      appearance: THEME_REGISTRY[themeId].appearance,
      typography: THEME_REGISTRY[themeId].typography.profile,
    },
  ])
);

/**
 * Tiny, dependency-free first-paint resolver. Electron settings remain the
 * authority; the renderer mirrors the last validated value solely so this can
 * run before React hydrates and avoid a mismatched-theme flash.
 */
export const APPEARANCE_BOOTSTRAP_SCRIPT = `(() => {
  const key = ${JSON.stringify(APPEARANCE_MIRROR_STORAGE_KEY)};
  const themes = ${JSON.stringify(bootstrapThemes)};
  const fallback = ${JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES)};
  const exactKeys = (value, keys) => value && typeof value === 'object' && Object.keys(value).sort().join('|') === keys.slice().sort().join('|');
  const valid = value => {
    if (!exactKeys(value, ['schemaVersion', 'selection', 'accentSource', 'interfaceFont', 'interfaceScale', 'contrast', 'transparency']) || value.schemaVersion !== 1 || !value.selection) return false;
    const s = value.selection;
    const selectionIsValid = s.mode === 'manual'
      ? exactKeys(s, ['mode', 'themeId']) && Boolean(themes[s.themeId])
      : s.mode === 'auto' && exactKeys(s, ['mode', 'lightThemeId', 'darkThemeId']) && themes[s.lightThemeId]?.appearance === 'light' && themes[s.darkThemeId]?.appearance === 'dark';
    return selectionIsValid && ['theme', 'system'].includes(value.accentSource) && ['theme', 'system', 'geist'].includes(value.interfaceFont) && [90, 100, 110, 120].includes(value.interfaceScale) && ['system', 'enhanced'].includes(value.contrast) && ['system', 'reduced'].includes(value.transparency);
  };
  let preferences = fallback;
  try {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (valid(stored)) preferences = stored;
    else if (stored) localStorage.removeItem(key);
  } catch { try { localStorage.removeItem(key); } catch {} }
  const selection = preferences.selection;
  const matches = query => typeof matchMedia === 'function' && matchMedia(query).matches;
  const dark = matches('(prefers-color-scheme: dark)');
  const id = selection.mode === 'manual' ? selection.themeId : (dark ? selection.darkThemeId : selection.lightThemeId);
  const theme = themes[id] || themes['exawatt-classic-dark'];
  const root = document.documentElement;
  root.dataset.exaTheme = themes[id] ? id : 'exawatt-classic-dark';
  root.dataset.exaAppearance = theme.appearance;
  root.dataset.exaContrast = preferences.contrast === 'enhanced' || matches('(prefers-contrast: more)') || matches('(forced-colors: active)') || matches('(inverted-colors: inverted)') ? 'enhanced' : 'standard';
  root.dataset.exaTransparency = preferences.transparency === 'reduced' || matches('(prefers-reduced-transparency: reduce)') ? 'reduced' : 'standard';
  root.dataset.exaFont = preferences.interfaceFont;
  root.dataset.exaTypography = theme.typography;
  root.style.setProperty('--exa-interface-scale', String(preferences.interfaceScale / 100));
  root.classList.toggle('dark', theme.appearance === 'dark');
  root.classList.toggle('light', theme.appearance === 'light');
})();`;
