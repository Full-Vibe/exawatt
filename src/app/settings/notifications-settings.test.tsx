import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PermissionEnsureResult, PermissionState } from '@exawatt/core';
import type {
  DesktopPermissionsApi,
  DesktopSettingsApi,
  ExawattSettings,
} from '@exawatt/core/desktop-bridge';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';
import { PermissionsProvider } from '@/components/permissions/permissions-provider';
import { NotificationsSettings } from './notifications-settings';

function install(state: PermissionState, attention = false) {
  let current: ExawattSettings = { notifications: { attention } };
  let changed: ((snapshot: never) => void) | null = null;
  const entry = (s: PermissionState) => [
    { id: 'notifications' as const, state: s, checkedAt: 1 },
  ];
  const permissions = {
    snapshot: vi.fn(async () => entry(state)),
    refresh: vi.fn(async () => entry(state)),
    ensure: vi.fn(
      async (
        _id: 'notifications',
        request: { reason: string; primed?: boolean }
      ): Promise<PermissionEnsureResult> => {
        if (state === 'granted') {
          return { id: 'notifications', state, outcome: 'ready' };
        }
        return {
          id: 'notifications',
          state,
          outcome: request.primed ? 'requested' : 'primer',
        };
      }
    ),
    openSettings: vi.fn(async () => undefined),
    onChanged: vi.fn(handler => {
      changed = handler as never;
      return () => undefined;
    }),
    onPrimerRequested: vi.fn(() => () => undefined),
  } satisfies DesktopPermissionsApi;
  const settings = {
    get: vi.fn(async () => current),
    onChanged: vi.fn(() => () => undefined),
    setAttentionNotifications: vi.fn(async (enabled: boolean) => {
      current = { notifications: { attention: enabled } };
      return current;
    }),
    setDockBadge: vi.fn(async () => current),
  } satisfies Partial<DesktopSettingsApi>;
  installBridgeDouble({ permissions, settings });
  const push = (next: PermissionState) =>
    act(() => (changed as unknown as (s: unknown) => void)?.(entry(next)));
  return {
    permissions,
    settings,
    grant: () => push('granted'),
    refuse: () => push('denied'),
  };
}

async function mount() {
  render(
    <PermissionsProvider>
      <NotificationsSettings />
    </PermissionsProvider>
  );
  await act(async () => undefined);
}

const nativeSwitch = () =>
  screen.getByRole('switch', { name: 'Native macOS notifications' });

afterEach(() => {
  cleanup();
  removeBridgeDouble();
});

describe('the native notifications switch', () => {
  it('turns on at once when macOS already allows notifications', async () => {
    const { settings } = install('granted');
    await mount();
    await act(async () => {
      fireEvent.click(nativeSwitch());
    });
    expect(settings.setAttentionNotifications).toHaveBeenCalledWith(true);
  });

  it('shows the primer first and stays off until the grant is made', async () => {
    const { settings, permissions, grant } = install('not-determined');
    await mount();
    await act(async () => {
      fireEvent.click(nativeSwitch());
    });
    expect(document.querySelector('[data-permission-primer]')).not.toBeNull();
    expect(settings.setAttentionNotifications).not.toHaveBeenCalled();
    expect(
      permissions.ensure.mock.calls.some(([, request]) => request.primed)
    ).toBe(false);

    const continueButton = document
      .querySelector('[data-permission-primer]')!
      .querySelector('button')!;
    await act(async () => {
      fireEvent.click(continueButton);
    });
    expect(permissions.ensure).toHaveBeenLastCalledWith(
      'notifications',
      expect.objectContaining({ primed: true })
    );
    expect(settings.setAttentionNotifications).not.toHaveBeenCalled();

    grant();
    await act(async () => undefined);
    expect(settings.setAttentionNotifications).toHaveBeenCalledWith(true);
  });

  it('stays off when the user dismisses the primer', async () => {
    const { settings } = install('not-determined');
    await mount();
    await act(async () => {
      fireEvent.click(nativeSwitch());
    });
    await act(async () => {
      fireEvent.keyDown(document.querySelector('[role="dialog"]')!, {
        key: 'Escape',
      });
    });
    expect(document.querySelector('[data-permission-primer]')).toBeNull();
    expect(settings.setAttentionNotifications).not.toHaveBeenCalled();
    expect(nativeSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('stays off when the user refuses the system prompt', async () => {
    const { settings, refuse } = install('not-determined');
    await mount();
    await act(async () => {
      fireEvent.click(nativeSwitch());
    });
    await act(async () => {
      fireEvent.click(
        document.querySelector('[data-permission-primer] button')!
      );
    });
    refuse();
    await act(async () => undefined);
    expect(settings.setAttentionNotifications).not.toHaveBeenCalled();
    expect(nativeSwitch().getAttribute('aria-checked')).toBe('false');
  });

  it('turns off without asking anything', async () => {
    const { settings, permissions } = install('granted', true);
    await mount();
    await act(async () => {
      fireEvent.click(nativeSwitch());
    });
    expect(settings.setAttentionNotifications).toHaveBeenCalledWith(false);
    expect(permissions.ensure).not.toHaveBeenCalled();
  });

  it('says so, with the way forward, when it is on but macOS blocks it', async () => {
    const { permissions } = install('denied', true);
    await mount();
    const notice = document.querySelector('[data-notifications-blocked]');
    expect(notice).not.toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'Open System Settings' })
      );
    });
    expect(permissions.openSettings).toHaveBeenCalledWith('notifications');
  });

  it('says nothing about macOS when it is on and allowed', async () => {
    install('granted', true);
    await mount();
    expect(document.querySelector('[data-notifications-blocked]')).toBeNull();
  });
});
