import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import type { FleetView } from '@exawatt/core/desktop-bridge';
import type { OperationsBoardCanvas } from './operations-board-canvas';
import type { OperationsBoardHandle } from './operations-board-camera-rig';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';

type CanvasProps = ComponentProps<typeof OperationsBoardCanvas>;
const rig = vi.hoisted(() => ({
  props: new Map<FleetView, CanvasProps>(),
  fail: null as FleetView | null,
  handoff: false,
}));
vi.mock('@/components/appearance/appearance-provider', () => ({
  useAppearance: () => ({ resolved: appearance }),
}));
vi.mock('@/components/hud/webgl/use-agent-field-glide', () => ({
  useAgentFieldGlide: () => undefined,
}));
vi.mock('@/components/nav/altitude-handoff', () => ({
  altitudeHandoffActive: () => rig.handoff,
}));
vi.mock('./operations-board-views', () => {
  function canvas(view: FleetView) {
    return function DeferredController(props: CanvasProps) {
      useEffect(() => {
        rig.props.set(view, props);
      });
      if (rig.fail === view) throw new Error('Fixture renderer unavailable');
      return <div data-test-renderer={view} />;
    };
  }
  const views = {
    v1: { Canvas: canvas('v1'), projections: ['top-down', 'fixed-angle'] },
    v2: { Canvas: canvas('v2'), projections: ['fixed-angle'] },
  };
  return { boardViewFor: (view: FleetView) => views[view] };
});
import { OperationsBoardSurface } from './operations-board-surface';

const appearance = resolveAppearance(
  THEME_REGISTRY,
  {
    schemaVersion: 1,
    selection: { mode: 'manual', themeId: 'exawatt-air-light' },
    accentSource: 'theme',
    interfaceFont: 'theme',
    interfaceScale: 100,
    contrast: 'system',
    transparency: 'system',
  },
  {
    dark: false,
    highContrast: false,
    forcedColors: false,
    invertedColors: false,
    reducedTransparency: false,
  }
);
const agent = createAgent({ id: 'one', name: 'One', project: 'Project' });
const layout = selectSpatialBoardLayout({
  agents: { [agent.id]: agent },
  metrics: {
    activeCount: 0,
    blockedCount: 0,
    idleCount: 1,
    totalCost: 0,
    totalTokens: 0,
    totalCostRate: 0,
    costByProject: {},
  },
  lastUpdated: 1,
});
const storageKey = 'viewport-readiness-fixture';
const remembered = {
  centerX: 12,
  centerY: 15,
  width: 90,
  height: 60,
  zoom: 2.5,
};
function surface(fleetView: FleetView) {
  return (
    <OperationsBoardSurface
      layout={layout}
      fleetView={fleetView}
      projection="top-down"
      viewportStorageKey={storageKey}
      onDrillProject={() => undefined}
      onSelectAgent={() => undefined}
      onOverview={() => undefined}
      onProjectionChange={() => undefined}
    />
  );
}
function handle(): OperationsBoardHandle {
  return {
    restoreViewport: vi.fn(),
    recenter: vi.fn(),
    focusProject: vi.fn(),
    focusFleet: vi.fn(),
    focusAgent: vi.fn(),
    enterSession: vi.fn(),
    zoom: vi.fn(),
    pan: vi.fn(),
    panToBoardPoint: vi.fn(),
    nudge: vi.fn(),
  };
}
beforeEach(() => {
  rig.props.clear();
  rig.fail = null;
  rig.handoff = false;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('board renderer readiness', () => {
  it('restores after lazy controller readiness and carries the operator pose across views', async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(remembered));
    const view = render(surface('v1'));
    const first = handle();
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.restoreViewport).not.toHaveBeenCalled();
    act(() => {
      rig.props
        .get('v1')!
        .onViewportChange?.({
          centerX: 0,
          centerY: 0,
          width: 500,
          height: 500,
        });
      rig.props.get('v1')!.onControllerReady?.(first);
    });
    expect(first.restoreViewport).toHaveBeenCalledExactlyOnceWith(remembered);
    const panned = { ...remembered, centerX: 23, zoom: 4 };
    act(() => rig.props.get('v1')!.onViewportChange?.(panned));
    // Real rig snapshots reuse a projection scratch object. Retain the value.
    panned.zoom = 99;
    view.rerender(surface('v2'));
    const second = handle();
    act(() => {
      rig.props
        .get('v2')!
        .onViewportChange?.({
          centerX: 0,
          centerY: 0,
          width: 800,
          height: 600,
        });
      rig.props.get('v2')!.onControllerReady?.(second);
      rig.props.get('v2')!.onControllerReady?.(second);
    });
    expect(second.restoreViewport).toHaveBeenCalledExactlyOnceWith({
      ...remembered,
      centerX: 23,
      zoom: 4,
    });
    view.rerender(surface('v1'));
    const third = handle();
    act(() => rig.props.get('v1')!.onControllerReady?.(third));
    expect(third.restoreViewport).toHaveBeenCalledExactlyOnceWith({
      ...remembered,
      centerX: 23,
      zoom: 4,
    });
  });

  it('lets the Team handoff own the first camera pose', () => {
    rig.handoff = true;
    window.sessionStorage.setItem(storageKey, JSON.stringify(remembered));
    render(surface('v2'));
    const controller = handle();
    act(() => rig.props.get('v2')!.onControllerReady?.(controller));
    expect(controller.restoreViewport).not.toHaveBeenCalled();
  });

  it('recovers after a renderer failure by retry or changing view', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rig.fail = 'v2';
    const view = render(surface('v2'));
    expect(view.getByRole('link', { name: 'Fleet settings' })).toHaveAttribute(
      'href',
      '/settings?section=fleet'
    );
    rig.fail = null;
    fireEvent.click(view.getByRole('button', { name: 'Retry renderer' }));
    expect(
      view.container.querySelector('[data-test-renderer="v2"]')
    ).not.toBeNull();
    view.rerender(surface('v1'));
    rig.fail = 'v2';
    view.rerender(surface('v2'));
    view.rerender(surface('v1'));
    expect(
      view.container.querySelector('[data-test-renderer="v1"]')
    ).not.toBeNull();
  });
});
