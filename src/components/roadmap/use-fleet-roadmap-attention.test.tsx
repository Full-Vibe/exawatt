import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attentionAt,
  fleetAttention,
  mergeAttention,
} from '@/components/workspace/session-status';
import { useFleetRoadmapAttention } from './use-fleet-roadmap-attention';

const BLOCKED = `## Now

### B-1 Waiting on a decision

Status: blocked
`;
const CLEAN = `## Now

### A-1 Fine

Status: now
`;

function session(id: string, dir: string, itemId: string) {
  return {
    sessionId: id,
    tabId: `tab-${id}`,
    title: `session ${id}`,
    cwd: dir,
    contextSummary: null,
    initialTask: null,
    declaredItemId: itemId,
  };
}

const ALPHA = { dir: '/a', sessions: [session('sa', '/a', 'A-1')] };
const BRAVO = { dir: '/b', sessions: [session('sb', '/b', 'B-1')] };

function electron(overrides: Record<string, unknown> = {}) {
  const read = vi.fn(async (dir: string) => ({
    status: 'ok' as const,
    text: dir === '/b' ? BLOCKED : CLEAN,
    file: 'ROADMAP.md',
    mtimeMs: 1,
  }));
  const api = {
    read,
    watch: vi.fn().mockResolvedValue(undefined),
    unwatch: vi.fn().mockResolvedValue(undefined),
    onFileChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
  window.electron = {
    isElectron: true,
    platform: 'darwin',
    roadmap: api,
  } as unknown as NonNullable<Window['electron']>;
  return api;
}

describe('useFleetRoadmapAttention', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electron');
    vi.restoreAllMocks();
  });

  it('reads EVERY open Project, not only the one in front (BUG-026)', async () => {
    const api = electron();
    const { result } = renderHook(() => useFleetRoadmapAttention([ALPHA, BRAVO]));
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    expect(api.read).toHaveBeenCalledWith('/a');
    expect(api.read).toHaveBeenCalledWith('/b');
    expect(result.current.scope).toEqual({ kind: 'fleet' });
    expect(result.current.signals.sb.kind).toBe('roadmap-blocked');
    expect(result.current.signals.sa).toBeUndefined();
  });

  it('owns one watcher per open Project and releases it on close', async () => {
    const api = electron();
    const { rerender, unmount } = renderHook(
      ({ projects }) => useFleetRoadmapAttention(projects),
      { initialProps: { projects: [ALPHA, BRAVO] } }
    );
    await waitFor(() => expect(api.watch).toHaveBeenCalledWith('/b'));
    expect(api.watch).toHaveBeenCalledTimes(2);
    rerender({ projects: [ALPHA] });
    await waitFor(() => expect(api.unwatch).toHaveBeenCalledWith('/b'));
    unmount();
    await waitFor(() => expect(api.unwatch).toHaveBeenCalledWith('/a'));
  });

  it('re-reads on focus but does not re-parse an unchanged roadmap', async () => {
    const api = electron();
    const { result } = renderHook(() => useFleetRoadmapAttention([ALPHA, BRAVO]));
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    const before = result.current;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await waitFor(() => expect(api.read).toHaveBeenCalledTimes(4));
    // Same mtime: no new parse, no new state, nothing downstream re-renders.
    expect(result.current).toBe(before);
  });

  it('keeps `since` pinned across a Project the operator leaves and returns to', async () => {
    electron();
    const { result, rerender } = renderHook(
      ({ projects }) => useFleetRoadmapAttention(projects),
      { initialProps: { projects: [ALPHA, BRAVO] } }
    );
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    const since = result.current.signals.sb.since;
    // The operator switches Projects; the fleet producer's inputs are the
    // same fleet, so the pin must not move.
    rerender({ projects: [BRAVO, ALPHA] });
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    expect(result.current.signals.sb.since).toBe(since);
  });

  // BUG-160. The roadmap reader refuses a file over its byte limit with
  // `status: 'error'`; this hook wrote the same `absent` a Project with no
  // roadmap gets, so the strip, the Project dot and ⌘J read every Session in
  // that Project as quiet while the rail showed the error.
  it('declares itself blind to a Project whose roadmap could not be read', async () => {
    electron({
      read: vi.fn(async (dir: string) =>
        dir === '/b'
          ? { status: 'error' as const, error: 'roadmap.md exceeds the limit' }
          : { status: 'ok' as const, text: CLEAN, file: 'ROADMAP.md', mtimeMs: 1 }
      ),
    });
    const { result } = renderHook(() => useFleetRoadmapAttention([ALPHA, BRAVO]));
    await waitFor(() =>
      expect(result.current.scope).toEqual({
        kind: 'sessions',
        sessionIds: new Set(['sa']),
      })
    );
    const view = mergeAttention(fleetAttention('pty', {}), result.current);
    expect(attentionAt(view, 'sa')).toEqual({ known: true, signal: undefined });
    expect(attentionAt(view, 'sb')).toEqual({
      known: false,
      unseenBy: ['roadmap'],
    });
  });

  it('declares itself blind when the read itself rejects', async () => {
    electron({ read: vi.fn().mockRejectedValue(new Error('bridge down')) });
    const { result } = renderHook(() => useFleetRoadmapAttention([ALPHA]));
    await waitFor(() =>
      expect(result.current.scope).toEqual({
        kind: 'sessions',
        sessionIds: new Set(),
      })
    );
  });

  it('keeps the last good parse when a later read fails, as a fact with an age', async () => {
    let fail = false;
    electron({
      read: vi.fn(async () =>
        fail
          ? { status: 'error' as const, error: 'roadmap.md exceeds the limit' }
          : { status: 'ok' as const, text: BLOCKED, file: 'ROADMAP.md', mtimeMs: 1 }
      ),
    });
    const { result } = renderHook(() => useFleetRoadmapAttention([BRAVO]));
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    fail = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    // The block the last good parse showed still stands, and the producer
    // still covers the Session: nothing about the roadmap has been learned.
    expect(result.current.signals.sb?.kind).toBe('roadmap-blocked');
    expect(result.current.scope).toEqual({ kind: 'fleet' });
  });

  it('never lets an older read of the same roadmap land after a newer one', async () => {
    let release!: () => void;
    const first = new Promise<void>(resolve => {
      release = resolve;
    });
    let calls = 0;
    electron({
      read: vi.fn(async () => {
        calls += 1;
        if (calls === 1) {
          // The mount read: answers last, with the OLDER file state.
          await first;
          return { status: 'ok' as const, text: CLEAN, file: 'ROADMAP.md', mtimeMs: 1 };
        }
        return { status: 'ok' as const, text: BLOCKED, file: 'ROADMAP.md', mtimeMs: 2 };
      }),
    });
    const { result } = renderHook(() => useFleetRoadmapAttention([BRAVO]));
    await waitFor(() => expect(calls).toBe(1));
    // A focus refresh starts a newer read that answers first.
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.signals.sb).toBeDefined());
    await act(async () => {
      release();
      await Promise.resolve();
    });
    expect(result.current.signals.sb?.kind).toBe('roadmap-blocked');
  });

  it('treats a Project with no roadmap as clear, not blocked', async () => {
    electron({
      read: vi.fn(async () => ({ status: 'none' as const, checked: [] })),
    });
    const { result } = renderHook(() => useFleetRoadmapAttention([ALPHA, BRAVO]));
    await waitFor(() => expect(result.current.scope).toEqual({ kind: 'fleet' }));
    expect(result.current.signals).toEqual({});
  });
});
