/**
 * ENG-035 — the schedule and the coalesced live executor, in a window.
 *
 * The schedule (launch delay, six-hour interval, flip-on trigger) exists only
 * on the desktop surface, and every overlapping trigger joins one in-flight
 * sync so nothing can double-post.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OPERATOR_STATS_LAUNCH_SYNC_DELAY_MS,
  OPERATOR_STATS_SYNC_INTERVAL_MS,
  __resetOperatorStatsSyncForTests,
  readOperatorStatsSyncState,
  runOperatorStatsSync,
  startOperatorStatsAutoSync,
} from './auto-sync';

const { supabaseClient, distributionState, createOptionalClient } = vi.hoisted(
  () => ({
    supabaseClient: { current: null as unknown },
    distributionState: { current: null as unknown },
    createOptionalClient: vi.fn(() => supabaseClient.current),
  })
);

vi.mock('@/lib/supabase/client', () => ({
  createOptionalClient,
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distributionState.current,
}));

const OPERATOR_STATS_URL = 'https://services.example.test/operator-stats';

function distribution(
  operatorStats: object | null = {
    url: OPERATOR_STATS_URL,
    protocolVersion: 1,
  }
) {
  return {
    schemaVersion: 1,
    brand: null,
    account: operatorStats
      ? {
          supabaseUrl: 'https://account.example.test',
          supabaseAnonKey: 'public-anon-key',
          recoveryOrigin: 'https://app.example.test',
        }
      : null,
    services: {
      productFeedback: null,
      operatorStats,
      projects: null,
      preferences: null,
      accountData: null,
    },
    enrichment: {
      contextLabels: null,
      conversationSummaries: null,
      goalVisuals: null,
    },
    analytics: null,
    updates: null,
  };
}

const SESSION = {
  access_token: 'header.payload.signature',
  user: { id: 'user-1' },
};

const GITHUB = {
  provider: 'github',
  identity_data: { user_name: 'operator', full_name: 'The Operator' },
};

const PREVIEW = {
  schemaVersion: 1,
  consentVersion: 1,
  enabled: true,
  timezone: 'America/Los_Angeles',
  days: [],
  runs: [],
};

function installBridge(
  options: { autoPublish?: boolean; startedAt?: boolean } = {}
) {
  let settings: Record<string, unknown> =
    options.autoPublish === undefined
      ? {}
      : {
          operatorProfile: {
            autoPublish: options.autoPublish,
            ...(options.autoPublish && options.startedAt !== false
              ? { startedAt: '2026-08-10T00:00:00.000Z' }
              : {}),
          },
        };
  const listeners = new Set<(next: unknown) => void>();
  const scan = vi.fn(async () => PREVIEW);
  const bridge = {
    isElectron: true,
    platform: 'darwin',
    operatorStats: { scan },
    settings: {
      get: vi.fn(async () => settings),
      onChanged: vi.fn((handler: (next: unknown) => void) => {
        listeners.add(handler);
        return () => listeners.delete(handler);
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
          for (const listener of listeners) listener(settings);
          return settings;
        }
      ),
    },
  };
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: bridge,
  });
  return {
    scan,
    settings: bridge.settings,
    emit(next: Record<string, unknown>) {
      settings = next;
      for (const listener of listeners) listener(next);
    },
  };
}

function installSupabase() {
  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: SESSION } })),
      getUserIdentities: vi.fn(async () => ({
        data: { identities: [GITHUB] },
      })),
    },
  };
  supabaseClient.current = client;
  return client;
}

beforeEach(() => {
  distributionState.current = distribution();
  createOptionalClient.mockClear();
  window.localStorage.clear();
});

afterEach(() => {
  __resetOperatorStatsSyncForTests();
  supabaseClient.current = null;
  Reflect.deleteProperty(window, 'electron');
  vi.unstubAllGlobals();
});

describe('runOperatorStatsSync', () => {
  it('coalesces overlapping triggers into exactly one scan and one post', async () => {
    const { scan } = installBridge({ autoPublish: true });
    installSupabase();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const first = runOperatorStatsSync();
    const second = runOperatorStatsSync();
    expect(second).toBe(first);
    expect(readOperatorStatsSyncState().phase).toBe('syncing');

    const [a, b] = await Promise.all([first, second]);
    expect(a.outcome).toBe('synced');
    expect(b).toBe(a);
    expect(scan).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      OPERATOR_STATS_URL,
      expect.objectContaining({ method: 'POST' })
    );

    const state = readOperatorStatsSyncState();
    expect(state.phase).toBe('idle');
    expect(state.lastOutcome).toBe('synced');
    expect(state.lastSyncedAt).not.toBeNull();
  });

  it('is a paused no-op end to end when the preference is absent', async () => {
    const { scan } = installBridge(); // no operatorProfile key at all
    installSupabase();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runOperatorStatsSync();

    expect(result.outcome).toBe('paused');
    expect(scan).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports unavailable on surfaces without the desktop bridge', async () => {
    const result = await runOperatorStatsSync();
    expect(result.outcome).toBe('unavailable');
  });

  it('is unavailable before account auth, local scan, or fetch when the service is null', async () => {
    distributionState.current = distribution(null);
    const { scan } = installBridge({ autoPublish: true });
    const client = installSupabase();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runOperatorStatsSync();

    expect(result.outcome).toBe('unavailable');
    expect(createOptionalClient).not.toHaveBeenCalled();
    expect(client.auth.getSession).not.toHaveBeenCalled();
    expect(client.auth.getUserIdentities).not.toHaveBeenCalled();
    expect(scan).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('runs again after a finished sync rather than reusing the settled promise', async () => {
    const { scan } = installBridge({ autoPublish: true });
    installSupabase();
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await runOperatorStatsSync();
    await runOperatorStatsSync();

    expect(scan).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('uses the configured endpoint for owner GET and aggregate POST', async () => {
    installBridge({ autoPublish: true, startedAt: false });
    installSupabase();
    const fetchSpy = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => ({
        ok: true,
        status: 200,
        json: async () => ({ profile: null }),
      })
    );
    vi.stubGlobal('fetch', fetchSpy);

    const result = await runOperatorStatsSync();

    expect(result.outcome).toBe('synced');
    expect(fetchSpy.mock.calls).toEqual([
      [OPERATOR_STATS_URL, expect.objectContaining({ method: 'GET' })],
      [OPERATOR_STATS_URL, expect.objectContaining({ method: 'POST' })],
    ]);
  });
});

describe('startOperatorStatsAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not schedule anything without the desktop bridge', () => {
    const run = vi.fn(async () => ({
      outcome: 'synced' as const,
      snapshot: null,
      failure: null,
    }));

    expect(startOperatorStatsAutoSync(run)).toBeNull();

    vi.advanceTimersByTime(OPERATOR_STATS_SYNC_INTERVAL_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not schedule or read settings when the service is null', () => {
    distributionState.current = distribution(null);
    const { settings } = installBridge({ autoPublish: true });
    const run = vi.fn(async () => ({
      outcome: 'synced' as const,
      snapshot: null,
      failure: null,
    }));

    expect(startOperatorStatsAutoSync(run)).toBeNull();
    vi.advanceTimersByTime(OPERATOR_STATS_SYNC_INTERVAL_MS * 2);

    expect(settings.get).not.toHaveBeenCalled();
    expect(settings.onChanged).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs once well past launch, then on the long interval', () => {
    installBridge({ autoPublish: true });
    const run = vi.fn(async () => ({
      outcome: 'synced' as const,
      snapshot: null,
      failure: null,
    }));

    const stop = startOperatorStatsAutoSync(run);
    expect(stop).not.toBeNull();

    // Delayed past startup: nothing competes with launch.
    vi.advanceTimersByTime(OPERATOR_STATS_LAUNCH_SYNC_DELAY_MS - 1);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(OPERATOR_STATS_SYNC_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(OPERATOR_STATS_SYNC_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(3);

    stop?.();
    vi.advanceTimersByTime(OPERATOR_STATS_SYNC_INTERVAL_MS * 3);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('syncs the moment the preference flips on, from any surface', async () => {
    const { emit } = installBridge({ autoPublish: false });
    const run = vi.fn(async () => ({
      outcome: 'synced' as const,
      snapshot: null,
      failure: null,
    }));

    const stop = startOperatorStatsAutoSync(run);
    await vi.advanceTimersByTimeAsync(0); // settle the initial preference read

    emit({ operatorProfile: { autoPublish: true } });
    expect(run).toHaveBeenCalledTimes(1);

    // Repeated broadcasts of the same on-state are not new triggers.
    emit({ operatorProfile: { autoPublish: true } });
    expect(run).toHaveBeenCalledTimes(1);

    // Turning it off schedules nothing — paused means paused.
    emit({ operatorProfile: { autoPublish: false } });
    expect(run).toHaveBeenCalledTimes(1);

    emit({ operatorProfile: { autoPublish: true } });
    expect(run).toHaveBeenCalledTimes(2);
    stop?.();
  });
});
