import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distribution, push, refresh } = vi.hoisted(() => ({
  distribution: {
    account: {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-anon-key',
      recoveryOrigin: 'https://app.example.test',
    } as {
      supabaseUrl: string;
      supabaseAnonKey: string;
      recoveryOrigin: string;
    } | null,
  },
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

vi.mock('@/lib/analytics', () => ({
  analyticsSurface: () => 'desktop',
  captureAnalyticsEvent: vi.fn(),
}));

import { useElectronAuth } from './use-electron-auth';

function installElectronAuth() {
  const startGoogle = vi.fn(async () => undefined);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    writable: true,
    value: {
      isElectron: true,
      auth: {
        startGoogle,
        linkGithub: vi.fn(),
        onComplete: vi.fn(() => () => {}),
        onError: vi.fn(() => () => {}),
      },
    },
  });
  return startGoogle;
}

describe('useElectronAuth distribution account boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distribution.account = {
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-anon-key',
      recoveryOrigin: 'https://app.example.test',
    };
  });

  it('hands Electron the resolved account contract, not ambient public env', async () => {
    const startGoogle = installElectronAuth();
    const supabase = { auth: {} } as never;
    const { result } = renderHook(() =>
      useElectronAuth(supabase, {
        onError: vi.fn(),
        onLoadingChange: vi.fn(),
      })
    );

    await act(async () => result.current.signInWithGoogle());

    expect(startGoogle).toHaveBeenCalledWith({
      supabaseUrl: 'https://account.example.test',
      supabaseAnonKey: 'public-anon-key',
      redirectTo: `${window.location.origin}/auth/electron-callback`,
    });
  });

  it('fails closed before invoking Electron when accounts are absent', async () => {
    const startGoogle = installElectronAuth();
    distribution.account = null;
    const { result } = renderHook(() =>
      useElectronAuth(null, {
        onError: vi.fn(),
        onLoadingChange: vi.fn(),
      })
    );

    await expect(result.current.signInWithGoogle()).rejects.toThrow(
      'Authentication is not configured in this build.'
    );
    expect(startGoogle).not.toHaveBeenCalled();
  });
});
