'use client';

import { useSyncExternalStore } from 'react';

import type { WorkspaceContextCommand } from '@exawatt/core';

/**
 * Workspace command truth shared by passive hints, the command palette, and
 * the native macOS menu. A command is available only when invoking it now
 * would change the visible workspace; unavailable commands carry the short
 * reason the palette can show instead of failing silently.
 *
 * The key union lives in the shared command-verb manifest, because the native
 * menu's enablement is derived from the same declaration that gives each verb
 * its row and its chord (ENG-016 D44, FIX-012).
 */
export type { WorkspaceContextCommand };

export interface CommandAvailability {
  available: boolean;
  reason: string | null;
}

/**
 * What the recovery bar's one-click control would do right now (D47): the
 * selected Project when it holds parked Agents, otherwise every Project. The
 * ⌘K row and the chord read this so all three entry points name the same
 * scope and the same count instead of each deriving its own.
 */
export interface ResumeScope {
  kind: 'project' | 'all';
  count: number;
  /** Present only for `kind: 'project'`. */
  projectName: string | null;
}

export interface WorkspaceCommandAvailability {
  activeProjectName: string | null;
  /** null when nothing is parked — the verbs are absent, not disabled. */
  resumeScope: ResumeScope | null;
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
  /** Parked Agents with an exact provider identity, across every Project. */
  resumableAgentCount: number;
  /** …of those, the ones in the selected Project. */
  activeProjectResumableCount: number;
  /** the selected tab is itself a parked Agent with an exact identity */
  activeTabCanResume: boolean;
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
  resumableAgentCount,
  activeProjectResumableCount,
  activeTabCanResume,
}: WorkspaceCommandAvailabilityInput): WorkspaceCommandAvailability {
  const hasProject = activeProjectName !== null;
  const resumeScope: ResumeScope | null =
    resumableAgentCount === 0
      ? null
      : hasProject && activeProjectResumableCount > 0
        ? {
            kind: 'project',
            count: activeProjectResumableCount,
            projectName: activeProjectName,
          }
        : { kind: 'all', count: resumableAgentCount, projectName: null };
  return {
    activeProjectName,
    resumeScope,
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
      // Both address the Project itself rather than the Session inside it, so
      // an empty Project still answers: its directory is real, and closing it
      // is the only way to put it away. Reveal follows the selected Session's
      // own working directory when there is one (the strip's per-tab entry
      // reveals exactly that), and falls back to the Project root.
      'reveal-path': hasProject
        ? available()
        : unavailable('Open a Project first'),
      'close-project': hasProject
        ? available()
        : unavailable('Open a Project first'),
      // Recovery keeps D36's exact-identity contract: a tab without a
      // captured provider ID is never counted, so neither verb can offer to
      // guess one (ENG-018).
      'resume-agent': activeTabCanResume
        ? available()
        : unavailable('This Agent is not parked'),
      'resume-scope':
        resumeScope !== null
          ? available()
          : unavailable('No parked Agents to resume'),
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
    resumableAgentCount: 0,
    activeProjectResumableCount: 0,
    activeTabCanResume: false,
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
