import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useEffect, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '@exawatt/core';
import { selectSpatialBoardLayout } from '@exawatt/ui-model';
import type { FleetView, FleetMaterial } from '@exawatt/core/desktop-bridge';
import type { OperationsBoardCanvas } from './operations-board-canvas';
import type { OperationsBoardHandle } from './operations-board-camera-rig';
import { THEME_REGISTRY } from '@/generated/theme-registry';
import { resolveAppearance } from '@/lib/appearance/resolve-appearance';

type CanvasProps = ComponentProps<typeof OperationsBoardCanvas>;
const rig = vi.hoisted(() => ({
  props: new Map<FleetView, CanvasProps>(),
  fail: null as FleetView | null,
  handoff: false,
  rejectLoad: null as FleetView | null,
  loads: new Map<FleetView, number>(),
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
  function loader(view: FleetView) {
    const Canvas = canvas(view);
    return async () => {
      rig.loads.set(view, (rig.loads.get(view) ?? 0) + 1);
      if (rig.rejectLoad === view) throw new Error('Fixture chunk unavailable');
      return { default: Canvas };
    };
  }
  const views = {
    v1: { load: loader('v1'), projections: ['top-down', 'fixed-angle'] },
    v2: { load: loader('v2'), projections: ['fixed-angle'] },
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
  rig.loads.clear();
  rig.rejectLoad = null;
  rig.fail = null;
  rig.handoff = false;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('board renderer readiness', () => {
  it('restores after lazy readiness without applying a pose from another coordinate family', async () => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(remembered));
    const view = render(surface('v1'));
    const first = handle();
    await act(async () => {
      await Promise.resolve();
    });
    expect(first.restoreViewport).not.toHaveBeenCalled();
    act(() => {
      rig.props.get('v1')!.onViewportChange?.({
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
    await act(async () => view.rerender(surface('v2')));
    const second = handle();
    act(() => {
      rig.props.get('v2')!.onViewportChange?.({
        centerX: 0,
        centerY: 0,
        width: 800,
        height: 600,
      });
      rig.props.get('v2')!.onControllerReady?.(second);
      rig.props.get('v2')!.onControllerReady?.(second);
    });
    // v2 now uses a native XZ perspective lattice. A v1 XY rectangle would
    // put its camera in unrelated territory; only a compatible pose restores.
    expect(second.restoreViewport).not.toHaveBeenCalled();
    await act(async () => view.rerender(surface('v1')));
    const third = handle();
    act(() => rig.props.get('v1')!.onControllerReady?.(third));
    expect(third.restoreViewport).toHaveBeenCalledExactlyOnceWith({
      ...remembered,
      centerX: 23,
      zoom: 4,
    });
  });

  it('lets the Team handoff own the first camera pose', async () => {
    rig.handoff = true;
    window.sessionStorage.setItem(storageKey, JSON.stringify(remembered));
    await act(async () => {
      render(surface('v2'));
    });
    const controller = handle();
    act(() => rig.props.get('v2')!.onControllerReady?.(controller));
    expect(controller.restoreViewport).not.toHaveBeenCalled();
  });

  it('recovers after a renderer failure by retry or changing view', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rig.fail = 'v2';
    const view = render(surface('v2'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.getByRole('link', { name: 'Fleet settings' })).toHaveAttribute(
      'href',
      '/settings?section=fleet'
    );
    rig.fail = null;
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Retry renderer' }));
    });
    expect(
      view.container.querySelector('[data-test-renderer="v2"]')
    ).not.toBeNull();
    await act(async () => view.rerender(surface('v1')));
    rig.fail = 'v2';
    await act(async () => view.rerender(surface('v2')));
    await act(async () => view.rerender(surface('v1')));
    expect(
      view.container.querySelector('[data-test-renderer="v1"]')
    ).not.toBeNull();
  });
  it('retries a rejected import with a fresh attempt while retaining viewport and selection', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const selectedLayout = { ...layout, selectedAgentId: agent.id };
    const renderSelected = (material: FleetMaterial = 'gummy') => (
      <OperationsBoardSurface
        layout={selectedLayout}
        material={material}
        fleetView="v2"
        projection="fixed-angle"
        viewportStorageKey={storageKey}
        onDrillProject={() => undefined}
        onSelectAgent={() => undefined}
        onOverview={() => undefined}
        onProjectionChange={() => undefined}
      />
    );
    const perspectiveViewport = {
      ...remembered,
      perspective: {
        target: [12, 0, 15],
        distance: 90,
        azimuth: 0.2,
        polar: 0.8,
      },
    };
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify(perspectiveViewport)
    );
    rig.rejectLoad = 'v2';
    const view = render(renderSelected());
    await act(async () => {
      await Promise.resolve();
    });
    expect(rig.loads.get('v2')).toBe(1);
    expect(rig.loads.has('v1')).toBe(false);
    rig.rejectLoad = null;
    await act(async () => view.rerender(renderSelected()));
    expect(rig.loads.get('v2')).toBe(1);
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Retry renderer' }));
    });
    expect(rig.loads.get('v2')).toBe(2);
    expect(
      view.container.querySelector('[data-test-renderer="v2"]')
    ).not.toBeNull();
    expect(rig.props.get('v2')!.layout.selectedAgentId).toBe(agent.id);
    const controller = handle();
    act(() => rig.props.get('v2')!.onControllerReady?.(controller));
    expect(controller.restoreViewport).toHaveBeenCalledExactlyOnceWith(
      perspectiveViewport
    );
    await act(async () => view.rerender(renderSelected('matte')));
    expect(rig.props.get('v2')!.layout.selectedAgentId).toBe(agent.id);
    expect(rig.loads.get('v2')).toBe(2);
  });
});
