import { THEME_REGISTRY } from '@/generated/theme-registry';
import type { ResolvedAppearance, ThemeRegistry } from './types';

const set = (root: HTMLElement, name: string, value: string | number) => {
  const next = String(value);
  if (root.style.getPropertyValue(name) !== next) {
    root.style.setProperty(name, next);
  }
};

const setData = (root: HTMLElement, name: string, value: string) => {
  if (root.dataset[name] !== value) root.dataset[name] = value;
};

/**
 * Runtime-only values layered over the generated preset block. Keeping this
 * projection pure lets gallery specimens and the production root consume the
 * exact same resolved accessibility/material snapshot.
 */
export function resolvedAppearanceCssVariables(
  resolved: ResolvedAppearance
): Readonly<Record<string, string | number>> {
  const { foundation, hud, material } = resolved.theme;
  const variables: Record<string, string | number> = {
    '--exa-interface-scale': resolved.interfaceScale / 100,
    '--exa-foundation-action': foundation.action,
    '--exa-foundation-text-muted': foundation.textMuted,
    '--exa-foundation-text-faint': foundation.textFaint,
    '--exa-foundation-border': foundation.border,
    '--exa-hud-text-dim': hud.textDim,
    '--exa-hud-stroke-soft': hud.strokeSoft,
    '--exa-hud-stroke-faint': hud.strokeFaint,
  };
  for (const [role, recipe] of Object.entries(material)) {
    variables[`--exa-material-${role}-tint`] = recipe.tint;
    variables[`--exa-material-${role}-opacity`] = recipe.opacity;
    variables[`--exa-material-${role}-blur`] = `${recipe.blur}px`;
    variables[`--exa-material-${role}-saturation`] = recipe.saturation;
    variables[`--exa-material-${role}-fallback`] = recipe.fallback;
  }
  return Object.freeze(variables);
}

export function applyResolvedAppearance(
  root: HTMLElement,
  resolved: ResolvedAppearance
): void {
  setData(root, 'exaTheme', resolved.themeId);
  setData(root, 'exaAppearance', resolved.appearance);
  setData(
    root,
    'exaContrast',
    resolved.enhancedContrast ? 'enhanced' : 'standard'
  );
  setData(
    root,
    'exaTransparency',
    resolved.reducedTransparency ? 'reduced' : 'standard'
  );
  setData(root, 'exaFont', resolved.interfaceFont);
  setData(root, 'exaTypography', resolved.theme.typography.profile);
  root.classList.toggle('dark', resolved.appearance === 'dark');
  root.classList.toggle('light', resolved.appearance === 'light');
  const variables = resolvedAppearanceCssVariables(resolved);
  const authoredTheme = (THEME_REGISTRY as ThemeRegistry)[resolved.themeId];
  const authoredVariables = authoredTheme
    ? resolvedAppearanceCssVariables({
        ...resolved,
        theme: authoredTheme,
      })
    : undefined;
  for (const [name, value] of Object.entries(variables)) {
    if (
      name !== '--exa-interface-scale' &&
      authoredVariables?.[name] === value
    ) {
      if (root.style.getPropertyValue(name)) root.style.removeProperty(name);
      continue;
    }
    set(root, name, value);
  }
}
