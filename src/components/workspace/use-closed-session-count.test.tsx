import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClosedSessionEntry } from '@/types/electron';
import { useClosedSessionCount } from './use-closed-session-count';

function entry(id: string): ClosedSessionEntry {
  return {
    durableSessionId: id,
    title: id,
    goal: null,
    harness: 'codex',
    cwd: '/repo',
    projectDir: '/repo',
    projectName: 'repo',
    harnessSessionId: null,
    initialTask: null,
    closedAt: 1,
  };
}

describe('useClosedSessionCount', () => {
  it('does not let stale hydration overwrite a newer main event', async () => {
    let resolveHydration!: (entries: ClosedSessionEntry[]) => void;
    let onChanged: ((count: number) => void) | null = null;
    const api = {
      closedSessions: vi.fn(
        () =>
          new Promise<ClosedSessionEntry[]>(resolve => {
            resolveHydration = resolve;
          })
      ),
      onClosedSessionsChanged: vi.fn((handler: (count: number) => void) => {
        onChanged = handler;
        return () => {
          onChanged = null;
        };
      }),
    };
    const { result } = renderHook(() => useClosedSessionCount(true, api));

    act(() => onChanged?.(2));
    expect(result.current.closedSessionCount).toBe(2);
    resolveHydration([]);
    await act(async () => Promise.resolve());
    expect(result.current.closedSessionCount).toBe(2);
  });

  it('overlays pending closes until main publishes the durable count', async () => {
    let onChanged: ((count: number) => void) | null = null;
    const api = {
      closedSessions: vi.fn(async () => [entry('existing')]),
      onClosedSessionsChanged: vi.fn((handler: (count: number) => void) => {
        onChanged = handler;
        return () => {};
      }),
    };
    const { result } = renderHook(() => useClosedSessionCount(true, api));
    await waitFor(() => expect(result.current.closedSessionCount).toBe(1));

    let settle!: () => void;
    act(() => {
      settle = result.current.beginPendingClose();
    });
    expect(result.current.closedSessionCount).toBe(1);
    act(() => {
      onChanged?.(2);
      settle();
      settle();
    });
    expect(result.current.closedSessionCount).toBe(2);
  });
});
