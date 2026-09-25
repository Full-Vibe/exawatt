import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostPowerSnapshot } from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { useHostRenderPolicy } from './use-host-render-policy';

const initial: HostPowerSnapshot = {
  revision: 0,
  powerSource: 'ac',
  screenLock: 'unlocked',
  systemSleep: 'awake',
};

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('host rendering policy', () => {
  it('stops ambient visibility while locked and reduces power when unplugged', async () => {
    let push: (snapshot: HostPowerSnapshot) => void = () => {};
    const unsubscribe = vi.fn();
    installBridgeDouble({
      app: {
        hostPower: async () => initial,
        onHostPowerChanged: handler => {
          push = handler;
          return unsubscribe;
        },
      },
    });
    const { result, unmount } = renderHook(() => useHostRenderPolicy(false));
    await act(async () => {});
    expect(result.current).toEqual({ lowPower: false, visible: true });
    act(() => push({ ...initial, revision: 1, screenLock: 'locked' }));
    expect(result.current.visible).toBe(false);
    act(() => push({ ...initial, revision: 2, powerSource: 'battery' }));
    expect(result.current).toEqual({ lowPower: true, visible: true });
    act(() => push({ ...initial, revision: 3, systemSleep: 'suspended' }));
    expect(result.current.visible).toBe(false);
    act(() => push({ ...initial, revision: 4 }));
    expect(result.current).toEqual({ lowPower: false, visible: true });
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not let a delayed initial read undo a newer lock or battery push', async () => {
    let resolveRead: (snapshot: HostPowerSnapshot) => void = () => {};
    const read = new Promise<HostPowerSnapshot>(resolve => {
      resolveRead = resolve;
    });
    let push: (snapshot: HostPowerSnapshot) => void = () => {};
    installBridgeDouble({
      app: {
        hostPower: () => read,
        onHostPowerChanged: handler => {
          push = handler;
          return () => {};
        },
      },
    });
    const { result } = renderHook(() => useHostRenderPolicy(false));
    act(() =>
      push({
        ...initial,
        revision: 1,
        screenLock: 'locked',
        powerSource: 'battery',
      })
    );
    await act(async () => {
      resolveRead(initial);
      await read;
    });
    expect(result.current).toEqual({ lowPower: true, visible: false });
  });

  it('preserves the hosted browser and hardware low-power fallback', () => {
    const { result } = renderHook(() => useHostRenderPolicy(true));
    expect(result.current).toEqual({ lowPower: true, visible: true });
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.visible).toBe(false);
    act(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.visible).toBe(true);
  });
});
