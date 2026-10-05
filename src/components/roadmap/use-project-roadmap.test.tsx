import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProjectRoadmap } from './use-project-roadmap';
import {
  installBridgeDouble,
  removeBridgeDouble,
} from '@/test-support/desktop-bridge-double';

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
    removeBridgeDouble();
  });

  it('ignores an older Project activity response after switching Projects', async () => {
    type Activity = Awaited<
      ReturnType<
        NonNullable<NonNullable<Window['electron']>['roadmap']>['activity']
      >
    >;
    const activityA = deferred<Activity>();
    const activityB = deferred<Activity>();
    const unavailable = {
      status: 'unavailable' as const,
      reason: 'fixture',
    };
    installBridgeDouble({
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
    });

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
      activityB.resolve({
        changes: [{ hash: 'b', subject: 'ACME-001 from B', committedAt: 2 }],
        landings: unavailable,
      });
      await activityB.promise;
    });
    await waitFor(() =>
      expect(result.current.view.now[0]?.recentChanges[0]?.hash).toBe('b')
    );

    await act(async () => {
      activityA.resolve({
        changes: [{ hash: 'a', subject: 'ACME-001 from A', committedAt: 1 }],
        landings: unavailable,
      });
      await activityA.promise;
    });
    expect(result.current.view.now[0]?.recentChanges[0]?.hash).toBe('b');
    // an unavailable queue is not shown, and is not an empty queue
    expect(result.current.view.landings).toBeNull();
  });

  it('projects a readable queue onto the item its ticket names', async () => {
    installBridgeDouble({
      platform: 'darwin',
      roadmap: {
        read: vi.fn().mockResolvedValue({
          status: 'ok',
          text: ROADMAP,
          file: 'ROADMAP.md',
          mtimeMs: 0,
        }),
        activity: vi.fn().mockResolvedValue({
          changes: [],
          landings: {
            status: 'ok',
            readAt: 1_000_000,
            tickets: [
              {
                id: '00000580-aaaaaaaa',
                number: 580,
                status: 'integrating',
                branch: 'agent/current',
                lane: 'worktree',
                subject: 'feat(ACME-001): the current slice',
                admittedAt: 900_000,
                headAt: 950_000,
                terminalAt: null,
                integratedSha: null,
                failureReason: null,
                checking: false,
                held: false,
              },
            ],
            candidates: [],
            unreadableTickets: 0,
            metricsAt: 999_000,
          },
        }),
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn().mockReturnValue(() => {}),
      },
    });

    const { result } = renderHook(() => useProjectRoadmap('/a'));
    await waitFor(() =>
      expect(result.current.view.now[0]?.landing?.state).toBe('integrating')
    );
    expect(result.current.view.landings).toMatchObject({
      inQueue: 1,
      head: { ticketNumber: 580, declaredId: 'ACME-001' },
    });
  });
});

describe('useProjectRoadmap injected landings source (ENG-027 W14)', () => {
  afterEach(() => {
    removeBridgeDouble();
  });

  const ticket = (
    status: 'queued' | 'integrating',
    subject = 'feat(ACME-001): the current slice'
  ) => ({
    id: `0000001-${status}`,
    number: 1,
    status,
    branch: null,
    lane: 'worktree',
    subject,
    admittedAt: 900_000,
    headAt: status === 'integrating' ? 950_000 : null,
    terminalAt: null,
    integratedSha: null,
    failureReason: null,
    checking: false,
    held: false,
  });
  const readOf = (status: 'queued' | 'integrating') => ({
    status: 'ok' as const,
    readAt: 1_000_000,
    tickets: [ticket(status)],
    candidates: [],
    unreadableTickets: 0,
    metricsAt: 999_000,
  });
  const fixtureRead = () => ({
    status: 'ok' as const,
    text: ROADMAP,
    file: 'ROADMAP.md',
    mtimeMs: 0,
  });

  it('draws an injected queue beside an injected roadmap without touching the activity IPC', async () => {
    const activity = vi.fn();
    installBridgeDouble({
      platform: 'darwin',
      roadmap: {
        read: vi.fn(),
        activity,
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn().mockReturnValue(() => {}),
      },
    });
    const landings = vi.fn((dir: string) =>
      dir === '/demo/a' ? readOf('integrating') : null
    );
    const { result } = renderHook(() =>
      useProjectRoadmap('/demo/a', [], [], fixtureRead, landings)
    );
    await waitFor(() =>
      expect(result.current.view.now[0]?.landing?.state).toBe('integrating')
    );
    expect(result.current.view.landings).toMatchObject({
      inQueue: 1,
      head: { ticketNumber: 1, declaredId: 'ACME-001' },
    });
    expect(landings).toHaveBeenCalledWith('/demo/a');
    // the Demo tenant never reads the live repository's queue
    expect(activity).not.toHaveBeenCalled();
    expect(window.electron?.roadmap?.read).not.toHaveBeenCalled();
  });

  it('is null for a Project the source has nothing for, which is no queue, not an empty one', async () => {
    const { result } = renderHook(() =>
      useProjectRoadmap('/demo/b', [], [], fixtureRead, () => null)
    );
    await waitFor(() => expect(result.current.view.status).toBe('ok'));
    expect(result.current.view.landings).toBeNull();
    expect(result.current.view.now[0]?.landing).toBeNull();
  });

  it("is ignored on a live Project: the repository's own queue is what the lens shows", async () => {
    installBridgeDouble({
      platform: 'darwin',
      roadmap: {
        read: vi.fn().mockResolvedValue(fixtureRead()),
        activity: vi
          .fn()
          .mockResolvedValue({ changes: [], landings: readOf('queued') }),
        watch: vi.fn().mockResolvedValue(undefined),
        unwatch: vi.fn().mockResolvedValue(undefined),
        onFileChanged: vi.fn().mockReturnValue(() => {}),
      },
    });
    const injected = vi.fn(() => readOf('integrating'));
    const { result } = renderHook(() =>
      useProjectRoadmap('/a', [], [], undefined, injected)
    );
    await waitFor(() =>
      expect(result.current.view.now[0]?.landing?.state).toBe('queued')
    );
    expect(injected).not.toHaveBeenCalled();
  });
});
