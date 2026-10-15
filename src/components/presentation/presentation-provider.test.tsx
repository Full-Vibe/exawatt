// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyPresentationUpdate,
  type DesktopSettingsApi,
  type ExawattSettings,
  type PresentationUpdate,
} from '@exawatt/core/desktop-bridge';
import { PresentationProvider, usePresentation } from './presentation-provider';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import {
  createPresentationPreferenceSource,
  PRESENTATION_STORAGE_KEY,
} from '@/lib/presentation/preference-source';

beforeEach(() => {
  localStorage.clear();
  removeBridgeDouble();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  removeBridgeDouble();
});
const mount = () =>
  renderHook(usePresentation, { wrapper: PresentationProvider });

function queuedDesktop(initial: ExawattSettings = {}) {
  let current = initial;
  const listeners = new Set<(settings: ExawattSettings) => void>();
  const requests: Array<{
    intent: PresentationUpdate;
    resolve: (settings: ExawattSettings) => void;
    reject: (error: Error) => void;
  }> = [];
  const api = {
    get: vi.fn(async () => current),
    updatePresentation: vi.fn<DesktopSettingsApi['updatePresentation']>(
      intent =>
        new Promise((resolve, reject) =>
          requests.push({ intent, resolve, reject })
        )
    ),
    onChanged: vi.fn<DesktopSettingsApi['onChanged']>(listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  };
  installBridgeDouble({ settings: api });
  const broadcast = (settings: ExawattSettings) => {
    current = settings;
    for (const listener of listeners) listener(current);
  };
  return {
    api,
    requests,
    broadcast,
    get current() {
      return current;
    },
    persist(index: number) {
      const presentation = applyPresentationUpdate(
        current.presentation,
        requests[index].intent
      );
      broadcast({ ...current, presentation });
      return current;
    },
  };
}

describe('presentation persistence', () => {
  it('uses defaults without writes, persists explicit choices, and resets independently', async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.fleetView).toBe('v1');
    expect(view.result.current.fleetMaterial).toBe('gummy');
    expect(localStorage.length).toBe(0);
    await act(() => view.result.current.setFleetView('v1'));
    await act(() => view.result.current.setFleetMaterial('anodized'));
    await act(() => view.result.current.setFleetView('v2'));
    view.unmount();
    const reopened = mount();
    await waitFor(() => expect(reopened.result.current.fleetView).toBe('v2'));
    expect(reopened.result.current.fleetMaterial).toBe('anodized');
    await act(() => reopened.result.current.resetFleetView());
    expect(reopened.result.current.fleetView).toBe('v1');
    expect(reopened.result.current.fleetMaterial).toBe('anodized');
    await act(() => reopened.result.current.resetFleetMaterial());
    expect(await createPresentationPreferenceSource().load()).toBeUndefined();
  });

  it.each([0, 1])(
    'preserves concurrent choices from two renderers when request %i persists first',
    async first => {
      const desktop = queuedDesktop();
      const one = mount();
      const two = mount();
      await waitFor(() => expect(two.result.current.ready).toBe(true));
      let saves!: Promise<void>[];
      act(() => {
        saves = [
          one.result.current.setFleetView('v2'),
          two.result.current.setFleetMaterial('anodized'),
        ];
      });
      await act(async () => {
        for (const index of [first, 1 - first])
          desktop.requests[index].resolve(desktop.persist(index));
        await Promise.all(saves);
      });
      expect(desktop.current.presentation).toEqual({
        schemaVersion: 1,
        fleetView: 'v2',
        fleetMaterial: 'anodized',
      });
      for (const view of [one, two]) {
        expect(view.result.current.fleetView).toBe('v2');
        expect(view.result.current.fleetMaterial).toBe('anodized');
      }
    }
  );

  it('does not let a delayed response undo a newer broadcast or a concurrent reset', async () => {
    const desktop = queuedDesktop({
      presentation: { schemaVersion: 1, fleetView: 'v2' },
    });
    const one = mount();
    const two = mount();
    await waitFor(() => expect(two.result.current.ready).toBe(true));
    let material!: Promise<void>;
    let reset!: Promise<void>;
    act(() => {
      material = one.result.current.setFleetMaterial('matte');
      reset = two.result.current.resetFleetView();
    });
    await act(async () => {
      const olderResponse = desktop.persist(0);
      desktop.requests[1].resolve(desktop.persist(1));
      desktop.requests[0].resolve(olderResponse);
      await Promise.all([material, reset]);
    });
    expect(desktop.current.presentation).toEqual({
      schemaVersion: 1,
      fleetMaterial: 'matte',
    });
    expect(one.result.current.fleetView).toBe('v1');
    expect(two.result.current.fleetMaterial).toBe('matte');
  });

  it('keeps the last persisted same-field choice when responses arrive in reverse', async () => {
    const desktop = queuedDesktop();
    const one = mount();
    const two = mount();
    await waitFor(() => expect(two.result.current.ready).toBe(true));
    let saves!: Promise<void>[];
    act(() => {
      saves = [
        one.result.current.setFleetView('v2'),
        two.result.current.setFleetView('v1'),
      ];
    });
    await act(async () => {
      const first = desktop.persist(0);
      desktop.requests[1].resolve(desktop.persist(1));
      desktop.requests[0].resolve(first);
      await Promise.all(saves);
    });
    expect(one.result.current.fleetView).toBe('v1');
    expect(two.result.current.fleetView).toBe('v1');
  });

  it('does not leak a failed change into a later intent', async () => {
    const desktop = queuedDesktop();
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => {
      const save = view.result.current.setFleetMaterial('acrylic');
      const rejection = expect(save).rejects.toThrow('Store unavailable');
      desktop.requests[0].reject(new Error('Store unavailable'));
      await rejection;
    });
    expect(view.result.current.fleetMaterial).toBe('gummy');
    await act(async () => {
      const save = view.result.current.setFleetView('v2');
      desktop.requests[1].resolve(desktop.persist(1));
      await save;
    });
    expect(desktop.current.presentation).toEqual({
      schemaVersion: 1,
      fleetView: 'v2',
    });
  });

  it('does not let a slow initial read undo a newer broadcast', async () => {
    const desktop = queuedDesktop();
    let resolveLoad!: (settings: ExawattSettings) => void;
    desktop.api.get.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveLoad = resolve;
        })
    );
    const view = mount();
    act(() =>
      desktop.broadcast({ presentation: { schemaVersion: 1, fleetView: 'v2' } })
    );
    await act(async () => resolveLoad({}));
    expect(view.result.current.fleetView).toBe('v2');
    expect(view.result.current.ready).toBe(true);
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
  });
});
