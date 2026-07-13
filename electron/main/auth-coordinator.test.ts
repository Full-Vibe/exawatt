import type { CookieMethodsBrowser } from '@supabase/ssr';
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

function memoryCookies() {
  const values = new Map<string, string>();
  const cookies: CookieMethodsBrowser = {
    getAll: () =>
      [...values].map(([name, value]) => ({
        name,
        value,
      })),
    setAll: items => {
      for (const { name, value, options } of items) {
        if (
          !value ||
          (typeof options.maxAge === 'number' && options.maxAge <= 0)
        ) {
          values.delete(name);
        } else {
          values.set(name, value);
        }
      }
    },
  };
  return { cookies, values };
}

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
  const installSession = vi.fn().mockResolvedValue({
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
    installSession,
  }));
  const openExternal = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn() as unknown as typeof globalThis.fetch;
  const recordDiagnostic = vi.fn();
  const { cookies } = memoryCookies();
  const coordinator = new ElectronAuthCoordinator({
    expectedRendererOrigin: 'http://127.0.0.1:43123',
    openExternal,
    cookies,
    fetch,
    recordDiagnostic,
    createAuthClient,
  });

  return {
    coordinator,
    cookies,
    createAuthClient,
    signInWithGoogle,
    exchangeCode,
    installSession,
    openExternal,
    fetch,
    recordDiagnostic,
  };
}

function jwt(exp: number): string {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp })}.signature`;
}

describe('ElectronAuthCoordinator', () => {
  it('runs the real Supabase PKCE exchange into the renderer cookie jar', async () => {
    const { cookies, values } = memoryCookies();
    const accessToken = jwt(Math.floor(Date.now() / 1_000) + 3_600);
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: accessToken,
          refresh_token: 'refresh-token',
          token_type: 'bearer',
          expires_in: 3_600,
          user: {
            id: 'user-1',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'operator@example.com',
            app_metadata: {},
            user_metadata: {},
            identities: [],
            created_at: new Date().toISOString(),
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const coordinator = new ElectronAuthCoordinator({
      expectedRendererOrigin: 'http://127.0.0.1:43123',
      openExternal,
      cookies,
      fetch,
    });

    await coordinator.startGoogle(startConfig);
    const authorizeUrl = new URL(openExternal.mock.calls[0][0]);
    expect(authorizeUrl.searchParams.get('provider')).toBe('google');
    expect(authorizeUrl.searchParams.get('redirect_to')).toBe(
      startConfig.redirectTo
    );
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('s256');
    expect(
      [...values.keys()].some(name => name.includes('code-verifier'))
    ).toBe(true);

    await coordinator.exchangeCode('one-time-code');

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0][0])).toContain(
      '/auth/v1/token?grant_type=pkce'
    );
    expect(
      [...values.keys()].some(name => name.includes('code-verifier'))
    ).toBe(false);
    expect([...values.keys()].some(name => name.includes('auth-token'))).toBe(
      true
    );
  });

  it('opens the generated system-browser URL from a cookie-backed client', async () => {
    const {
      coordinator,
      createAuthClient,
      signInWithGoogle,
      openExternal,
      fetch,
    } = setup();

    await coordinator.startGoogle(startConfig);

    expect(createAuthClient).toHaveBeenCalledWith({
      supabaseUrl: startConfig.supabaseUrl,
      supabaseAnonKey: startConfig.supabaseAnonKey,
      cookies: expect.objectContaining({
        getAll: expect.any(Function),
        setAll: expect.any(Function),
      }),
      fetch,
    });
    expect(signInWithGoogle).toHaveBeenCalledWith(startConfig.redirectTo);
    expect(openExternal).toHaveBeenCalledWith(
      'https://project.supabase.co/auth/v1/authorize'
    );
  });

  it('exchanges the callback only once', async () => {
    const { coordinator, exchangeCode } = setup();
    await coordinator.startGoogle(startConfig);

    await expect(coordinator.exchangeCode('one-time-code')).resolves.toBe(
      undefined
    );
    expect(exchangeCode).toHaveBeenCalledWith('one-time-code');
    await expect(coordinator.exchangeCode('replay')).rejects.toThrow(
      'No Google sign-in is pending'
    );
  });

  it('emits correlated lifecycle diagnostics without auth code values', async () => {
    const { coordinator, recordDiagnostic } = setup();
    await coordinator.startGoogle(startConfig);
    await coordinator.exchangeCode('one-time-code');

    const events = recordDiagnostic.mock.calls.map(([event]) => event);
    expect(events).toEqual([
      'auth.flow.start',
      'auth.flow.authorization_url_ready',
      'auth.flow.browser_opened',
      'auth.flow.exchange_start',
      'auth.flow.exchange_complete',
    ]);
    const serialized = JSON.stringify(recordDiagnostic.mock.calls);
    expect(serialized).not.toContain('one-time-code');
    expect(recordDiagnostic).toHaveBeenCalledWith(
      'auth.flow.exchange_start',
      expect.objectContaining({
        flowId: expect.any(String),
        codeLength: 13,
      })
    );
  });

  it('installs test sessions through the same main-process client', async () => {
    const { coordinator, installSession } = setup();

    await coordinator.installSession(
      {
        supabaseUrl: startConfig.supabaseUrl,
        supabaseAnonKey: startConfig.supabaseAnonKey,
      },
      { accessToken: 'access-token', refreshToken: 'refresh-token' }
    );

    expect(installSession).toHaveBeenCalledWith({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });
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
