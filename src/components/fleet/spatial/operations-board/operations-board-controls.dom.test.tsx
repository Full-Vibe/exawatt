// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExawattAgent, FleetMetrics } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import type { SpatialThemeSnapshot } from '../spatial-theme';

// The anchors are world-positioned DOM: outside a Canvas, the scene graph
// has nothing to position, and its `<group>` is an unknown DOM tag. What the
// anchor renders is the contract here, so both stay out of the way.
vi.mock('@react-three/fiber', () => ({
  useFrame: () => undefined,
  useThree: (
    select: (state: {
      invalidate: () => void;
      camera: { zoom: number };
    }) => unknown
  ) => select({ invalidate: () => undefined, camera: { zoom: 40 } }),
}));
vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { DelegationControls } = await import('./operations-board-controls');

const consoleError = console.error;
vi.spyOn(console, 'error').mockImplementation((message, ...rest) => {
  if (String(message).includes('<group>')) return;
  consoleError(message, ...rest);
});

const metrics: FleetMetrics = {
  activeCount: 0,
  blockedCount: 0,
  idleCount: 0,
  totalCost: 0,
  totalTokens: 0,
  totalCostRate: 0,
  costByProject: {},
};

const lead: ExawattAgent = {
  id: 'lead',
  name: 'lead',
  status: 'working',
  goal: 'Fan out',
  project: 'Alpha',
  sessionKey: 'lead',
  metrics: {
    tokensIn: 0,
    tokensOut: 0,
    estimatedCost: 0,
    turnCount: 0,
    startedAt: null,
    duration: 0,
    costRate: 0,
    tokenRate: 0,
    costHistory: [],
  },
  lastActivityAt: 0,
  createdAt: 0,
  delegation: {
    children: Array.from({ length: 9 }, (_, index) => ({
      id: `child-${index}`,
      agentType: 'Explore',
      startedAt: 1,
    })),
  },
};

function renderAt(altitude: 'fleet' | 'project') {
  const state = { agents: { lead }, metrics, lastUpdated: 1 };
  const zoneId = selectSpatialBoardLayout(state).zones[0]!.id;
  const layout = selectSpatialBoardLayout(state, {
    altitude,
    focusedProjectId: altitude === 'project' ? zoneId : null,
  });
  const lobe = layout.delegationUnits.find(unit => unit.kind === 'overflow')!;
  const view = render(
    <DelegationControls
      units={layout.delegationUnits}
      pieces={layout.pieces}
      altitude={layout.altitude}
      focusedProjectId={layout.focusedProjectId}
      onSelectAgent={() => undefined}
      onHoverChange={() => undefined}
      reduced={false}
      theme={{ label: '#ffffff' } as SpatialThemeSnapshot}
    />
  );
  return { ...view, layout, lobe };
}

afterEach(cleanup);

/** BUG-226: the "+N" lobe is drawn at every altitude, so its count is too. */
describe('the delegation overflow lobe', () => {
  it('shows its count at the Fleet overview, read-only', () => {
    const { container, layout, lobe } = renderAt('fleet');
    expect(layout.altitude).toBe('fleet');
    expect(lobe.overflowCount).toBe(5);
    const count = [
      ...container.querySelectorAll('[data-board-delegation-overflow]'),
    ].find(
      element =>
        element.getAttribute('data-board-delegation-overflow') === lobe.id
    );
    expect(count?.textContent).toBe(`+${lobe.overflowCount}`);
    // Zones own the drill verb at this altitude: no in-world buttons.
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows its count on its control inside a Project', () => {
    const { container, layout, lobe } = renderAt('project');
    expect(layout.altitude).toBe('project');
    const control = [
      ...container.querySelectorAll('[data-board-delegation-unit]'),
    ].find(
      element => element.getAttribute('data-board-delegation-unit') === lobe.id
    );
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.textContent).toBe(`+${lobe.overflowCount}`);
  });
});
