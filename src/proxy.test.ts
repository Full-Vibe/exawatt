/**
 * Offline authority for the middleware (ENG-016 D18): the Electron shell
 * navigates public surfaces (workspace, fleet, settings, …) through this
 * proxy on EVERY route change. Those paths must never touch the network —
 * on a plane, a blocking `getUser()` here turned ⌘2 into a black screen.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

const { distribution } = vi.hoisted(() => ({
  distribution: {
    account: {
      supabaseUrl: 'https://unit-test.supabase.co',
      supabaseAnonKey: 'unit-test-anon-key',
      recoveryOrigin: 'https://app.test',
    } as {
      supabaseUrl: string;
      supabaseAnonKey: string;
      recoveryOrigin: string;
    } | null,
  },
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

const published = vi.hoisted(() => ({
  read: vi.fn(
    async (): Promise<
      | { status: 'known'; version: string }
      | { status: 'unknown'; reason: string }
    > => ({ status: 'known', version: '0.1.22' })
  ),
}));

vi.mock('@/lib/changelog/published-version', () => ({
  readPublishedVersion: published.read,
}));

beforeEach(() => {
  distribution.account = {
    supabaseUrl: 'https://unit-test.supabase.co',
    supabaseAnonKey: 'unit-test-anon-key',
    recoveryOrigin: 'https://app.test',
  };
});

afterEach(() => {
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
      email: 'unit@source.test',
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
    '/api/context-labels',
    '/api/feedback',
    '/api/goal-visuals',
    '/api/operator-stats',
    '/leaderboard?metric=agent-hours&window=week',
    // Hard-cut routes: middleware must let Next serve its 404, not
    // auth-redirect. `/v2` and `/old` were the band homepage (ENG-031 W31).
    '/agentmaxxing',
    '/v2',
    '/old',
    '/operator/jakesc',
    '/run/run_0ba96afb076e97c3f76b5384',
    // ENG-031 W26: the guides were a 307 to /sign-in before they had a route.
    '/guides',
    '/guides/agents-review-each-other',
    '/',
  ])('never performs network I/O for public path %s', async path => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call from a public-path navigation');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request(path));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it('lets the analytics ingest proxy through while signed out', async () => {
    // Regression: `/ingest` is a `next.config.ts` rewrite, not a route, so it
    // was not on the public list and the gate answered every analytics
    // request with a 307 to /sign-in. Emission is fire-and-forget, so nothing
    // surfaced the failure — production collected zero events silently
    // (2026-08-06). Decision `0034` requires this path to work signed out.
    const fetchSpy = vi.fn(() => {
      throw new Error('network call while serving the ingest proxy');
    });
    vi.stubGlobal('fetch', fetchSpy);

    for (const path of ['/ingest/i/v0/e/', '/ingest/static/array.js']) {
      const response = await proxy(request(path));
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    }
  });

  it('redirects signed-out users away from protected paths without network', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call while deciding a cookie-less redirect');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request('/admin'));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/sign-in');
    expect(
      new URL(response.headers.get('location')!).searchParams.get('next')
    ).toBe('/admin');
  });

  it('ignores a stale account cookie when the distribution has no account transport', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call from an accountless distribution');
    });
    vi.stubGlobal('fetch', fetchSpy);
    distribution.account = null;

    const response = await proxy(request('/admin', sessionCookie()));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/sign-in');
  });

  it('fails open on protected paths when validation cannot reach the network', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    vi.stubGlobal('fetch', fetchSpy);

    const response = await proxy(request('/admin', sessionCookie()));

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

    const response = await proxy(request('/admin', sessionCookie()));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get('location')).toContain('/sign-in');
  });
});

describe('changelog drafts (ENG-031 W25)', () => {
  const rewriteOf = (response: Response) =>
    response.headers.get('x-middleware-rewrite');

  it("answers a draft entry's page with the not-found route", async () => {
    const response = await proxy(request('/changelog/0.1.23'));
    expect(rewriteOf(response)).toMatch(/\/changelog\/unpublished$/u);
  });

  it('serves a published entry and the index untouched', async () => {
    for (const path of [
      '/changelog/0.1.22',
      '/changelog/0.1.17',
      '/changelog',
    ]) {
      expect(rewriteOf(await proxy(request(path))), path).toBeNull();
    }
  });

  it('lets the page decide when the feed cannot be read', async () => {
    published.read.mockResolvedValueOnce({
      status: 'unknown',
      reason: 'HTTP 503',
    });
    expect(rewriteOf(await proxy(request('/changelog/0.1.23')))).toBeNull();
  });

  it('asks the feed only for a changelog entry path', async () => {
    published.read.mockClear();
    await proxy(request('/workspace'));
    await proxy(request('/changelog'));
    expect(published.read).not.toHaveBeenCalled();
  });
});
