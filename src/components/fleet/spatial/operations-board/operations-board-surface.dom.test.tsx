// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ExawattAgent, FleetMetrics, FleetState } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';

vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({ resolved: resolveClassicDark() }),
}));

vi.mock('@/components/hud/webgl/use-agent-field-glide', () => ({
  useAgentFieldGlide: () => undefined,
}));

vi.mock('./operations-board-canvas', () => ({
  OperationsBoardCanvas: () => <div data-mocked-board-canvas />,
}));

import { OperationsBoardSurface } from './operations-board-surface';

function resolveClassicDark() {
  const theme = THEME_REGISTRY['exawatt-classic-dark'];
  return resolveAppearance(
    THEME_REGISTRY,
    {
      schemaVersion: 1,
      selection: { mode: 'manual', themeId: 'exawatt-classic-dark' },
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

function agent(id: string): ExawattAgent {
  return {
    id,
    name: `Agent ${id}`,
    project: 'Keymap fixture',
    status: 'working',
    goal: 'Exercise the keyboard surface',
    sessionKey: id,
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
  };
}

const metrics: FleetMetrics = {
  activeCount: 3,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

function fleetOf(agents: ExawattAgent[]): FleetState {
  return {
    agents: Object.fromEntries(agents.map(entry => [entry.id, entry])),
    metrics,
    lastUpdated: 1,
  };
}

const populated = fleetOf([agent('a1'), agent('a2'), agent('a3')]);

function renderSurface(
  layout = selectSpatialBoardLayout(populated),
  onDrillProject = vi.fn()
) {
  const view = render(
    <OperationsBoardSurface
      layout={layout}
      projection="top-down"
      onDrillProject={onDrillProject}
      onSelectAgent={() => undefined}
      onOverview={() => undefined}
      onProjectionChange={() => undefined}
      resolvedAppearance={resolveClassicDark()}
    />
  );
  return { view, onDrillProject };
}

describe('board hotkey guard', () => {
  it('drills the first Project on 1 from the board itself', () => {
    const layout = selectSpatialBoardLayout(populated);
    const firstVisible = layout.zones.filter(zone => zone.visible)[0]!;
    const { onDrillProject } = renderSurface(layout);
    fireEvent.keyDown(document.body, { key: '1' });
    expect(onDrillProject).toHaveBeenCalledWith(firstVisible.id);
  });

  it('leaves keys to a focused select instead of drilling past it', () => {
    // The agent navigator is a native select; digits there are type-ahead,
    // exactly as they are in the search input. The guard used to skip inputs
    // and textareas but let selects through.
    const { view, onDrillProject } = renderSurface();
    const navigator = view.container.querySelector<HTMLSelectElement>(
      '[data-board-agent-navigator]'
    )!;
    navigator.focus();
    fireEvent.keyDown(navigator, { key: '1' });
    fireEvent.keyDown(navigator, { key: 'v' });
    expect(onDrillProject).not.toHaveBeenCalled();
  });
});

describe('board empty states', () => {
  it('greets an empty fleet without blaming filters', () => {
    const { view } = renderSurface(selectSpatialBoardLayout(fleetOf([])));
    expect(view.getByText('No Agents on the board yet')).toBeInTheDocument();
    expect(
      view.getByText('Agents take their places here as you launch them.')
    ).toBeInTheDocument();
  });

  it('points at filters only when filters hid the fleet', () => {
    const filteredOut = selectSpatialBoardLayout(populated, {
      visibleAgentIds: new Set<string>(),
    });
    const { view } = renderSurface(filteredOut);
    expect(view.getByText('No Agents match this view')).toBeInTheDocument();
  });
});
