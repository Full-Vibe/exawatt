// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DesktopSettingsApi,
  ExawattSettings,
} from '@exawatt/core/desktop-bridge';
import { PresentationProvider, usePresentation } from './presentation-provider';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { PRESENTATION_STORAGE_KEY } from '@/lib/presentation/preference-source';

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

describe('presentation persistence', () => {
  it('uses the runtime default without writing until explicitly chosen', async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.fleetView).toBe('v1');
    expect(view.result.current.fleetMaterial).toBe('gummy');
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
    await act(() => view.result.current.setFleetView('v1'));
    expect(JSON.parse(localStorage.getItem(PRESENTATION_STORAGE_KEY)!)).toEqual(
      { schemaVersion: 1, fleetView: 'v1' }
    );
    await act(() => view.result.current.setFleetView('v2'));
    view.unmount();
    const reopened = mount();
    await waitFor(() => expect(reopened.result.current.fleetView).toBe('v2'));
    await act(() => reopened.result.current.resetFleetView());
    expect(reopened.result.current.fleetView).toBe('v1');
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
  });
  it('persists material independently and resets only the requested choice', async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(() => view.result.current.setFleetMaterial('anodized'));
    expect(JSON.parse(localStorage.getItem(PRESENTATION_STORAGE_KEY)!)).toEqual(
      {
        schemaVersion: 1,
        fleetMaterial: 'anodized',
      }
    );
    await act(() => view.result.current.setFleetView('v2'));
    expect(view.result.current.fleetMaterial).toBe('anodized');
    await act(() => view.result.current.resetFleetView());
    expect(view.result.current.fleetView).toBe('v1');
    expect(view.result.current.fleetMaterial).toBe('anodized');
    view.unmount();
    const reopened = mount();
    await waitFor(() =>
      expect(reopened.result.current.fleetMaterial).toBe('anodized')
    );
    await act(() => reopened.result.current.resetFleetMaterial());
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
  });
  it.each([
    'broken JSON',
    JSON.stringify({ schemaVersion: 8, fleetView: 'v2' }),
    JSON.stringify({ schemaVersion: 1, fleetView: 'other' }),
  ])(
    'recovers unsupported browser state without writing it: %s',
    async saved => {
      localStorage.setItem(PRESENTATION_STORAGE_KEY, saved);
      const view = mount();
      await waitFor(() => expect(view.result.current.ready).toBe(true));
      expect(view.result.current.fleetView).toBe('v1');
      expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBe(saved);
    }
  );
  it('observes same-document and other-document choices without echoing writes', async () => {
    const one = mount();
    const two = mount();
    await waitFor(() => expect(two.result.current.ready).toBe(true));
    await act(() => one.result.current.setFleetView('v2'));
    expect(two.result.current.fleetView).toBe('v2');
    localStorage.removeItem(PRESENTATION_STORAGE_KEY);
    const write = vi.spyOn(Storage.prototype, 'setItem');
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: PRESENTATION_STORAGE_KEY })
      )
    );
    expect(two.result.current.fleetView).toBe('v1');
    expect(write).not.toHaveBeenCalled();
  });
  it('does not retry a failed material change when the view changes later', async () => {
    const save = vi
      .fn<DesktopSettingsApi['setPresentation']>()
      .mockRejectedValueOnce(new Error('Store unavailable'))
      .mockImplementation(async presentation => ({
        presentation: presentation ?? undefined,
      }));
    installBridgeDouble({
      settings: {
        get: vi.fn(async () => ({})),
        setPresentation: save,
        onChanged: vi.fn(() => () => undefined),
      },
    });
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => {
      await expect(
        view.result.current.setFleetMaterial('acrylic')
      ).rejects.toThrow('Store unavailable');
    });
    expect(view.result.current.fleetMaterial).toBe('gummy');
    await act(() => view.result.current.setFleetView('v2'));
    expect(save).toHaveBeenLastCalledWith({
      schemaVersion: 1,
      fleetView: 'v2',
    });
  });
  it('uses desktop settings and does not let a slow initial read undo a newer broadcast', async () => {
    let resolveLoad!: (settings: ExawattSettings) => void;
    let changed!: (settings: ExawattSettings) => void;
    const unsubscribe = vi.fn();
    const settings = {
      get: vi.fn(
        () =>
          new Promise<ExawattSettings>(resolve => {
            resolveLoad = resolve;
          })
      ),
      setPresentation: vi.fn<DesktopSettingsApi['setPresentation']>(
        async presentation => ({ presentation: presentation ?? undefined })
      ),
      onChanged: vi.fn<DesktopSettingsApi['onChanged']>(handler => {
        changed = handler;
        return unsubscribe;
      }),
    } satisfies Partial<DesktopSettingsApi>;
    installBridgeDouble({ settings });
    const view = mount();
    act(() => changed({ presentation: { schemaVersion: 1, fleetView: 'v2' } }));
    await act(async () => resolveLoad({}));
    expect(view.result.current.fleetView).toBe('v2');
    await act(() => view.result.current.setFleetView('v1'));
    expect(settings.setPresentation).toHaveBeenCalledWith({
      schemaVersion: 1,
      fleetView: 'v1',
    });
    expect(localStorage.getItem(PRESENTATION_STORAGE_KEY)).toBeNull();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
