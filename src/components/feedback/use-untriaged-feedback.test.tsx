import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { distribution, getSession, createOptionalClient, fetchMock } =
  vi.hoisted(() => ({
    distribution: {
      account: {
        supabaseUrl: 'https://account.example.test',
        supabaseAnonKey: 'public-key',
        recoveryOrigin: 'https://app.example.test',
      },
      services: {
        productFeedback: {
          url: 'https://service.example.test/feedback',
          protocolVersion: 1,
        },
      },
    },
    getSession: vi.fn(),
    createOptionalClient: vi.fn(),
    fetchMock: vi.fn(),
  }));

vi.mock('@/lib/distribution/resolved', () => ({
  resolvedDistribution: () => distribution,
}));

vi.mock('@/lib/supabase/client', () => ({ createOptionalClient }));

import { useUntriagedFeedbackCount } from './use-untriaged-feedback';

describe('useUntriagedFeedbackCount (ENG-025 F3.1 / WP1b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    distribution.services.productFeedback = {
      url: 'https://service.example.test/feedback',
      protocolVersion: 1,
    };
    createOptionalClient.mockReturnValue({ auth: { getSession } });
    getSession.mockResolvedValue({
      data: { session: { access_token: 'access-token' } },
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: 1,
          canTriage: true,
          untriagedCount: 3,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  it('renders the server-derived operator count without a browser allowlist', async () => {
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(result.current).toBe(3));
    expect(fetchMock).toHaveBeenCalledWith(
      'https://service.example.test/feedback',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: 'Bearer access-token',
        }),
      })
    );
  });

  it('shows no triage vocabulary when the service denies capability', async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        schemaVersion: 1,
        canTriage: false,
        untriagedCount: null,
      })
    );
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('does nothing when the distribution has no feedback service', async () => {
    distribution.services.productFeedback = null as never;
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(result.current).toBeNull());
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when signed out without calling the service', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when disabled and never touches auth', () => {
    const { result } = renderHook(() => useUntriagedFeedbackCount(false));
    expect(result.current).toBeNull();
    expect(createOptionalClient).not.toHaveBeenCalled();
  });

  it('reports unknown rather than a wrong zero for failures or invalid DTOs', async () => {
    fetchMock.mockResolvedValue(Response.json({ canTriage: true }));
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
