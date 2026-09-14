import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useLatestRequest } from './use-latest-request';

describe('useLatestRequest', () => {
  it('lets only the newest ticket commit', () => {
    const { result } = renderHook(() => useLatestRequest());
    const first = result.current.begin();
    expect(first.current).toBe(true);
    const second = result.current.begin();
    expect(first.current).toBe(false);
    expect(second.current).toBe(true);
  });

  it('supersedes every ticket on invalidate without beginning a request', () => {
    const { result } = renderHook(() => useLatestRequest());
    const ticket = result.current.begin();
    act(() => result.current.invalidate());
    expect(ticket.current).toBe(false);
    // A later request is unaffected by the earlier invalidation.
    expect(result.current.begin().current).toBe(true);
  });

  it('supersedes every ticket when the owner unmounts', () => {
    const { result, unmount } = renderHook(() => useLatestRequest());
    const ticket = result.current.begin();
    unmount();
    expect(ticket.current).toBe(false);
  });

  it('hands out the current pass without beginning a new one', () => {
    const { result } = renderHook(() => useLatestRequest());
    const pass = result.current.begin();
    const followUp = result.current.current();
    expect(pass.current).toBe(true);
    expect(followUp.current).toBe(true);
    result.current.begin();
    expect(pass.current).toBe(false);
    expect(followUp.current).toBe(false);
  });

  it('keeps one identity across renders so effects can depend on it', () => {
    const { result, rerender } = renderHook(() => useLatestRequest());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  // The defect class itself, stated once (BUG-118/119/120/121): an older
  // read resolving after a newer one must not overwrite the newer state.
  it('discards an older read that resolves after a newer one', async () => {
    const { result } = renderHook(() => useLatestRequest());
    const committed: string[] = [];
    const read = async (value: string, resolveAfter: Promise<void>) => {
      const ticket = result.current.begin();
      await resolveAfter;
      if (!ticket.current) return;
      committed.push(value);
    };
    let releaseOld!: () => void;
    const old = new Promise<void>(resolve => {
      releaseOld = resolve;
    });
    const older = read('old', old);
    const newer = read('new', Promise.resolve());
    await newer;
    releaseOld();
    await older;
    expect(committed).toEqual(['new']);
  });
});
