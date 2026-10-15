import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import type { FleetView, FleetMaterial } from '@exawatt/core/desktop-bridge';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';
import type { BuiltInThemeId } from '@/lib/appearance/types';

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({
    resolved: resolveTheme('exawatt-classic-dark'),
  }),
}));

vi.mock('@/components/hud/webgl/use-agent-field-glide', () => ({
  useAgentFieldGlide: () => undefined,
}));

vi.mock('./operations-board-canvas', () => ({
  OperationsBoardCanvas: ({ theme }: { theme: { themeId: string } }) => (
    <div data-mocked-board-canvas data-mocked-board-theme={theme.themeId} />
  ),
}));

vi.mock('./tiles/operations-board-tiles-canvas', () => ({
  OperationsBoardTilesCanvas: ({
    theme,
    material,
  }: {
    theme: { themeId: string };
    material: string;
  }) => (
    <div
      data-mocked-board-canvas
      data-mocked-board-theme={theme.themeId}
      data-material={material}
    />
  ),
}));

import { OperationsBoardSurface } from './operations-board-surface';

function resolveTheme(themeId: BuiltInThemeId) {
  const theme = THEME_REGISTRY[themeId];
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
    }
  );
}

const statuses: ExawattAgent['status'][] = [
  'idle',
  'working',
  'complete',
  'blocked',
  'error',
];
const agents = statuses.map(
  (status, index): ExawattAgent => ({
    id: `agent-${index}`,
    name: `Agent ${index}`,
    project: 'Theme fixture',
    status,
    goal: `Exercise ${status}`,
    sessionKey: `agent-${index}`,
    metrics: {
      tokensIn: 0,
      tokensOut: 0,
      estimatedCost: 0,
      turnCount: 1,
      startedAt: null,
      duration: 0,
      costRate: 0,
      tokenRate: 0,
      costHistory: [],
    },
    lastActivityAt: 1,
    createdAt: 1,
  })
);
const metrics: FleetMetrics = {
  activeCount: 1,
  blockedCount: 2,
  idleCount: 2,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};
const fleet: FleetState = {
  agents: Object.fromEntries(agents.map(agent => [agent.id, agent])),
  metrics,
  lastUpdated: 1,
};
const layout = selectSpatialBoardLayout(fleet);

function surface(
  appearance: ReturnType<typeof resolveTheme>,
  fleetView: FleetView = 'v1',
  material: FleetMaterial = 'gummy'
) {
  return (
    <OperationsBoardSurface
      layout={layout}
      fleetView={fleetView}
      material={material}
      projection="top-down"
      onDrillProject={() => undefined}
      onSelectAgent={() => undefined}
      onOverview={() => undefined}
      onProjectionChange={() => undefined}
      resolvedAppearance={appearance}
    />
  );
}

describe('Operations Board appearance semantics', () => {
  it.each(['v1', 'v2'] as const)(
    '%s projects one resolved snapshot into matching DOM and R3F siblings',
    async fleetView => {
      const air = resolveTheme('exawatt-air-light');
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(surface(air, fleetView));
      });
      const root = view.container.querySelector<HTMLElement>(
        '[data-spatial-board]'
      )!;
      const canvas = view.container.querySelector(
        '[data-mocked-board-canvas]'
      )!;

      expect(root).toHaveAttribute('data-spatial-theme', air.themeId);
      expect(root).toHaveAttribute('data-spatial-bloom', 'off');
      expect(root).toHaveAttribute('data-exa-theme', air.themeId);
      expect(root.style.getPropertyValue('--exa-material-chrome-opacity')).toBe(
        String(air.theme.material.chrome.opacity)
      );
      expect(root).toHaveAttribute(
        'data-board-status-lights',
        'active,fault,needs-you,off,result'
      );
      expect(root).toHaveStyle({ background: air.theme.spatial.canvas });
      const projections = view.container.querySelector(
        '[aria-label="Board projection"]'
      );
      if (fleetView === 'v1')
        expect(projections).toHaveClass('exa-material-chrome');
      else expect(projections).toBeNull();
      expect(root).toHaveAttribute('data-board-view', fleetView);
      expect(root).toHaveAttribute(
        'data-board-projection',
        fleetView === 'v1' ? 'top-down' : 'fixed-angle'
      );
      if (fleetView === 'v2') {
        fireEvent.keyDown(window, { key: 'v' });
        expect(root).toHaveAttribute('data-board-projection', 'fixed-angle');
      }
      expect(canvas).toHaveAttribute('data-mocked-board-theme', air.themeId);
    }
  );

  it.each(['v1', 'v2'] as const)(
    '%s updates theme and material without remounting scene or board truth',
    async fleetView => {
      const air = resolveTheme('exawatt-air-light');
      const night = resolveTheme('exawatt-night-dark');
      let view!: ReturnType<typeof render>;
      await act(async () => {
        view = render(surface(air, fleetView));
      });
      const root = view.container.querySelector<HTMLElement>(
        '[data-spatial-board]'
      )!;
      const canvas = view.container.querySelector(
        '[data-mocked-board-canvas]'
      )!;

      view.rerender(surface(night, fleetView, 'matte'));
      if (fleetView === 'v2')
        expect(canvas).toHaveAttribute('data-material', 'matte');

      expect(view.container.querySelector('[data-spatial-board]')).toBe(root);
      expect(view.container.querySelector('[data-mocked-board-canvas]')).toBe(
        canvas
      );
      expect(root).toHaveAttribute('data-spatial-theme', night.themeId);
      expect(root).toHaveAttribute('data-spatial-bloom', 'on');
      expect(root).toHaveAttribute('data-exa-theme', night.themeId);
      expect(root.style.getPropertyValue('--exa-material-chrome-opacity')).toBe(
        String(night.theme.material.chrome.opacity)
      );
      expect(canvas).toHaveAttribute('data-mocked-board-theme', night.themeId);
      expect(root).toHaveAttribute(
        'data-board-pieces',
        String(layout.stats.visiblePieceCount)
      );
    }
  );
});
