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

/** The sync executor has its own suites (`src/lib/operator-stats`); here the
 *  panel is a pure status surface over a drivable store. */
interface FakeSyncState {
  phase: 'idle' | 'syncing';
  lastOutcome: string | null;
  lastFailure: string | null;
  lastSyncedAt: number | null;
  lastSnapshot: {
    runs: number;
    agentMs: number;
    normalizedTokens: number;
  } | null;
}

const { syncStore, runSync } = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const initial = () => ({
    phase: 'idle' as const,
    lastOutcome: null,
    lastFailure: null,
    lastSyncedAt: null,
    lastSnapshot: null,
  });
  const store = {
    state: initial() as FakeSyncState,
    listeners,
    set(patch: Partial<FakeSyncState>) {
      store.state = { ...store.state, ...patch };
      for (const listener of listeners) listener();
    },
    reset() {
      store.state = initial();
      listeners.clear();
    },
  };
  return {
    syncStore: store,
    runSync: vi.fn(async () => ({ outcome: 'synced', snapshot: null })),
  };
});

vi.mock('@/lib/operator-stats/auto-sync', () => ({
  hydrateOperatorStatsSyncState: vi.fn(),
  readOperatorStatsSyncState: () => syncStore.state,
  subscribeOperatorStatsSync: (listener: () => void) => {
    syncStore.listeners.add(listener);
    return () => syncStore.listeners.delete(listener);
  },
  runOperatorStatsSync: runSync,
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

function buildClient(
  options: {
    identities?: unknown[];
    linkIdentity?: () => Promise<unknown>;
  } = {}
) {
  const answer =
    options.linkIdentity ?? (async () => ({ data: {}, error: null }));
  const linkIdentity = vi.fn(async (_credentials: LinkCredentials) => answer());
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
    onError: vi.fn(
      (handler: (error: { name: string; message: string }) => void) => {
        handlers.error = handler;
        return () => {};
      }
    ),
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

/** The full desktop context: Electron bridge with a settings store, a linked
 *  GitHub identity, and a signed-in session — where the switch lives. */
function electronPanel(
  options: { autoPublish?: boolean; published?: boolean } = {}
) {
  client.current = buildClient({ identities: [GITHUB_IDENTITY] });
  let settings: Record<string, unknown> =
    options.autoPublish === undefined && options.published === undefined
      ? {}
      : {
          operatorProfile: {
            ...(options.autoPublish === undefined
              ? {}
              : { autoPublish: options.autoPublish }),
            ...(options.published === undefined
              ? {}
              : { profileEnabled: options.published }),
          },
        };
  const settingsListeners = new Set<(next: unknown) => void>();
  const bridge = {
    get: vi.fn(async () => settings),
    onChanged: vi.fn((handler: (next: unknown) => void) => {
      settingsListeners.add(handler);
      return () => settingsListeners.delete(handler);
    }),
    setOperatorAutoPublish: vi.fn(async (enabled: boolean) => {
      settings = {
        ...settings,
        operatorProfile: {
          ...((settings.operatorProfile as object | undefined) ?? {}),
          autoPublish: enabled,
        },
      };
      for (const listener of settingsListeners) listener(settings);
      return settings;
    }),
    recordOperatorProfileState: vi.fn(
      async (state: Record<string, unknown>) => {
        settings = {
          ...settings,
          operatorProfile: {
            ...((settings.operatorProfile as object | undefined) ?? {}),
            ...state,
          },
        };
        for (const listener of settingsListeners) listener(settings);
        return settings;
      }
    ),
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: {
      isElectron: true,
      auth: {
        onComplete: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
        onLinkOutcome: vi.fn(() => () => {}),
      },
      settings: bridge,
    },
  });
  return { settingsBridge: bridge };
}

beforeEach(() => {
  client.current = buildClient();
  at('/leaderboard');
  syncStore.reset();
  runSync.mockClear();
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
  vi.unstubAllGlobals();
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
      .mockResolvedValue({
        data: { identities: [GITHUB_IDENTITY] },
        error: null,
      });

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
      .mockResolvedValue({
        data: { identities: [GITHUB_IDENTITY] },
        error: null,
      });

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
    const linkGithub = vi
      .fn()
      .mockRejectedValue(
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
      .mockResolvedValue({
        data: { identities: [GITHUB_IDENTITY] },
        error: null,
      });

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

/* ------------------------------------------------------------------ *
 * ENG-035 — publishing as a durable preference. The panel is a status
 * surface: one switch, honest state, no preview ritual.
 * ------------------------------------------------------------------ */

describe('the preview ritual is gone', () => {
  it('offers no preview or one-shot publish action in any state', async () => {
    electronPanel({ autoPublish: true, published: true });

    await mount();

    expect(screen.queryByText('Preview local stats')).toBeNull();
    expect(screen.queryByText('Refresh preview')).toBeNull();
    expect(screen.queryByText('Publish my profile')).toBeNull();
    expect(screen.getByRole('switch')).toBeTruthy();
  });
});

describe('publishing paused (the off state)', () => {
  it('defaults off with the consent disclosure inline — absent means paused', async () => {
    electronPanel(); // no preference recorded at all

    await mount();

    const publishing = screen.getByRole('switch', {
      name: 'Publishing paused',
    });
    expect(publishing).toHaveAttribute('aria-checked', 'false');
    // The disclosure IS the consent surface: what is shared, what never is,
    // and that recording starts at the flip with no backfill.
    expect(
      screen.getByText(/aggregate daily totals and Run records/)
    ).toBeTruthy();
    expect(screen.getByText(/never leave this machine/)).toBeTruthy();
    expect(
      screen.getByText(/earlier local history is not uploaded/)
    ).toBeTruthy();
    // Nothing to sync and nothing to remove while off and unpublished.
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Remove public profile' })
    ).toBeNull();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('tells a published owner the profile stays visible and stops updating', async () => {
    electronPanel({ autoPublish: false, published: true });

    await mount();

    expect(
      screen.getByText(
        'Paused — your profile stays visible and stops updating.'
      )
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove public profile' })
    ).toBeTruthy();
    // He consented already; re-enabling resumes from the original anchor, so
    // the first-consent "recording starts now" paragraph would be false here.
    expect(
      screen.queryByText(/earlier local history is not uploaded/)
    ).toBeNull();
  });
});

describe('flipping publishing on', () => {
  it('records the preference and starts a sync — the consent act', async () => {
    const { settingsBridge } = electronPanel();

    await mount();
    await act(async () => {
      screen.getByRole('switch', { name: 'Publishing paused' }).click();
    });

    expect(settingsBridge.setOperatorAutoPublish).toHaveBeenCalledWith(true);
    expect(runSync).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('switch', { name: 'Publishing on' })
    ).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
  });

  it('turns off without syncing — paused means paused', async () => {
    const { settingsBridge } = electronPanel({ autoPublish: true });

    await mount();
    await act(async () => {
      screen.getByRole('switch', { name: 'Publishing on' }).click();
    });

    expect(settingsBridge.setOperatorAutoPublish).toHaveBeenCalledWith(false);
    expect(runSync).not.toHaveBeenCalled();
    expect(
      screen.getByRole('switch', { name: 'Publishing paused' })
    ).toHaveAttribute('aria-checked', 'false');
  });
});

describe('honest sync status while publishing is on', () => {
  it('shows syncing and holds Sync now while a sync runs', async () => {
    electronPanel({ autoPublish: true });

    await mount();
    act(() => syncStore.set({ phase: 'syncing' }));

    expect(screen.getByText('Syncing…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  it('shows up to date with the last-synced time and the local aggregate', async () => {
    electronPanel({ autoPublish: true, published: true });

    await mount();
    act(() =>
      syncStore.set({
        phase: 'idle',
        lastOutcome: 'synced',
        lastSyncedAt: Date.now(),
        lastSnapshot: {
          runs: 12,
          agentMs: 10_908_000,
          normalizedTokens: 52_200_000,
        },
      })
    );

    expect(screen.getByText(/Up to date · synced /)).toBeTruthy();
    expect(screen.getByText(/12 Runs · 3.0 agent hours ·/)).toBeTruthy();
  });

  it('identifies a local scan failure and that it retries on its own', async () => {
    electronPanel({ autoPublish: true, published: true });

    await mount();
    act(() =>
      syncStore.set({
        phase: 'idle',
        lastOutcome: 'failed',
        lastFailure: 'local-scan',
      })
    );

    expect(
      screen.getByText(
        'Local usage scan failed. Sync will retry automatically.'
      )
    ).toBeTruthy();
  });

  it('lets impatience trigger the same coalesced sync', async () => {
    electronPanel({ autoPublish: true, published: true });

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Sync now' }).click();
    });

    expect(runSync).toHaveBeenCalledTimes(1);
  });
});

describe('a missing GitHub link surfaces instead of freezing silently', () => {
  it('says publishing is waiting for GitHub when on but unlinked', async () => {
    electronPanel({ autoPublish: true });
    client.current = buildClient({ identities: [] });

    await mount();

    expect(screen.getByText('Claim your operator identity')).toBeTruthy();
    expect(
      screen.getByText(/Publishing is on and waiting for GitHub/)
    ).toBeTruthy();
  });
});

describe('removing the public profile stays a distinct act', () => {
  it('takes the profile down AND pauses publishing so a sync cannot resurrect it', async () => {
    const { settingsBridge } = electronPanel({
      autoPublish: true,
      published: true,
    });
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await mount();
    await act(async () => {
      screen.getByRole('button', { name: 'Remove public profile' }).click();
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/operator-stats',
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(settingsBridge.recordOperatorProfileState).toHaveBeenCalledWith({
      profileEnabled: false,
    });
    expect(settingsBridge.setOperatorAutoPublish).toHaveBeenCalledWith(false);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Public profile removed. Local history was not changed.'
    );
  });
});
