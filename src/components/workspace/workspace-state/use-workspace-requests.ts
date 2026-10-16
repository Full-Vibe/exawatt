'use client';

/**
 * Requests that reach the workspace from outside it (S2): the ⌘K switcher
 * lives at the app root and asks the workspace to activate a Session, select
 * a tab (⌘[ and ⌘] history, D27), launch a harness, open a Project, or
 * toggle the split. A request that fires before this workspace has loaded
 * waits in its pending slot and is replayed against the loaded layout.
 */
import { useEffect } from 'react';
import type { PtyHarness } from '@exawatt/core';
import {
  SESSION_JUMP_EVENT,
  TAB_SELECT_EVENT,
  LAUNCH_EVENT,
  OPEN_PROJECT_EVENT,
  TOGGLE_SPLIT_EVENT,
  consumePendingSessionJump,
  consumePendingTabSelect,
  consumePendingLaunch,
  consumePendingOpenProject,
  type LaunchRequest,
} from '../session-jump';
import type { ProjectOpenedContext } from '@/lib/projects/registry';
import type { Latest } from './workspace-model';

/** ⌘K's Project rows are the Projects this machine already knows: the
 *  registry's and the local recency record's (ENG-047 `project_opened`). */
const PALETTE_PROJECT_OPEN: ProjectOpenedContext = { source: 'recent' };

export function useWorkspaceRequests({
  ready,
  readyRef,
  activateSession,
  selectExistingTab,
  launchHere,
  openProject,
  togglePin,
}: {
  ready: boolean;
  readyRef: Latest<boolean>;
  activateSession: (sessionRef: string) => boolean;
  selectExistingTab: (dir: string, tabId: string) => void;
  launchHere: (
    harness: PtyHarness,
    options?: { shellCommand?: string }
  ) => boolean;
  openProject: (dir: string, opened?: ProjectOpenedContext) => Promise<boolean>;
  togglePin: () => boolean;
}): void {
  // ---- palette requests (S2): the ⌘K switcher lives at the app root and
  // asks the workspace to activate a session / launch a harness. Live events
  // handle the mounted-and-ready case; before ready the pending slot is left
  // alone so the ready-effect below applies it against the LOADED layout
  // (acting early would fail against empty state and lose the request).
  useEffect(() => {
    const onJump = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingSessionJump();
      activateSession((e as CustomEvent<string>).detail);
    };
    // back/forward (D27): select a tab by identity when it still exists —
    // a closed tab simply stays a dead stop in the history
    const onTabSelect = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingTabSelect();
      const { dir, tabId } =
        (e as CustomEvent<{ dir: string; tabId: string }>).detail ?? {};
      selectExistingTab(dir, tabId);
    };
    const onLaunch = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingLaunch();
      const request = (e as CustomEvent<LaunchRequest>).detail;
      launchHere(request.harness, request);
    };
    const onToggleSplit = () => {
      if (readyRef.current) togglePin();
    };
    // JUMP_ATTENTION_EVENT is owned by WorkspaceClient: it composes PTY and
    // roadmap signals before deriving both the visible marker and jump queue.
    const onOpenProject = (e: Event) => {
      if (!readyRef.current) return;
      consumePendingOpenProject();
      void openProject((e as CustomEvent<string>).detail, PALETTE_PROJECT_OPEN);
    };
    window.addEventListener(SESSION_JUMP_EVENT, onJump);
    window.addEventListener(TAB_SELECT_EVENT, onTabSelect);
    window.addEventListener(LAUNCH_EVENT, onLaunch);
    window.addEventListener(OPEN_PROJECT_EVENT, onOpenProject);
    window.addEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    return () => {
      window.removeEventListener(SESSION_JUMP_EVENT, onJump);
      window.removeEventListener(TAB_SELECT_EVENT, onTabSelect);
      window.removeEventListener(LAUNCH_EVENT, onLaunch);
      window.removeEventListener(OPEN_PROJECT_EVENT, onOpenProject);
      window.removeEventListener(TOGGLE_SPLIT_EVENT, onToggleSplit);
    };
  }, [
    activateSession,
    launchHere,
    openProject,
    readyRef,
    selectExistingTab,
    togglePin,
  ]);

  useEffect(() => {
    if (!ready) return;
    const jump = consumePendingSessionJump();
    if (jump) activateSession(jump);
    // ⌘[ from another route (D27): the tab half of the location fired
    // before this workspace mounted — apply it against the loaded layout
    const tabSel = consumePendingTabSelect();
    if (tabSel) selectExistingTab(tabSel.dir, tabSel.tabId);
    const launchRequest = consumePendingLaunch();
    if (launchRequest) launchHere(launchRequest.harness, launchRequest);
    const proj = consumePendingOpenProject();
    if (proj) void openProject(proj, PALETTE_PROJECT_OPEN);
  }, [ready, activateSession, selectExistingTab, launchHere, openProject]);
}
