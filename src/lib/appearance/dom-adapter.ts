import type { ResolvedAppearance } from './types';

const set = (root: HTMLElement, name: string, value: string | number) =>
  root.style.setProperty(name, String(value));

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
  root.dataset.exaTheme = resolved.themeId;
  root.dataset.exaAppearance = resolved.appearance;
  root.dataset.exaContrast = resolved.enhancedContrast
    ? 'enhanced'
    : 'standard';
  root.dataset.exaTransparency = resolved.reducedTransparency
    ? 'reduced'
    : 'standard';
  root.dataset.exaFont = resolved.interfaceFont;
  root.dataset.exaTypography = resolved.theme.typography.profile;
  root.classList.toggle('dark', resolved.appearance === 'dark');
  root.classList.toggle('light', resolved.appearance === 'light');
  for (const [name, value] of Object.entries(
    resolvedAppearanceCssVariables(resolved)
  )) {
    set(root, name, value);
  }
}
