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
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { SafetySettings } from './safety-settings';

type SettingsBridge = Pick<
  DesktopSettingsApi,
  'get' | 'onChanged' | 'setSafetyControl'
>;

function installSettings(initial: ExawattSettings = {}) {
  let store = initial;
  const bridge: SettingsBridge = {
    get: vi.fn(() => Promise.resolve(store)),
    onChanged: vi.fn(() => () => undefined),
    setSafetyControl: vi.fn(async (id: SafetyControlId, enabled: boolean) => {
      store = { ...store, safety: { ...store.safety, [id]: enabled } };
      return store;
    }),
  };
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

  it('offers no switch outside the desktop app, where nothing launches agents', async () => {
    await renderSafety();

    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(document.querySelectorAll('[data-safety-control]')).toHaveLength(
      SAFETY_CONTROLS.length
    );
  });
});
