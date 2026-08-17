import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distribution, createClient, getUser } = vi.hoisted(() => ({
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
  getUser: vi.fn(),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { authenticatedSupabase } from './authenticated-supabase';

describe('authenticatedSupabase distribution account boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'contract-anon-key',
      recoveryOrigin: 'https://app.example.test',
    };
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    createClient.mockReturnValue({ auth: { getUser } });
  });

  it('returns null without constructing transport when accounts are absent', async () => {
    distribution.account = null;

    await expect(authenticatedSupabase('token')).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('uses only the resolved account contract and verifies the bearer token', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://poisoned.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'poisoned-key';

    const client = await authenticatedSupabase('token');

    expect(client).toBeTruthy();
    expect(createClient).toHaveBeenCalledWith(
      'https://account.example.test',
      'contract-anon-key',
      expect.objectContaining({
        global: expect.objectContaining({
          headers: { Authorization: 'Bearer token' },
        }),
      })
    );
    expect(getUser).toHaveBeenCalledWith('token');
  });

  it('returns null when the account rejects the token', async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    await expect(authenticatedSupabase('token')).resolves.toBeNull();
  });
});
