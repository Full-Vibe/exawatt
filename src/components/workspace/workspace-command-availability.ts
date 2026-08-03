'use client';

import { useSyncExternalStore } from 'react';

/**
 * Workspace command truth shared by passive hints, the command palette, and
 * the native macOS menu. A command is available only when invoking it now
 * would change the visible workspace; unavailable commands carry the short
 * reason the palette can show instead of failing silently.
 */
export type WorkspaceContextCommand =
  | 'launch-shell'
  | 'reopen-closed-tab'
  | 'rename-tab'
  | 'rename-project'
  | 'toggle-split'
  | 'close-tab'
  | 'move-tab-left'
  | 'move-tab-right'
  | 'move-project-left'
  | 'move-project-right'
  | 'jump-attention'
  | 'open-roadmap';

export interface CommandAvailability {
  available: boolean;
  reason: string | null;
}

export interface WorkspaceCommandAvailability {
  activeProjectName: string | null;
  commands: Record<WorkspaceContextCommand, CommandAvailability>;
}

export interface WorkspaceCommandAvailabilityInput {
  activeProjectName: string | null;
  hasActiveTab: boolean;
  canToggleSplit: boolean;
  canClose: boolean;
  canMoveTabLeft: boolean;
  canMoveTabRight: boolean;
  canMoveProjectLeft: boolean;
  canMoveProjectRight: boolean;
  hasAttentionTarget: boolean;
  closedSessionCount: number;
}

const available = (): CommandAvailability => ({
  available: true,
  reason: null,
});

const unavailable = (reason: string): CommandAvailability => ({
  available: false,
  reason,
});

export function deriveWorkspaceCommandAvailability({
  activeProjectName,
  hasActiveTab,
  canToggleSplit,
  canClose,
  canMoveTabLeft,
  canMoveTabRight,
  canMoveProjectLeft,
  canMoveProjectRight,
  hasAttentionTarget,
  closedSessionCount,
}: WorkspaceCommandAvailabilityInput): WorkspaceCommandAvailability {
  const hasProject = activeProjectName !== null;
  return {
    activeProjectName,
    commands: {
      'launch-shell': hasProject
        ? available()
        : unavailable('Open a Project first'),
      'reopen-closed-tab':
        closedSessionCount > 0
          ? available()
          : unavailable('No recently closed Sessions'),
      'rename-tab': hasActiveTab
        ? available()
        : unavailable('Select a Session first'),
      'rename-project': hasProject
        ? available()
        : unavailable('Open a Project first'),
      'toggle-split': canToggleSplit
        ? available()
        : unavailable('Select a Session first'),
      'close-tab': canClose
        ? available()
        : unavailable('Open a Project or Session first'),
      'move-tab-left': canMoveTabLeft
        ? available()
        : unavailable(
            canMoveTabRight
              ? 'Already the first Session in the Project'
              : 'Needs a second Session in the Project'
          ),
      'move-tab-right': canMoveTabRight
        ? available()
        : unavailable(
            canMoveTabLeft
              ? 'Already the last Session in the Project'
              : 'Needs a second Session in the Project'
          ),
      'move-project-left': canMoveProjectLeft
        ? available()
        : unavailable(
            canMoveProjectRight
              ? 'Already the first open Project'
              : 'Needs a second open Project'
          ),
      'move-project-right': canMoveProjectRight
        ? available()
        : unavailable(
            canMoveProjectLeft
              ? 'Already the last open Project'
              : 'Needs a second open Project'
          ),
      'jump-attention': hasAttentionTarget
        ? available()
        : unavailable('No Sessions need you'),
      'open-roadmap': hasProject
        ? available()
        : unavailable('Open a Project first'),
    },
  };
}

export const EMPTY_WORKSPACE_COMMAND_AVAILABILITY =
  deriveWorkspaceCommandAvailability({
    activeProjectName: null,
    hasActiveTab: false,
    canToggleSplit: false,
    canClose: false,
    canMoveTabLeft: false,
    canMoveTabRight: false,
    canMoveProjectLeft: false,
    canMoveProjectRight: false,
    hasAttentionTarget: false,
    closedSessionCount: 0,
  });

let snapshot = EMPTY_WORKSPACE_COMMAND_AVAILABILITY;
const listeners = new Set<() => void>();

export function publishWorkspaceCommandAvailability(
  next: WorkspaceCommandAvailability
): void {
  snapshot = next;
  listeners.forEach(listener => listener());
}

/**
 * Publisher unmount reset. The snapshot is a module global: without this,
 * the live WorkspaceClient's last truth keeps File-menu verbs enabled after
 * the shell unmounts (a tenant switch to Demo, most importantly). The
 * publisher MUST call this from its unmount cleanup so availability falls
 * back to the empty truth whenever no live workspace is on screen.
 */
export function resetWorkspaceCommandAvailability(): void {
  publishWorkspaceCommandAvailability(EMPTY_WORKSPACE_COMMAND_AVAILABILITY);
}

export function getWorkspaceCommandAvailability(): WorkspaceCommandAvailability {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWorkspaceCommandAvailability(): WorkspaceCommandAvailability {
  return useSyncExternalStore(
    subscribe,
    getWorkspaceCommandAvailability,
    () => EMPTY_WORKSPACE_COMMAND_AVAILABILITY
  );
}
