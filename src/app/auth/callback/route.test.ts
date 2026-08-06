import { describe, expect, it, vi } from 'vitest';
import {
  describeCallbackFailure,
  handleAuthCallback,
  type AuthCallbackDependencies,
} from './route';

function callback(query: string): Request {
  return new Request(`https://app.test/auth/callback${query}`);
}

function dependencies(
  result: { error: { message?: string | null } | null } | Error
) {
  const exchangeCodeForSession = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const deps: AuthCallbackDependencies = {
    createSupabaseClient: async () => ({ auth: { exchangeCodeForSession } }),
  };
  return { deps, exchangeCodeForSession };
}

function location(response: Response): URL {
  const header = response.headers.get('location');
  expect(header).toBeTruthy();
  return new URL(header!);
}

describe('/auth/callback exchange outcome', () => {
  it('lands a successful exchange on the workspace', async () => {
    const { deps, exchangeCodeForSession } = dependencies({ error: null });

    const response = await handleAuthCallback(callback('?code=good'), deps);

    expect(exchangeCodeForSession).toHaveBeenCalledWith('good');
    expect(location(response).href).toBe('https://app.test/workspace');
  });

  it('honours a safe next target and ignores an off-site one', async () => {
    const { deps } = dependencies({ error: null });

    const inApp = await handleAuthCallback(
      callback('?code=good&next=%2Fauth%2Fupdate-password'),
      deps
    );
    expect(location(inApp).pathname).toBe('/auth/update-password');

    const offSite = await handleAuthCallback(
      callback('?code=good&next=%2F%2Fevil.test'),
      deps
    );
    expect(location(offSite).href).toBe('https://app.test/workspace');
  });

  it('surfaces a failed exchange on the sign-in page instead of swallowing it', async () => {
    const { deps } = dependencies({
      error: { message: 'invalid request: both auth code and code verifier should be non-empty' },
    });

    const response = await handleAuthCallback(callback('?code=stale'), deps);

    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe(
      'invalid request: both auth code and code verifier should be non-empty'
    );
  });

  it('surfaces a thrown exchange the same way', async () => {
    const { deps } = dependencies(new Error('fetch failed'));

    const response = await handleAuthCallback(callback('?code=stale'), deps);

    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('fetch failed');
  });

  it('reports a provider refusal without attempting an exchange', async () => {
    const { deps, exchangeCodeForSession } = dependencies({ error: null });

    const response = await handleAuthCallback(
      callback('?error=access_denied&error_description=User%20refused%20access'),
      deps
    );

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('User refused access');
  });

  it('reports a callback that carried no code at all', async () => {
    const { deps, exchangeCodeForSession } = dependencies({ error: null });

    const response = await handleAuthCallback(callback(''), deps);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toMatch(/no authorization code/i);
  });
});

describe('callback failure text', () => {
  it('collapses whitespace and bounds the length', () => {
    expect(describeCallbackFailure(' two\n\nlines ')).toBe('two lines');
    expect(describeCallbackFailure('x'.repeat(400))).toHaveLength(200);
  });

  it('falls back to a plain sentence when the cause is empty', () => {
    expect(describeCallbackFailure({ message: null })).toBe(
      'Sign-in did not complete. Try again.'
    );
    expect(describeCallbackFailure(undefined)).toBe(
      'Sign-in did not complete. Try again.'
    );
  });
});
