import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAFETY_CONTROLS, type SafetyControlId } from '@exawatt/core';
import type {
  DesktopSettingsApi,
  ExawattSettings,
} from '@exawatt/core/desktop-bridge';
import type { SafetyControlsRead } from '@exawatt/core';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { SafetySettings } from './safety-settings';

type SettingsBridge = Pick<
  DesktopSettingsApi,
  'getSafetyControls' | 'onChanged' | 'setSafetyControl'
>;

function installSettings(
  initial: ExawattSettings = {},
  failures: { read?: 'reject' | 'unreadable'; save?: boolean } = {}
) {
  let store = initial;
  const bridge = {
    getSafetyControls: vi.fn((): Promise<SafetyControlsRead> => {
      if (failures.read === 'reject') {
        return Promise.reject(new Error('settings:get-safety-controls failed'));
      }
      if (failures.read === 'unreadable') {
        return Promise.resolve({ status: 'unreadable' });
      }
      return Promise.resolve({ status: 'ready', controls: store.safety ?? {} });
    }),
    onChanged: vi.fn(() => () => undefined),
    setSafetyControl: vi.fn(async (id: SafetyControlId, enabled: boolean) => {
      if (failures.save) throw new Error('settings.json needs recovery');
      store = { ...store, safety: { ...store.safety, [id]: enabled } };
      return store;
    }),
  } satisfies SettingsBridge;
  installBridgeDouble({ platform: 'darwin', settings: bridge });
  return bridge;
}

async function renderSafety() {
  render(<SafetySettings />);
  await act(async () => undefined);
}

function switchFor(id: SafetyControlId): HTMLElement {
  const row = document.querySelector<HTMLElement>(
    `[data-safety-control="${id}"]`
  );
  if (!row) throw new Error(`No row rendered for ${id}`);
  return row.querySelector<HTMLElement>('[role="switch"]')!;
}

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('SafetySettings', () => {
  it('renders one row per declared control, every one off by default', async () => {
    installSettings();
    await renderSafety();

    expect(document.querySelectorAll('[data-safety-control]')).toHaveLength(
      SAFETY_CONTROLS.length
    );
    for (const control of SAFETY_CONTROLS) {
      expect(switchFor(control.id).getAttribute('aria-checked')).toBe('false');
    }
  });

  it('turns a control on through the desktop bridge and shows the stored state', async () => {
    const bridge = installSettings();
    await renderSafety();
    const [control] = SAFETY_CONTROLS;

    await act(async () => {
      fireEvent.click(switchFor(control.id));
    });

    expect(bridge.setSafetyControl).toHaveBeenCalledWith(control.id, true);
    expect(switchFor(control.id).getAttribute('aria-checked')).toBe('true');
  });

  it('shows a control the operator already turned on as on', async () => {
    const [control] = SAFETY_CONTROLS;
    installSettings({ safety: { [control.id]: true } });
    await renderSafety();

    expect(switchFor(control.id).getAttribute('aria-checked')).toBe('true');
  });

  it.each(['reject', 'unreadable'] as const)(
    'never shows a control as off when its read fails (%s), and retries',
    async failure => {
      const [control] = SAFETY_CONTROLS;
      const failures: { read?: 'reject' | 'unreadable' } = { read: failure };
      const bridge = installSettings(
        { safety: { [control.id]: true } },
        failures
      );
      await renderSafety();

      expect(screen.queryAllByRole('switch')).toHaveLength(0);

      delete failures.read;
      await act(async () => {
        fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
      });

      expect(bridge.getSafetyControls).toHaveBeenCalledTimes(2);
      expect(switchFor(control.id).getAttribute('aria-checked')).toBe('true');
    }
  );

  it('tells the operator when a change was refused, and keeps the real state', async () => {
    const [control] = SAFETY_CONTROLS;
    installSettings({}, { save: true });
    await renderSafety();

    await act(async () => {
      fireEvent.click(switchFor(control.id));
    });

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(switchFor(control.id).getAttribute('aria-checked')).toBe('false');
  });

  it('offers no switch outside the desktop app, where nothing launches agents', async () => {
    await renderSafety();

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelectorAll('[data-safety-control]')).toHaveLength(
      SAFETY_CONTROLS.length
    );
  });
});
