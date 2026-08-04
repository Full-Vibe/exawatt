import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectRoadmap } from './use-project-roadmap';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

const ROADMAP = `---
exawatt-roadmap: v2
---

## Now

### ACME-001 Current
`;

describe('useProjectRoadmap activity scope', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
  });

  it('ignores an older Project activity response after switching Projects', async () => {
    const activityA =
      deferred<Array<{ hash: string; subject: string; committedAt: number }>>();
    const activityB =
      deferred<Array<{ hash: string; subject: string; committedAt: number }>>();
    window.electron = {
      isElectron: true,
      platform: 'darwin',
      roadmap: {
        read: vi.fn().mockResolvedValue({
          status: 'ok',
          text: ROADMAP,
          file: 'ROADMAP.md',
          mtimeMs: 0,
        }),
        activity: vi.fn((dir: string) =>
          dir === '/a' ? activityA.promise : activityB.promise
        ),
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn().mockReturnValue(() => {}),
      },
    } as unknown as NonNullable<Window['electron']>;

    const { result, rerender } = renderHook(
      ({ projectDir }) => useProjectRoadmap(projectDir),
      { initialProps: { projectDir: '/a' } }
    );
    await waitFor(() =>
      expect(window.electron?.roadmap?.activity).toHaveBeenCalledWith('/a')
    );
    rerender({ projectDir: '/b' });
    await waitFor(() =>
      expect(window.electron?.roadmap?.activity).toHaveBeenCalledWith('/b')
    );

    await act(async () => {
      activityB.resolve([
        { hash: 'b', subject: 'ACME-001 from B', committedAt: 2 },
      ]);
      await activityB.promise;
    });
    await waitFor(() =>
      expect(result.current.view.now[0]?.recentChanges[0]?.hash).toBe('b')
    );

    await act(async () => {
      activityA.resolve([
        { hash: 'a', subject: 'ACME-001 from A', committedAt: 1 },
      ]);
      await activityA.promise;
    });
    expect(result.current.view.now[0]?.recentChanges[0]?.hash).toBe('b');
  });
});
