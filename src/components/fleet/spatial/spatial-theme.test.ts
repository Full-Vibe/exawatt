import { describe, expect, it } from 'vitest';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { contrastRatio } from '@/lib/appearance/color';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import type {
  AppearanceOsSignals,
  BuiltInThemeId,
} from '@/lib/appearance/types';
import {
  SPATIAL_PROJECT_IDENTITY_PALETTE,
  spatialFaultCallout,
  spatialNeedsOperatorCallout,
  spatialPressureColor,
  spatialProjectIdentityColor,
  spatialProjectZoneFill,
  spatialStatusColor,
  spatialThemeFromResolvedAppearance,
} from './spatial-theme';

function resolved(
  themeId: BuiltInThemeId,
  osOverrides: Partial<AppearanceOsSignals> = {}
) {
  const theme = THEME_REGISTRY[themeId]!;
  return resolveAppearance(
    THEME_REGISTRY,
    {
      schemaVersion: 1,
      selection: { mode: 'manual', themeId },
      accentSource: 'theme',
      interfaceFont: 'theme',
      interfaceScale: 100,
      contrast: 'system',
      transparency: 'system',
    },
    {
      dark: theme.appearance === 'dark',
      highContrast: false,
      forcedColors: false,
      invertedColors: false,
      reducedTransparency: false,
      ...osOverrides,
    }
  );
}

describe('spatial theme adapter', () => {
  it.each([
    'exawatt-classic-dark',
    'exawatt-air-light',
    'exawatt-night-dark',
  ] as const)('emits concrete renderer values for %s', themeId => {
    const source = resolved(themeId);
    const spatial = spatialThemeFromResolvedAppearance(source);
    const serialized = JSON.stringify(spatial);

    expect(spatial.themeId).toBe(themeId);
    expect(spatial.canvas).toBe(source.theme.spatial.canvas);
    expect(spatial.status).toEqual({
      off: source.theme.status.off,
      active: source.theme.status.active,
      result: source.theme.status.result,
      'needs-you': source.theme.status.needsYou,
      fault: source.theme.status.fault,
    });
    expect(serialized).not.toContain('var(');
    expect(serialized).not.toContain('oklch');
    expect(spatialStatusColor(spatial, 'blocked')).toBe(
      source.theme.status.needsYou
    );
    expect(spatialPressureColor(spatial, 0)).toBe(
      source.theme.consumption.calm
    );
    expect(spatialPressureColor(spatial, 1)).toBe(source.theme.consumption.hot);
  });

  it('keeps Air complete without bloom and dark profiles within the contract', () => {
    expect(
      spatialThemeFromResolvedAppearance(resolved('exawatt-air-light')).bloom
        .enabled
    ).toBe(false);
    for (const themeId of [
      'exawatt-classic-dark',
      'exawatt-night-dark',
    ] as const) {
      const bloom = spatialThemeFromResolvedAppearance(resolved(themeId)).bloom;
      expect(bloom.enabled).toBe(true);
      expect(bloom.threshold).toBeGreaterThanOrEqual(0.6);
      expect(bloom.strength).toBeLessThanOrEqual(1.5);
      expect(bloom.radius).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    'exawatt-classic-dark',
    'exawatt-air-light',
    'exawatt-night-dark',
  ] as const)(
    'gives every D40 and Consumption mark a contrast-safe actual ground in %s',
    themeId => {
      const spatial = spatialThemeFromResolvedAppearance(resolved(themeId));
      for (const [role, color] of Object.entries({
        ...spatial.status,
        ...spatial.consumption,
      })) {
        expect(
          contrastRatio(color, spatial.markBacking),
          `${themeId} ${role} against mark backing`
        ).toBeGreaterThanOrEqual(3);
      }
    }
  );

  it.each([
    'exawatt-classic-dark',
    'exawatt-air-light',
    'exawatt-night-dark',
  ] as const)('uses readable semantic callout pairs in %s', themeId => {
    const spatial = spatialThemeFromResolvedAppearance(resolved(themeId));
    const needsOperator = spatialNeedsOperatorCallout(spatial);
    const fault = spatialFaultCallout(spatial);

    expect(needsOperator.signal).toBe(spatial.status['needs-you']);
    expect(
      contrastRatio(needsOperator.text, needsOperator.background)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(needsOperator.detail, needsOperator.background)
    ).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fault.text, fault.background)).toBeGreaterThanOrEqual(
      4.5
    );
  });

  it('preserves the identity assignment and corrects every edge against its ground', () => {
    expect(SPATIAL_PROJECT_IDENTITY_PALETTE).toHaveLength(6);
    for (const themeId of Object.keys(THEME_REGISTRY) as BuiltInThemeId[]) {
      const spatial = spatialThemeFromResolvedAppearance(resolved(themeId));
      for (let index = 0; index < 18; index += 1) {
        const identity = spatialProjectIdentityColor(
          spatial,
          `project:${index}`
        );
        expect(
          contrastRatio(
            identity,
            spatialProjectZoneFill(spatial, `project:${index}`)
          )
        ).toBeGreaterThanOrEqual(3.2);
      }
    }
  });

  it('projects contrast and transparency overlays without changing scene identity', () => {
    const base = spatialThemeFromResolvedAppearance(
      resolved('exawatt-night-dark')
    );
    const overlaid = spatialThemeFromResolvedAppearance(
      resolved('exawatt-night-dark', {
        highContrast: true,
        reducedTransparency: true,
      })
    );

    expect(overlaid.themeId).toBe(base.themeId);
    expect(overlaid.enhancedContrast).toBe(true);
    expect(overlaid.reducedTransparency).toBe(true);
    expect(overlaid.material.chrome.opacity).toBe(1);
    expect(overlaid.material.chrome.blur).toBe(0);
    expect(overlaid.material.chrome.color).toMatch(/FF$/);
    expect(overlaid.canvas).toBe(base.canvas);
    expect(overlaid.status).toEqual(base.status);
    expect(overlaid.grid).not.toBe(base.grid);
    expect(overlaid.gridMajor).not.toBe(base.gridMajor);
    expect(overlaid.zone).not.toBe(base.zone);
    expect(overlaid.unit).not.toBe(base.unit);
    expect(overlaid.unitMuted).not.toBe(base.unitMuted);
    expect(overlaid.labelMuted).toBe(overlaid.label);
    expect(
      contrastRatio(overlaid.grid, overlaid.canvas)
    ).toBeGreaterThanOrEqual(3);
    expect(
      contrastRatio(overlaid.gridMajor, overlaid.canvas)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(overlaid.unit, overlaid.canvas)
    ).toBeGreaterThanOrEqual(4.5);
  });
});
