import { describe, expect, it, vi } from 'vitest';
import {
  SYSTEM_SETTINGS_URL,
  createNotificationsProvider,
  notificationsPaneUrl,
} from './notifications-provider';
import type { NotificationAuthorization } from './notification-authorization';

const LINK =
  'x-apple.systempreferences:com.apple.Notifications-Settings.extension';

function authorization(
  read: Awaited<ReturnType<NotificationAuthorization['read']>>
): NotificationAuthorization {
  return {
    read: vi.fn(async () => read),
    request: vi.fn(async () => 'granted' as const),
  };
}

function provider(
  overrides: Partial<Parameters<typeof createNotificationsProvider>[0]> = {}
) {
  const openExternal = vi.fn(async () => undefined);
  return {
    openExternal,
    provider: createNotificationsProvider({
      platform: 'darwin',
      authorization: authorization('not-determined'),
      settingsLink: LINK,
      bundleId: 'ai.exawatt.desktop',
      openExternal,
      ...overrides,
    }),
  };
}

describe('the notifications provider', () => {
  it.each(['not-determined', 'denied', 'granted'] as const)(
    'reports macOS’s own answer: %s',
    async answer => {
      const { provider: p } = provider({
        authorization: authorization(answer),
      });
      expect(await p.read()).toEqual({ ok: true, state: answer });
    }
  );

  it('reads unknown, never denied, when the system could not answer', async () => {
    const { provider: p } = provider({
      authorization: authorization('unavailable'),
    });
    expect(await p.read()).toEqual({ ok: false });
  });

  it('reads unknown on a Mac build without the native read', async () => {
    const { provider: p } = provider({ authorization: null });
    expect(await p.read()).toEqual({ ok: false });
  });

  it('has no gate off macOS, where nothing prompts', async () => {
    const { provider: p } = provider({
      platform: 'linux',
      authorization: null,
    });
    expect(await p.read()).toEqual({ ok: true, state: 'granted' });
    await expect(p.request()).resolves.toBeUndefined();
  });

  it('asks the system, and does nothing when it cannot', async () => {
    const auth = authorization('not-determined');
    await provider({ authorization: auth }).provider.request();
    expect(auth.request).toHaveBeenCalledTimes(1);
    await expect(
      provider({ authorization: null }).provider.request()
    ).resolves.toBeUndefined();
  });

  it('opens the pane scoped to the app, then System Settings when that link fails', async () => {
    const { provider: p, openExternal } = provider();
    await p.openSettings();
    expect(openExternal).toHaveBeenCalledWith(`${LINK}?id=ai.exawatt.desktop`);

    openExternal.mockRejectedValueOnce(new Error('no handler'));
    await p.openSettings();
    expect(openExternal).toHaveBeenLastCalledWith(SYSTEM_SETTINGS_URL);
  });

  it('opens the bare pane when the build has no bundle id of its own', () => {
    expect(notificationsPaneUrl(LINK, null)).toBe(LINK);
  });
});
