import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, WorkspaceTab } from './use-workspace-state';
import {
  EMPTY_PROJECT_DORMANCY_MS,
  PROJECT_EXIT_MS,
  useProjectCloseLifecycle,
} from './use-project-close-lifecycle';

function tab(): WorkspaceTab {
  return {
    id: 'tab-a',
    kind: 'session' as const,
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

function project(tabs: WorkspaceTab[], dir = '/repo'): Project {
  return {
    dir,
    name: dir.slice(1),
    color: '#19E6FF',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

function lifecycle(
  projects: Project[],
  activeDir: string | null,
  onCloseProject = vi.fn(() => true)
) {
  return renderHook(
    props =>
      useProjectCloseLifecycle({
        ...props,
        ready: true,
        onCloseProject,
      }),
    { initialProps: { projects, activeDir } }
  );
}

describe('empty Project ribbon lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps an empty Project open, then moves it to the dormant tail', () => {
    const onCloseProject = vi.fn(() => true);
    const view = lifecycle([project([tab()])], null, onCloseProject);
    view.rerender({ projects: [project([])], activeDir: null });
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS - 1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(true);
    expect(onCloseProject).not.toHaveBeenCalled();
  });

  it('never tails the selected empty Project', () => {
    const view = lifecycle([project([])], '/repo');
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS * 2));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
  });

  it('starts the full dormancy dwell only after an empty Project becomes inactive', () => {
    const view = lifecycle([project([])], '/repo');
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS * 2));
    view.rerender({ projects: [project([])], activeDir: null });
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS - 1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(true);
  });

  it('returns a dormant Project to its manual slot when selected', () => {
    const view = lifecycle([project([])], null);
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(true);
    view.rerender({ projects: [project([])], activeDir: '/repo' });
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
  });

  it('cancels dormancy when another Agent opens', () => {
    const view = lifecycle([project([])], null);
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS - 1));
    view.rerender({ projects: [project([tab()])], activeDir: null });
    act(() => vi.advanceTimersByTime(2));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
  });

  it('keeps stable relative empty order in the lifecycle set', () => {
    const view = lifecycle([project([], '/a'), project([], '/b')], null);
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS));
    expect([...view.result.current.dormantProjectDirs]).toEqual(['/a', '/b']);
  });

  it('manual close skips dormancy but keeps the exit transition', () => {
    const onCloseProject = vi.fn(() => true);
    const view = lifecycle([project([])], '/repo', onCloseProject);
    act(() =>
      expect(view.result.current.requestProjectExit('/repo')).toBe(true)
    );
    expect(view.result.current.exitingProjectDirs.has('/repo')).toBe(true);
    expect(onCloseProject).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });

  it('waits for confirmed Agent closes before exiting a non-empty Project', () => {
    const onCloseProject = vi.fn(() => true);
    const view = lifecycle([project([tab()])], '/repo', onCloseProject);
    act(() =>
      expect(view.result.current.requestProjectExit('/repo')).toBe(true)
    );
    expect(view.result.current.exitingProjectDirs.has('/repo')).toBe(false);
    view.rerender({ projects: [project([])], activeDir: '/repo' });
    expect(view.result.current.exitingProjectDirs.has('/repo')).toBe(true);
    act(() => vi.advanceTimersByTime(PROJECT_EXIT_MS));
    expect(onCloseProject).toHaveBeenCalledWith('/repo');
  });

  it('operator engagement restarts the dormancy clock', () => {
    const view = lifecycle([project([])], null);
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS - 1));
    act(() => expect(view.result.current.retainProject('/repo')).toBe(true));
    act(() => vi.advanceTimersByTime(EMPTY_PROJECT_DORMANCY_MS - 1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.dormantProjectDirs.has('/repo')).toBe(true);
  });
});
