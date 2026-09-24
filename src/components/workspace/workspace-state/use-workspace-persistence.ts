'use client';

/**
 * Workspace persistence: when the layout is written, never what it says
 * (that is `layout-serialize.ts`).
 *
 * Three writers, one record. A debounced save follows every layout, goal,
 * and pin change once the workspace is ready; an unmount flush covers a
 * route change that beats the debounce; and the shutdown checkpoint owns the
 * clean two-stage write the quit sequence waits for. Ended tabs remain as
 * explicit resume targets, and goal subtitles and their last ready visual
 * persist with the layout so a relaunch restores identity instead of
 * re-deriving it from scrollback.
 */
import { useCallback, useEffect } from 'react';
import type { GoalVisual } from '@exawatt/core/desktop-bridge';
import type { Latest, Project, WorkspaceLayout } from './workspace-model';
import type { PersistedV7 } from './persisted-layout';
import {
  serializeLayout,
  shutdownTargets,
  withLiveHarnessIdentities,
} from './layout-serialize';
import type { RecentProjects } from './recent-projects';

export function useWorkspacePersistence({
  projects,
  activeDir,
  lastUsedDir,
  pinnedTabId,
  summaries,
  goalVisuals,
  ready,
  readyRef,
  stateRef,
  recents,
  summariesRef,
  goalVisualsRef,
  shutdownTargetsRef,
}: {
  /** the rendered layout and stores: any change schedules a save */
  projects: Project[];
  activeDir: string | null;
  lastUsedDir: string;
  pinnedTabId: string | null;
  summaries: Record<string, string>;
  goalVisuals: Record<string, GoalVisual>;
  /** no write of any kind before hydration lands (a failed load is not an
   *  empty workspace) */
  ready: boolean;
  readyRef: Latest<boolean>;
  /** what a save serializes, read at the moment it writes */
  stateRef: Latest<WorkspaceLayout>;
  recents: RecentProjects;
  summariesRef: Latest<Record<string, string>>;
  goalVisualsRef: Latest<Record<string, GoalVisual>>;
  /** Durable Sessions the shutdown checkpoint parks. This hook is the one
   *  writer: the checkpoint's first stage sets it. */
  shutdownTargetsRef: { current: Set<string> };
}): void {
  const serializeWorkspace = useCallback(
    (cleanShutdown = false): PersistedV7 => {
      const layout = stateRef.current;
      return serializeLayout(layout, {
        recentProjects: recents.mergeOpen(layout.projects, Date.now()),
        summaries: summariesRef.current,
        goalVisuals: goalVisualsRef.current,
        cleanShutdown,
        shutdownTargets: shutdownTargetsRef.current,
      });
    },
    [goalVisualsRef, recents, shutdownTargetsRef, stateRef, summariesRef]
  );

  // ---- persistence: debounced; ended tabs remain as explicit resume targets ----
  // Goal subtitles and their last ready visual persist with the layout so a
  // relaunch restores identity instead of re-deriving it from scrollback.
  useEffect(() => {
    if (!ready) return;
    const ws = window.electron?.workspace;
    if (!ws) return;
    const handle = setTimeout(() => {
      void ws
        .save(serializeWorkspace())
        .catch(error => console.error('Workspace persistence failed', error));
    }, 400);
    return () => clearTimeout(handle);
  }, [
    projects,
    activeDir,
    lastUsedDir,
    pinnedTabId,
    summaries,
    goalVisuals,
    ready,
    serializeWorkspace,
  ]);

  // Route changes can unmount Terminal before the debounce fires (for example,
  // opening an empty Project and immediately pressing Command-3). Flush the
  // latest catalog on unmount so Spatial cannot observe the previous layout.
  useEffect(
    () => () => {
      if (!readyRef.current) return;
      // The shutdown coordinator already owns a clean two-stage checkpoint.
      if (shutdownTargetsRef.current.size > 0) return;
      const ws = window.electron?.workspace;
      if (!ws) return;
      void ws
        .save(serializeWorkspace())
        .catch(error => console.error('Workspace unmount save failed', error));
    },
    [readyRef, serializeWorkspace, shutdownTargetsRef]
  );

  useEffect(() => {
    if (!ready) return;
    const appApi = window.electron?.app;
    const ws = window.electron?.workspace;
    const ptyApi = window.electron?.pty;
    if (!appApi || !ws || !ptyApi) return;
    void appApi.setWorkspaceCheckpointOwner(true);
    const offCheckpoint = appApi.onCheckpointRequest(({ requestId, stage }) => {
      if (stage === 'pre-stop') {
        shutdownTargetsRef.current = shutdownTargets(stateRef.current.projects);
      }
      const state = serializeWorkspace(stage === 'stopped');
      void ptyApi
        .list()
        .then(live => ws.save(withLiveHarnessIdentities(state, live)))
        .then(() => appApi.completeCheckpoint(requestId, true))
        .catch(() => appApi.completeCheckpoint(requestId, false));
    });
    return () => {
      offCheckpoint();
      void appApi.setWorkspaceCheckpointOwner(false);
    };
  }, [ready, serializeWorkspace, shutdownTargetsRef, stateRef]);
}
