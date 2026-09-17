import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRemoteCoworkers } from './use-remote-coworkers';

/**
 * Two reads overlap whenever Connect finishes: the dialog's refresh and the
 * change tick main sends after the mapping write. A superseded read must
 * answer with the newer roster, not with null, because null is a FAILED
 * read and its caller treats "no roster" as "the Agent is not there".
 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => {
  delete (window as { electron?: unknown }).electron;
});

describe('useRemoteCoworkers', () => {
  it('answers a superseded refresh with the newer read, never with null', async () => {
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    const list = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        connectedSources: {
          list,
          agents: vi.fn(async () => []),
          commandAuthority: vi.fn(async () => []),
        },
      },
    });
    const { result } = renderHook(() => useRemoteCoworkers(false));

    let older!: Promise<unknown>;
    let newer!: Promise<unknown>;
    await act(async () => {
      older = result.current.refresh();
      newer = result.current.refresh();
    });
    // The newer read lands first; the older one lands afterwards and is stale.
    await act(async () => {
      second.resolve([{ id: 'source-b' }]);
    });
    await act(async () => {
      first.resolve([{ id: 'source-a' }]);
    });

    const [olderRoster, newerRoster] = await Promise.all([older, newer]);
    expect(newerRoster).toMatchObject({ sources: [{ id: 'source-b' }] });
    expect(olderRoster).toBe(newerRoster);
    expect(result.current.roster.sources).toEqual([{ id: 'source-b' }]);
  });

  it('still answers null for a read that failed', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        connectedSources: {
          list: vi.fn(async () => {
            throw new Error('tunnel dropped');
          }),
          agents: vi.fn(async () => []),
          commandAuthority: vi.fn(async () => []),
        },
      },
    });
    const { result } = renderHook(() => useRemoteCoworkers(false));
    await expect(result.current.refresh()).resolves.toBeNull();
  });
});
