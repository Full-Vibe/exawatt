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
