import { describe, expect, it, vi } from 'vitest';
import {
  ElectronAuthCoordinator,
  safeElectronAuthError,
} from './auth-coordinator';

const startConfig = {
  supabaseUrl: 'https://project.supabase.co',
  supabaseAnonKey: 'public-anon-key',
  redirectTo: 'http://127.0.0.1:43123/auth/electron-callback',
};

function setup() {
  const signInWithGoogle = vi.fn().mockResolvedValue({
    data: { url: 'https://project.supabase.co/auth/v1/authorize' },
    error: null,
  });
  const exchangeCode = vi.fn().mockResolvedValue({
    data: {
      session: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      },
    },
    error: null,
  });
  const createAuthClient = vi.fn(() => ({
    signInWithGoogle,
    exchangeCode,
  }));
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const coordinator = new ElectronAuthCoordinator({
    expectedRendererOrigin: 'http://127.0.0.1:43123',
    openExternal,
    createAuthClient,
  });

  return {
    coordinator,
    createAuthClient,
    signInWithGoogle,
    exchangeCode,
    openExternal,
  };
}

describe('ElectronAuthCoordinator', () => {
  it('uses Supabase PKCE semantics in the real main-process client', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ElectronAuthCoordinator({
      expectedRendererOrigin: 'http://127.0.0.1:43123',
      openExternal,
    });

    await coordinator.startGoogle(startConfig);

    const authorizeUrl = new URL(openExternal.mock.calls[0][0]);
    expect(authorizeUrl.origin).toBe('https://project.supabase.co');
    expect(authorizeUrl.pathname).toBe('/auth/v1/authorize');
    expect(authorizeUrl.searchParams.get('provider')).toBe('google');
    expect(authorizeUrl.searchParams.get('redirect_to')).toBe(
      startConfig.redirectTo
    );
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe(
      's256'
    );
  });

  it('creates a main-process PKCE flow and opens its system-browser URL', async () => {
    const { coordinator, createAuthClient, signInWithGoogle, openExternal } =
      setup();

    await coordinator.startGoogle(startConfig);

    expect(createAuthClient).toHaveBeenCalledWith({
      supabaseUrl: startConfig.supabaseUrl,
      supabaseAnonKey: startConfig.supabaseAnonKey,
      storage: expect.objectContaining({
        getItem: expect.any(Function),
        setItem: expect.any(Function),
        removeItem: expect.any(Function),
      }),
    });
    expect(signInWithGoogle).toHaveBeenCalledWith(startConfig.redirectTo);
    expect(openExternal).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize'
    );
  });

  it('exchanges the callback once and returns only the renderer session pair', async () => {
    const { coordinator, exchangeCode } = setup();
    await coordinator.startGoogle(startConfig);

    await expect(coordinator.exchangeCode('one-time-code')).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
    expect(exchangeCode).toHaveBeenCalledWith('one-time-code');
    await expect(coordinator.exchangeCode('replay')).rejects.toThrow(
      'No Google sign-in is pending'
    );
  });

  it('rejects renderer redirects outside the trusted callback route', async () => {
    const { coordinator, openExternal } = setup();

    await expect(
      coordinator.startGoogle({
        ...startConfig,
        redirectTo: 'https://attacker.example/auth/electron-callback',
      })
    ).rejects.toThrow('callback URL was rejected');
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('clears a flow whose browser launch fails', async () => {
    const { coordinator, openExternal } = setup();
    openExternal.mockRejectedValueOnce(new Error('browser unavailable'));

    await expect(coordinator.startGoogle(startConfig)).rejects.toThrow(
      'browser unavailable'
    );
    await expect(coordinator.exchangeCode('orphaned-code')).rejects.toThrow(
      'No Google sign-in is pending'
    );
  });

  it('serializes only safe auth error fields', () => {
    expect(
      safeElectronAuthError({
        name: 'AuthApiError',
        message: 'Invalid grant',
        status: 400,
        code: 'bad_code',
        access_token: 'must-not-cross-ipc',
      })
    ).toEqual({
      name: 'AuthApiError',
      message: 'Invalid grant',
      status: 400,
      code: 'bad_code',
    });
  });
});
