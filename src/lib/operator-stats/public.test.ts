import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distribution, createClient, rpc } = vi.hoisted(() => ({
  distribution: {
    account: {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'contract-anon-key',
      recoveryOrigin: 'https://app.example.test',
    } as {
      supabaseUrl: string;
      supabaseAnonKey: string;
      recoveryOrigin: string;
    } | null,
  },
  createClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import {
  publicArenaConfigured,
  readLeaderboard,
  readOperatorProfile,
  readRunReceipt,
} from './public';

describe('public operator reads use the distribution account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'contract-anon-key',
      recoveryOrigin: 'https://app.example.test',
    };
    createClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it('returns source-neutral absence values without an account', async () => {
    distribution.account = null;

    await expect(readLeaderboard('agent-hours', 'week')).resolves.toEqual([]);
    await expect(readOperatorProfile('operator')).resolves.toBeNull();
    await expect(readRunReceipt('run-1')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  // Those absence values are indistinguishable from a young board and an
  // unknown handle, which is exactly what incident `0017` cost. Surfaces ask
  // this instead of reading the empty answer as product truth.
  it('reports whether the arena exists in this build at all', () => {
    expect(publicArenaConfigured()).toBe(true);

    distribution.account = null;

    expect(publicArenaConfigured()).toBe(false);
  });

  it('ignores ambient account variables when the contract is configured', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://poisoned.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'poisoned-key';

    await readLeaderboard('agent-hours', 'week');

    expect(createClient).toHaveBeenCalledWith(
      'https://account.example.test',
      'contract-anon-key',
      expect.any(Object)
    );
    expect(rpc).toHaveBeenCalledWith('get_operator_leaderboard', {
      metric: 'agent-hours',
      ranking_window: 'week',
    });
  });
});
