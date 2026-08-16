import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSession, from, is } = vi.hoisted(() => ({
  getSession: vi.fn(),
  from: vi.fn(),
  is: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession }, from }),
}));

vi.mock('@/lib/auth/admin', () => ({
  isAdminEmail: (email: string | null | undefined) =>
    email?.trim().toLowerCase() === 'maintainer@example.com',
}));

import { useUntriagedFeedbackCount } from './use-untriaged-feedback';

function session(email: string | null) {
  return { data: { session: { user: { email } } } };
}

describe('useUntriagedFeedbackCount (ENG-025 F3.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    is.mockResolvedValue({ count: 3, error: null });
    from.mockReturnValue({ select: () => ({ is }) });
  });

  it('counts the operator lane for an operator account', async () => {
    getSession.mockResolvedValue(session('maintainer@example.com'));
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(result.current).toBe(3));
    expect(from).toHaveBeenCalledWith('product_feedback');
    expect(is).toHaveBeenCalledWith('triaged_at', null);
  });

  it('recognizes the operator work identity case-insensitively', async () => {
    getSession.mockResolvedValue(session(' MAINTAINER@EXAMPLE.COM '));
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(result.current).toBe(3));
  });

  it('returns null for a signed-in non-operator and never queries', async () => {
    // Triage is an operator-lane concept: a suggestions-lane filer must not
    // be shown a queue they cannot act on.
    getSession.mockResolvedValue(session('someone@example.com'));
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null for a session with no email at all', async () => {
    getSession.mockResolvedValue(session(null));
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when signed out without hitting the REST endpoint', async () => {
    getSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    expect(result.current).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('returns null when disabled and never touches auth', async () => {
    const { result } = renderHook(() => useUntriagedFeedbackCount(false));
    expect(result.current).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('reports unknown rather than a wrong zero when the query fails', async () => {
    getSession.mockResolvedValue(session('maintainer@example.com'));
    is.mockResolvedValue({ count: null, error: { message: 'offline' } });
    const { result } = renderHook(() => useUntriagedFeedbackCount());
    await waitFor(() => expect(is).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
