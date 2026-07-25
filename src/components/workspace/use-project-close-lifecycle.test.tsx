import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, WorkspaceTab } from './use-workspace-state';
import {
  EMPTY_PROJECT_LINGER_MS,
  PROJECT_EXIT_MS,
  useProjectCloseLifecycle,
} from './use-project-close-lifecycle';

function tab(): WorkspaceTab {
  return {
    id: 'tab-a',
    durableSessionId: 'durable-a',
    harness: 'claude',
    title: 'Claude Code',
    titleKind: 'default',
    cwd: '/repo',
    sessionId: 'session-a',
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  };
}

function project(tabs: WorkspaceTab[]): Project {
  return {
    dir: '/repo',
    name: 'repo',
    color: '#19E6FF',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

describe('empty Project close lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps the empty state briefly, retracts it, then closes the Project', () => {
    const onCloseProject = vi.fn(() => true);
    const { result, rerender } = renderHook(
      ({ projects }) =>
        useProjectCloseLifecycle({
          projects,
          ready: true,
          onCloseProject,
        }),
      { initialProps: { projects: [project([tab()])] } }
    );

    rerender({ projects: [project([])] });
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_LINGER_MS - 1));
    expect(result.current.exitingProjectDirs.has('/repo')).toBe(false);
    expect(onCloseProject).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.exitingProjectDirs.has('/repo')).toBe(true);
    expect(onCloseProject).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });

  it('does not auto-close a Project that was opened empty', () => {
    const onCloseProject = vi.fn(() => true);
    renderHook(() =>
      useProjectCloseLifecycle({
        projects: [project([])],
        ready: true,
        onCloseProject,
      })
    );
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_LINGER_MS * 2));
    expect(onCloseProject).not.toHaveBeenCalled();
  });

  it('cancels the pending close when another Agent opens', () => {
    const onCloseProject = vi.fn(() => true);
    const { rerender } = renderHook(
      ({ projects }) =>
        useProjectCloseLifecycle({
          projects,
          ready: true,
          onCloseProject,
        }),
      { initialProps: { projects: [project([tab()])] } }
    );
    rerender({ projects: [project([])] });
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_LINGER_MS - 1));
    rerender({ projects: [project([tab()])] });
    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS + 1));
    expect(onCloseProject).not.toHaveBeenCalled();
  });

  it('keeps an empty Project when the operator engages with its composer', () => {
    const onCloseProject = vi.fn(() => true);
    const { result, rerender } = renderHook(
      ({ projects }) =>
        useProjectCloseLifecycle({
          projects,
          ready: true,
          onCloseProject,
        }),
      { initialProps: { projects: [project([tab()])] } }
    );

    rerender({ projects: [project([])] });
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_LINGER_MS - 1));
    act(() => expect(result.current.retainProject('/repo')).toBe(true));
    act(() =>
      vi.advanceTimersByTime(EMPTY_PROJECT_LINGER_MS + PROJECT_EXIT_MS)
    );

    expect(result.current.exitingProjectDirs.has('/repo')).toBe(false);
    expect(onCloseProject).not.toHaveBeenCalled();
  });

  it('manual close skips the grace period but keeps the exit transition', () => {
    const onCloseProject = vi.fn(() => true);
    const { result } = renderHook(() =>
      useProjectCloseLifecycle({
        projects: [project([])],
        ready: true,
        onCloseProject,
      })
    );
    act(() => expect(result.current.requestProjectExit('/repo')).toBe(true));
    expect(result.current.exitingProjectDirs.has('/repo')).toBe(true);
    expect(onCloseProject).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });

  it('waits for a manually closed Project to empty, then exits immediately', () => {
    const onCloseProject = vi.fn(() => true);
    const { result, rerender } = renderHook(
      ({ projects }) =>
        useProjectCloseLifecycle({
          projects,
          ready: true,
          onCloseProject,
        }),
      { initialProps: { projects: [project([tab()])] } }
    );
    act(() => expect(result.current.requestProjectExit('/repo')).toBe(true));
    expect(result.current.exitingProjectDirs.has('/repo')).toBe(false);
    rerender({ projects: [project([])] });
    expect(result.current.exitingProjectDirs.has('/repo')).toBe(true);
    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });
});
