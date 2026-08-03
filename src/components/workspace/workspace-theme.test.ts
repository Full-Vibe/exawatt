import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_FOUNDATION,
  WORKSPACE_HUD,
  withThemeAlpha,
} from './workspace-theme';

function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(leaves);
}

describe('workspace DOM appearance adapter', () => {
  it('maps every presentation leaf to a generated semantic variable', () => {
    for (const value of leaves({ WORKSPACE_HUD, WORKSPACE_FOUNDATION })) {
      expect(value).toMatch(/^var\(--exa-/);
    }
  });

  it('composes alpha without parsing concrete Project or generated colors', () => {
    expect(withThemeAlpha(WORKSPACE_HUD.cyan, 0.28)).toBe(
      `color-mix(in srgb, ${WORKSPACE_HUD.cyan} 28%, transparent)`
    );
    expect(withThemeAlpha('#19E6FF', 2)).toBe(
      'color-mix(in srgb, #19E6FF 100%, transparent)'
    );
  });
});
