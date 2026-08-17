import { describe, expect, it, vi } from 'vitest';
import {
  AUTH_CALLBACK_FAILURES,
  AUTH_LINK_OUTCOMES,
} from '@/components/auth/callback-failures';
import {
  callbackFailureDetail,
  handleAuthCallback,
  safeNextPath,
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
  const logFailure = vi.fn();
  const deps: AuthCallbackDependencies = {
    createSupabaseClient: async () => ({ auth: { exchangeCodeForSession } }),
    logFailure,
  };
  return { deps, exchangeCodeForSession, logFailure };
}

function location(response: Response): URL {
  const header = response.headers.get('location');
  expect(header).toBeTruthy();
  return new URL(header!);
}

describe('/auth/callback exchange outcome', () => {
  it('lands a successful exchange on the workspace', async () => {
    const { deps, exchangeCodeForSession, logFailure } = dependencies({
      error: null,
    });

    const response = await handleAuthCallback(callback('?code=good'), deps);

    expect(exchangeCodeForSession).toHaveBeenCalledWith('good');
    expect(location(response).href).toBe('https://app.test/workspace');
    expect(logFailure).not.toHaveBeenCalled();
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

  it('surfaces a rejected exchange as a code, keeping the provider text in the log', async () => {
    const message =
      'invalid request: both auth code and code verifier should be non-empty';
    const { deps, logFailure } = dependencies({ error: { message } });

    const response = await handleAuthCallback(callback('?code=stale'), deps);

    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('exchange_rejected');
    // the provider's words never ride the URL, but stay diagnosable
    expect(target.search).not.toContain('verifier');
    expect(logFailure).toHaveBeenCalledWith('exchange_rejected', message);
  });

  it('distinguishes a thrown exchange from a rejected one', async () => {
    const { deps, logFailure } = dependencies(new Error('fetch failed'));

    const response = await handleAuthCallback(callback('?code=stale'), deps);

    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('exchange_failed');
    expect(logFailure).toHaveBeenCalledWith('exchange_failed', 'fetch failed');
  });

  it('reports a provider refusal without attempting an exchange', async () => {
    const { deps, exchangeCodeForSession, logFailure } = dependencies({
      error: null,
    });

    const response = await handleAuthCallback(
      callback(
        '?error=access_denied&error_description=User%20refused%20access'
      ),
      deps
    );

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('provider_refused');
    expect(logFailure).toHaveBeenCalledWith(
      'provider_refused',
      'User refused access'
    );
  });

  it('reports a callback that carried no code at all', async () => {
    const { deps, exchangeCodeForSession, logFailure } = dependencies({
      error: null,
    });

    const response = await handleAuthCallback(callback(''), deps);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    const target = location(response);
    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('missing_code');
    expect(logFailure).toHaveBeenCalledWith(
      'missing_code',
      'callback carried no authorization code'
    );
  });

  it('returns the accountless route as absent before interpreting callback input', async () => {
    const logFailure = vi.fn();
    const response = await handleAuthCallback(callback('?code=good'), {
      createSupabaseClient: async () => null,
      logFailure,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get('location')).toBeNull();
    expect(logFailure).not.toHaveBeenCalled();
  });
});

describe('the ?error= channel is closed', () => {
  it('never emits anything but a declared failure code', async () => {
    const attempts: Array<{
      query: string;
      result: Parameters<typeof dependencies>[0];
    }> = [
      {
        query: '?error=Your%20account%20is%20suspended,%20call%20555-0100',
        result: { error: null },
      },
      { query: '', result: { error: null } },
      {
        query: '?code=stale',
        result: { error: { message: 'Call 555-0100 to reactivate' } },
      },
      { query: '?code=stale', result: new Error('Call 555-0100') },
    ];

    for (const attempt of attempts) {
      const { deps } = dependencies(attempt.result);
      const response = await handleAuthCallback(callback(attempt.query), deps);
      const target = location(response);
      const emitted = target.searchParams.get('error');

      expect(AUTH_CALLBACK_FAILURES).toContain(emitted);
      expect(target.search).not.toContain('555');
      // a code and nothing else — no second parameter smuggling the prose
      expect([...target.searchParams.keys()]).toEqual(['error']);
    }
  });
});

describe('server-side failure detail', () => {
  it('collapses whitespace and bounds the length', () => {
    expect(callbackFailureDetail(' two\n\nlines ')).toBe('two lines');
    expect(callbackFailureDetail('x'.repeat(600))).toHaveLength(400);
  });

  it('is empty rather than invented when the cause says nothing', () => {
    expect(callbackFailureDetail({ message: null })).toBe('');
    expect(callbackFailureDetail(undefined)).toBe('');
  });
});

describe('an identity link is not a sign-in attempt', () => {
  it('reads "already linked" as the state the operator wanted', async () => {
    const { deps, exchangeCodeForSession, logFailure } = dependencies({
      error: null,
    });

    const response = await handleAuthCallback(
      callback(
        '?intent=link&next=%2Fleaderboard&error=server_error' +
          '&error_code=identity_already_exists' +
          '&error_description=Identity%20is%20already%20linked'
      ),
      deps
    );

    const target = location(response);
    expect(target.pathname).toBe('/leaderboard');
    expect(target.searchParams.get('link')).toBe('already_linked');
    // it is a success: no error channel, and nothing to diagnose
    expect(target.searchParams.get('error')).toBeNull();
    expect(logFailure).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('separates an identity held by someone else from one already yours', async () => {
    const { deps, logFailure } = dependencies({ error: null });

    const response = await handleAuthCallback(
      callback(
        '?intent=link&next=%2Fleaderboard&error_code=identity_already_exists' +
          '&error_description=Identity%20is%20already%20linked%20to%20another%20user'
      ),
      deps
    );

    const target = location(response);
    expect(target.pathname).toBe('/leaderboard');
    expect(target.searchParams.get('link')).toBe('link_claimed');
    expect(logFailure).toHaveBeenCalledWith(
      'link_claimed',
      'Identity is already linked to another user'
    );
  });

  it('never sends a link failure to the sign-in card', async () => {
    const attempts = [
      '?intent=link&next=%2Fleaderboard&error=access_denied',
      '?intent=link&next=%2Fleaderboard',
      '?intent=link&next=%2Fleaderboard&code=stale',
    ];

    for (const query of attempts) {
      const { deps } = dependencies({ error: { message: 'nope' } });
      const target = location(await handleAuthCallback(callback(query), deps));

      expect(target.pathname).not.toBe('/sign-in');
      expect(target.pathname).toBe('/leaderboard');
      expect(target.searchParams.get('error')).toBeNull();
      expect(AUTH_LINK_OUTCOMES).toContain(target.searchParams.get('link'));
    }
  });

  it('reports a completed link on the surface that started it', async () => {
    const { deps, exchangeCodeForSession } = dependencies({ error: null });

    const response = await handleAuthCallback(
      callback('?intent=link&next=%2Fleaderboard&code=good'),
      deps
    );

    expect(exchangeCodeForSession).toHaveBeenCalledWith('good');
    const target = location(response);
    expect(target.pathname).toBe('/leaderboard');
    expect(target.searchParams.get('link')).toBe('linked');
  });

  it('keeps the sign-in card for sign-in callbacks that carry the same next', async () => {
    const { deps } = dependencies({ error: null });

    const target = location(
      await handleAuthCallback(
        callback('?next=%2Fleaderboard&error=access_denied'),
        deps
      )
    );

    expect(target.pathname).toBe('/sign-in');
    expect(target.searchParams.get('error')).toBe('provider_refused');
  });

  it('emits only declared outcomes, never the provider text', async () => {
    const { deps } = dependencies({ error: null });

    const target = location(
      await handleAuthCallback(
        callback(
          '?intent=link&next=%2Fleaderboard' +
            '&error_description=Your%20account%20is%20suspended,%20call%20555-0100'
        ),
        deps
      )
    );

    expect(AUTH_LINK_OUTCOMES).toContain(target.searchParams.get('link'));
    expect(target.search).not.toContain('555');
    expect([...target.searchParams.keys()]).toEqual(['link']);
  });
});

describe('next is not an open redirect', () => {
  it('keeps a link attempt on this origin whatever next claims', async () => {
    const hostile = [
      '%2F%2Fevil.test',
      'https%3A%2F%2Fevil.test',
      '%2F%5Cevil.test',
      '%2F%09%2Fevil.test',
      '%09%2F%2Fevil.test',
    ];

    for (const next of hostile) {
      const { deps } = dependencies({ error: null });
      const target = location(
        await handleAuthCallback(
          callback(`?intent=link&next=${next}&code=good`),
          deps
        )
      );

      expect(target.origin).toBe('https://app.test');
      expect(target.pathname).toBe('/leaderboard');
    }
  });

  it('rejects the shapes a URL parser would fold into an authority', () => {
    expect(safeNextPath('/leaderboard', '/fallback')).toBe('/leaderboard');
    expect(safeNextPath('/\\evil.test', '/fallback')).toBe('/fallback');
    expect(safeNextPath('/\t/evil.test', '/fallback')).toBe('/fallback');
    expect(safeNextPath('//evil.test', '/fallback')).toBe('/fallback');
    expect(safeNextPath('https://evil.test', '/fallback')).toBe('/fallback');
    expect(safeNextPath('/lead er', '/fallback')).toBe('/fallback');
    expect(safeNextPath(null, '/fallback')).toBe('/fallback');
  });
});
