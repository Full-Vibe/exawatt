import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERMISSIONS,
  PERMISSION_STATE_LABELS,
  type PermissionEnsureResult,
  type PermissionState,
} from '@exawatt/core';
import type { DesktopPermissionsApi } from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { PermissionsProvider } from '@/components/permissions/permissions-provider';
import { PermissionsSettings } from './permissions-settings';

function install(state: PermissionState) {
  const entry = { id: 'notifications' as const, state, checkedAt: 1 };
  const bridge = {
    snapshot: vi.fn(async () => [entry]),
    refresh: vi.fn(async () => [entry]),
    ensure: vi.fn(
      async (): Promise<PermissionEnsureResult> => ({
        id: 'notifications',
        state,
        outcome: 'primer',
      })
    ),
    openSettings: vi.fn(async () => undefined),
    onChanged: vi.fn(() => () => undefined),
    onPrimerRequested: vi.fn(() => () => undefined),
  } satisfies DesktopPermissionsApi;
  installBridgeDouble({ permissions: bridge });
  return bridge;
}

async function renderSection() {
  render(
    <PermissionsProvider>
      <PermissionsSettings />
    </PermissionsProvider>
  );
  await act(async () => undefined);
}

const row = (id: string) =>
  document.querySelector<HTMLElement>(`[data-permission="${id}"]`)!;
const button = (name: string) => screen.queryByRole('button', { name });

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('Settings > Permissions', () => {
  it('renders one row per declared grant, and only those', async () => {
    install('granted');
    await renderSection();
    expect(document.querySelectorAll('[data-permission]')).toHaveLength(
      PERMISSIONS.length
    );
    for (const permission of PERMISSIONS) {
      expect(row(permission.id).textContent).toContain(permission.label);
      expect(row(permission.id).textContent).toContain(permission.why);
    }
  });

  it('shows an allowed grant with nothing to do', async () => {
    install('granted');
    await renderSection();
    expect(row('notifications').textContent).toContain(
      PERMISSION_STATE_LABELS.granted
    );
    expect(button('Allow')).toBeNull();
    expect(button('Open System Settings')).toBeNull();
  });

  it('offers Allow for a grant nobody was asked about, and Allow starts the ask', async () => {
    const bridge = install('not-determined');
    await renderSection();
    expect(button('Open System Settings')).toBeNull();
    await act(async () => {
      fireEvent.click(button('Allow')!);
    });
    expect(bridge.ensure).toHaveBeenCalledWith('notifications', {
      reason: PERMISSIONS[0]!.why,
    });
    // The primer is the next thing the user sees.
    expect(document.querySelector('[data-permission-primer]')).not.toBeNull();
  });

  it('offers System Settings for a denial, and opens the grant’s pane', async () => {
    const bridge = install('denied');
    await renderSection();
    expect(row('notifications').textContent).toContain(
      PERMISSION_STATE_LABELS.denied
    );
    expect(button('Allow')).toBeNull();
    await act(async () => {
      fireEvent.click(button('Open System Settings')!);
    });
    expect(bridge.openSettings).toHaveBeenCalledWith('notifications');
  });

  it('shows a status it cannot read as unavailable, never as denied', async () => {
    install('unknown');
    await renderSection();
    expect(row('notifications').textContent).toContain(
      PERMISSION_STATE_LABELS.unknown
    );
    expect(row('notifications').textContent).not.toContain(
      PERMISSION_STATE_LABELS.denied
    );
    expect(button('Open System Settings')).toBeNull();
    expect(button('Allow')).not.toBeNull();
  });

  it('says it lives in the desktop app when there is no bridge', async () => {
    removeBridgeDouble();
    await renderSection();
    expect(row('notifications').textContent).toContain('In the desktop app');
    expect(button('Allow')).toBeNull();
  });
});
