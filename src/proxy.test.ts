/**
 * Offline authority for the middleware (ENG-016 D18): the Electron shell
 * navigates public surfaces (workspace, fleet, settings, …) through this
 * proxy on EVERY route change. Those paths must never touch the network —
 * on a plane, a blocking `getUser()` here turned ⌘2 into a black screen.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://unit-test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'unit-test-anon-key';
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(`http://127.0.0.1:7000${path}`);
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

/** A structurally valid @supabase/ssr session cookie so `getUser()` gets past
 *  cookie parsing and actually attempts its network validation. */
function sessionCookie(): Record<string, string> {
  const b64url = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const jwt = [
    b64url({ alg: 'HS256', typ: 'JWT' }),
    b64url({ sub: 'user-1', role: 'authenticated', exp, session_id: 's-1' }),
    'signature',
  ].join('.');
  const session = {
    access_token: jwt,
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_at: exp,
    expires_in: 3600,
    user: {
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'unit@test.dev',
      created_at: '',
      app_metadata: {},
      user_metadata: {},
    },
  };
  return {
    'sb-unit-test-auth-token':
      'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
  };
}

describe('proxy offline authority', () => {
  it.each([
    '/workspace',
    '/workspace?view=sessions',
    '/fleet/spatial',
    '/settings',
    '/architecture',
    '/',
  ])('never performs network I/O for public path %s', async (path) => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call from a public-path navigation');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request(path));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('redirects signed-out users away from protected paths without network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call while deciding a cookie-less redirect');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request('/dashboard'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('fails open on protected paths when validation cannot reach the network', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.reject(new TypeError('fetch failed'))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request('/dashboard', sessionCookie()));

    // A signed-in-but-offline user passes through instead of bouncing to
    // sign-in; the page's own data loads surface the offline state.
    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('still redirects when validation succeeds and reports no user', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ msg: 'invalid token' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request('/dashboard', sessionCookie()));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/sign-in');
  });
});
