import type { ResolvedAppearance } from './types';

const set = (root: HTMLElement, name: string, value: string | number) =>
  root.style.setProperty(name, String(value));

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
  root.classList.toggle('dark', resolved.appearance === 'dark');
  root.classList.toggle('light', resolved.appearance === 'light');
  set(root, '--exa-interface-scale', resolved.interfaceScale / 100);

  const { foundation, hud, material } = resolved.theme;
  set(root, '--exa-foundation-action', foundation.action);
  set(root, '--exa-foundation-text-muted', foundation.textMuted);
  set(root, '--exa-foundation-text-faint', foundation.textFaint);
  set(root, '--exa-foundation-border', foundation.border);
  set(root, '--exa-hud-text-dim', hud.textDim);
  set(root, '--exa-hud-stroke-soft', hud.strokeSoft);
  set(root, '--exa-hud-stroke-faint', hud.strokeFaint);
  for (const [role, recipe] of Object.entries(material)) {
    set(root, `--exa-material-${role}-tint`, recipe.tint);
    set(root, `--exa-material-${role}-opacity`, recipe.opacity);
    set(root, `--exa-material-${role}-blur`, `${recipe.blur}px`);
    set(root, `--exa-material-${role}-saturation`, recipe.saturation);
    set(root, `--exa-material-${role}-fallback`, recipe.fallback);
  }
}
