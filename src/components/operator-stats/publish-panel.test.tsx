import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishPanel } from './publish-panel';
import {
  GENERIC_LINK_FAILURE,
  LINK_FAILURE_MESSAGES,
  LINK_SUCCESS_MESSAGES,
} from '@/components/auth/callback-failures';

const { client } = vi.hoisted(() => ({
  client: { current: null as ReturnType<typeof buildClient> | null },
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => client.current,
}));

vi.mock('@/lib/tenancy/tenancy-provider', () => ({
  useOptionalWorkspaceTenancy: () => null,
}));

const GITHUB_IDENTITY = {
  identity_id: 'identity-1',
  id: 'gh-1',
  user_id: 'user-1',
  provider: 'github',
  identity_data: { user_name: 'operator', full_name: 'The Operator' },
  created_at: '2026-08-07T00:00:00.000Z',
  updated_at: '2026-08-07T00:00:00.000Z',
};

const SESSION = {
  access_token: 'header.payload.signature',
  refresh_token: 'renderer-refresh-token',
  // the session's own snapshot predates the link — the panel must not trust it
  user: { id: 'user-1', identities: [] },
};

interface LinkCredentials {
  provider: string;
  options: { redirectTo: string };
}

function buildClient(options: {
  identities?: unknown[];
  linkIdentity?: () => Promise<unknown>;
} = {}) {
  const answer =
    options.linkIdentity ?? (async () => ({ data: {}, error: null }));
  const linkIdentity = vi.fn(async (_credentials: LinkCredentials) =>
    answer()
  );
  const getUserIdentities = vi.fn(async () => ({
    data: { identities: options.identities ?? [] },
    error: null,
  }));
  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SESSION } })),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
      getUserIdentities,
      linkIdentity,
    },
  };
}

function electronAuth(linkGithub: ReturnType<typeof vi.fn>) {
  const handlers: {
    complete?: () => void;
    error?: (error: { name: string; message: string }) => void;
    linkOutcome?: (outcome: string) => void;
  } = {};
  const auth = {
    startGoogle: vi.fn(),
    linkGithub,
    onComplete: vi.fn((handler: () => void) => {
      handlers.complete = handler;
      return () => {};
    }),
    onError: vi.fn((handler: (error: { name: string; message: string }) => void) => {
      handlers.error = handler;
      return () => {};
    }),
    onLinkOutcome: vi.fn((handler: (outcome: string) => void) => {
      handlers.linkOutcome = handler;
      return () => {};
    }),
  };
  Object.defineProperty(window, 'electron', {
    value: { isElectron: true, auth },
    configurable: true,
    writable: true,
  });
  return { auth, handlers };
}

async function mount() {
  render(<PublishPanel />);
  await act(async () => {});
}

function at(path: string) {
  window.history.replaceState(null, '', path);
}

beforeEach(() => {
  client.current = buildClient();
  at('/leaderboard');
  Object.defineProperty(window, 'electron', {
    value: undefined,
    configurable: true,
    writable: true,
  });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-anon-key';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('an already-linked GitHub reads as done, not failed', () => {
  it('shows the identity as linked when the callback says it already was', async () => {
    client.current = buildClient({ identities: [GITHUB_IDENTITY] });
    at('/leaderboard?link=already_linked');

    await mount();

    expect(screen.getByRole('status')).toHaveTextContent(
      LINK_SUCCESS_MESSAGES.already_linked
    );
    expect(screen.queryByRole('alert')).toBeNull();
    // past the "link GitHub first" gate entirely
    expect(screen.queryByText('Claim your operator identity')).toBeNull();
    expect(screen.getByText('Publish from Exawatt desktop')).toBeTruthy();
  });

  it('does not start a second flow for a link that already succeeded', async () => {
    client.current = buildClient({ identities: [GITHUB_IDENTITY] });
    // the panel opened before the link, so its own session still says unlinked
    client.current.auth.getUserIdentities = vi
      .fn()
      .mockResolvedValueOnce({ data: { identities: [] }, error: null })
      .mockResolvedValue({ data: { identities: [GITHUB_IDENTITY] }, error: null });

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });

    expect(client.current.auth.linkIdentity).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      LINK_SUCCESS_MESSAGES.already_linked
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats Supabase’s own already-linked refusal as success', async () => {
    client.current = buildClient({
      linkIdentity: async () => ({
        data: {},
        error: {
          name: 'AuthApiError',
          message: 'Identity is already linked',
          code: 'identity_already_exists',
        },
      }),
    });
    client.current.auth.getUserIdentities = vi
      .fn()
      .mockResolvedValueOnce({ data: { identities: [] }, error: null })
      .mockResolvedValue({ data: { identities: [GITHUB_IDENTITY] }, error: null });

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      LINK_SUCCESS_MESSAGES.already_linked
    );
  });

  it('re-reads the identity from the server, not from the stale session', async () => {
    client.current = buildClient({ identities: [GITHUB_IDENTITY] });

    await mount();

    expect(client.current.auth.getUserIdentities).toHaveBeenCalled();
    expect(screen.queryByText('Claim your operator identity')).toBeNull();
  });
});

