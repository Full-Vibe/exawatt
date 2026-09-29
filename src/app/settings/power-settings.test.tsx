import type { ReactNode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  DeviceKeepAwakePolicy,
  DevicePowerStatus,
  ExawattSettings,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { PowerSettings } from './power-settings';

// Exercise the preference's asynchronous contract through a native control;
// Radix's portal and pointer handling are not the behavior under test here.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    disabled,
    onValueChange,
    children,
  }: {
    value: string;
    disabled: boolean;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={event => onValueChange(event.target.value)}
    >
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function snapshot(
  revision: number,
  policy: DeviceKeepAwakePolicy
): DevicePowerStatus {
  return {
    revision,
    policy,
    powerSource: 'ac',
    assertion: 'inactive',
    supportedWorkingSessions: 0,
    independentSources: [],
    error: null,
  };
}

function installPower() {
  const initial = deferred<DevicePowerStatus>();
  const listeners = new Set<(status: DevicePowerStatus) => void>();
  const unsubscribe = vi.fn();
  const subscribe = vi.fn((listener: (status: DevicePowerStatus) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  });
  const save = vi.fn(
    async (policy: DeviceKeepAwakePolicy): Promise<ExawattSettings> => ({
      power: { keepAwake: policy },
    })
  );
  installBridgeDouble({
    app: {
      devicePower: () => initial.promise,
      onDevicePowerChanged: subscribe,
    },
    settings: { setKeepAwake: save },
  });
  return {
    initial,
    subscribe,
    unsubscribe,
    listeners,
    save,
    publish: (status: DevicePowerStatus) => {
      for (const listener of listeners) listener(status);
    },
  };
}

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('PowerSettings native state ownership', () => {
  it('keeps a newer push when the initial read or a later stale push arrives', async () => {
    const bridge = installPower();
    render(<PowerSettings />);
    expect(screen.getByRole('combobox')).toBeDisabled();
    const newer = snapshot(2, 'never');
    act(() => bridge.publish(newer));
    await act(async () => bridge.initial.resolve(snapshot(1, 'ac-only')));
    act(() => bridge.publish(snapshot(0, 'ac-and-battery')));
    expect(screen.getByRole('combobox')).toHaveValue(newer.policy);
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not report an initial read failure after a valid push', async () => {
    const bridge = installPower();
    render(<PowerSettings />);
    const newer = snapshot(2, 'ac-and-battery');
    act(() => bridge.publish(newer));
    await act(async () => bridge.initial.reject(new Error('read failed')));
    expect(screen.getByRole('combobox')).toHaveValue(newer.policy);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('recovers a failed initial read when native status becomes available', async () => {
    const bridge = installPower();
    render(<PowerSettings />);
    await act(async () => bridge.initial.reject(new Error('read failed')));
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.getByRole('combobox')).toBeDisabled();
    const recovered = snapshot(1, 'never');
    act(() => bridge.publish(recovered));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(screen.getByRole('combobox')).toHaveValue(recovered.policy);
  });

  it('unsubscribes and prevents an old mount from changing the remounted preference', async () => {
    const old = installPower();
    const first = render(<PowerSettings />);
    const latePush = old.subscribe.mock.calls[0][0];
    first.unmount();
    expect(old.unsubscribe).toHaveBeenCalledOnce();
    expect(old.listeners.size).toBe(0);
    const current = installPower();
    const currentStatus = snapshot(1, 'never');
    render(<PowerSettings />);
    await act(async () => current.initial.resolve(currentStatus));
    await act(async () => {
      latePush(snapshot(100, 'ac-and-battery'));
      old.initial.resolve(snapshot(101, 'ac-only'));
    });
    expect(screen.getByRole('combobox')).toHaveValue(currentStatus.policy);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the stored preference on write failure and preserves that error across status pushes', async () => {
    const bridge = installPower();
    const write = deferred<ExawattSettings>();
    bridge.save.mockReturnValueOnce(write.promise);
    render(<PowerSettings />);
    const stored = snapshot(1, 'ac-only');
    await act(async () => bridge.initial.resolve(stored));
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'ac-and-battery' },
    });
    expect(bridge.save).toHaveBeenCalledExactlyOnceWith('ac-and-battery');
    expect(screen.getByRole('combobox')).toBeDisabled();
    await act(async () => write.reject(new Error('disk write failed')));
    expect(screen.getByRole('combobox')).toBeEnabled();
    expect(screen.getByRole('combobox')).toHaveValue(stored.policy);
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
    act(() =>
      bridge.publish({ ...stored, revision: 2, powerSource: 'battery' })
    );
    expect(screen.getByRole('alert')).not.toBeEmptyDOMElement();
    expect(screen.getByRole('combobox')).toHaveValue(stored.policy);
  });
});
