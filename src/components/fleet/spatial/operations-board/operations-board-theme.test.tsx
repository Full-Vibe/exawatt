import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
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

function surface(appearance: ReturnType<typeof resolveTheme>) {
  return (
    <OperationsBoardSurface
      layout={layout}
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
  it('projects one resolved snapshot into matching DOM and R3F siblings', () => {
    const air = resolveTheme('exawatt-air-light');
    const view = render(surface(air));
    const root = view.container.querySelector<HTMLElement>(
      '[data-spatial-board]'
    )!;
    const canvas = view.container.querySelector('[data-mocked-board-canvas]')!;

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
    expect(
      view.container.querySelector('[aria-label="Board projection"]')
    ).toHaveClass('exa-material-chrome');
    expect(canvas).toHaveAttribute('data-mocked-board-theme', air.themeId);
  });

  it('updates theme paint in place without remounting scene or board truth', () => {
    const air = resolveTheme('exawatt-air-light');
    const night = resolveTheme('exawatt-night-dark');
    const view = render(surface(air));
    const root = view.container.querySelector<HTMLElement>(
      '[data-spatial-board]'
    )!;
    const canvas = view.container.querySelector('[data-mocked-board-canvas]')!;

    view.rerender(surface(night));

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
  });
});