describe('a genuine link failure reports on the panel', () => {
  it('renders this product’s words, on this surface', async () => {
    at('/leaderboard?link=link_claimed');

    await mount();

    expect(screen.getByRole('alert')).toHaveTextContent(
      LINK_FAILURE_MESSAGES.link_claimed
    );
    expect(screen.getByText('Claim your operator identity')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Link GitHub' })).toBeTruthy();
  });

  it('renders only declared copy for an outcome it does not know', async () => {
    at('/leaderboard?link=Your%20account%20is%20suspended,%20call%20555-0100');

    await mount();

    expect(screen.getByRole('alert')).toHaveTextContent(GENERIC_LINK_FAILURE);
    expect(document.body.textContent).not.toContain('555');
  });

  it('consumes the verdict so a reload does not replay it', async () => {
    at('/leaderboard?link=link_failed');

    await mount();

    expect(window.location.search).toBe('');
  });
});

describe('the desktop path lands on the panel too', () => {
  it('reports a missing main-process session in product voice', async () => {
    const linkGithub = vi.fn().mockRejectedValue(
      new Error(
        "Error invoking remote method 'auth:link-github': " +
          'AuthSessionMissingError: Auth session missing!'
      )
    );
    electronAuth(linkGithub);

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      LINK_FAILURE_MESSAGES.link_signed_out
    );
    expect(document.body.textContent).not.toContain('AuthSessionMissingError');
    expect(document.body.textContent).not.toContain('auth:link-github');
  });

  it('hands the live session to main, which has none of its own', async () => {
    const linkGithub = vi.fn().mockResolvedValue(undefined);
    electronAuth(linkGithub);

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });

    expect(linkGithub).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectTo: `${window.location.origin}/auth/electron-callback`,
        session: {
          accessToken: SESSION.access_token,
          refreshToken: SESSION.refresh_token,
        },
      })
    );
  });

  it('reads a deep-linked already-linked outcome as success', async () => {
    const { handlers } = electronAuth(vi.fn());
    client.current = buildClient();
    client.current.auth.getUserIdentities = vi
      .fn()
      .mockResolvedValueOnce({ data: { identities: [] }, error: null })
      .mockResolvedValue({ data: { identities: [GITHUB_IDENTITY] }, error: null });

    await mount();
    await act(async () => {
      handlers.linkOutcome?.('already_linked');
    });

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(
      LINK_SUCCESS_MESSAGES.already_linked
    );
    expect(screen.queryByText('Claim your operator identity')).toBeNull();
  });

  it('never prints a raw provider error from the desktop error channel', async () => {
    const linkGithub = vi.fn().mockResolvedValue(undefined);
    const { handlers } = electronAuth(linkGithub);

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });
    await act(async () => {
      handlers.error?.({
        name: 'AuthApiError',
        message: 'Your account is suspended, call 555-0100',
      });
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      LINK_FAILURE_MESSAGES.link_failed
    );
    expect(document.body.textContent).not.toContain('555');
  });
});

describe('the web flow returns to the surface that started it', () => {
  it('asks the callback for a link intent back to this page', async () => {
    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Link GitHub' }).click();
    });

    const [request] = client.current!.auth.linkIdentity.mock.calls[0];
    const redirect = new URL(request.options.redirectTo);
    expect(request.provider).toBe('github');
    expect(redirect.pathname).toBe('/auth/callback');
    expect(redirect.searchParams.get('intent')).toBe('link');
    expect(redirect.searchParams.get('next')).toBe('/leaderboard');
  });
});
