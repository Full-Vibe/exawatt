import { describe, expect, it } from 'vitest';
import {
  NO_RESUMABLE_AGENTS,
  SESSION_RESUME_UNAVAILABLE,
  type ResumableAgents,
} from '@exawatt/ui-model';
import {
  EMPTY_WORKSPACE_COMMAND_AVAILABILITY,
  deriveWorkspaceCommandAvailability,
  getWorkspaceCommandAvailability,
  publishWorkspaceCommandAvailability,
  resetWorkspaceCommandAvailability,
  type WorkspaceCommandAvailabilityInput,
} from './workspace-command-availability';

const agents = (count: number): ResumableAgents => ({
  count,
  allPaused: true,
});

/** Nothing parked, nothing open — every test states only what it varies. */
function input(
  overrides: Partial<WorkspaceCommandAvailabilityInput> = {}
): WorkspaceCommandAvailabilityInput {
  return {
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
    resumableAgents: NO_RESUMABLE_AGENTS,
    activeProjectResumableAgents: NO_RESUMABLE_AGENTS,
    activeTabCanResume: false,
    ...overrides,
  };
}

describe('workspace command availability', () => {
  it('offers pause only for a selected Project with pausable Agents', () => {
    for (const [activeProjectName, activeProjectPausableCount, expected] of [
      [null, 2, false],
      ['Project', 0, false],
      ['Project', 2, true],
    ] as const) {
      const command = deriveWorkspaceCommandAvailability(
        input({ activeProjectName, activeProjectPausableCount })
      ).commands['pause-project'];
      expect(command.available).toBe(expected);
      expect(command.reason === null).toBe(expected);
    }
  });

  it('explains commands that cannot act before a Project is open', () => {
    const state = deriveWorkspaceCommandAvailability(input());

    expect(state.commands['launch-shell']).toEqual({
      available: false,
      reason: 'Open a Project first',
    });
    expect(state.commands['close-tab'].available).toBe(false);
    expect(state.commands['jump-attention'].reason).toBe(
      'No Sessions need you'
    );
  });

  it('keeps empty-Project actions honest', () => {
    const state = deriveWorkspaceCommandAvailability(
      input({
        activeProjectName: 'Exawatt',
        canClose: true,
        closedSessionCount: 2,
      })
    );

    expect(state.commands['launch-shell'].available).toBe(true);
    expect(state.commands['rename-project'].available).toBe(true);
    expect(state.commands['open-roadmap'].available).toBe(true);
    expect(state.commands['close-tab'].available).toBe(true);
    expect(state.commands['reopen-closed-tab'].available).toBe(true);
    expect(state.commands['rename-tab'].reason).toBe('Select a Session first');
    expect(state.commands['move-tab-left'].reason).toBe(
      'Needs a second Session in the Project'
    );
    expect(state.commands['move-project-right'].reason).toBe(
      'Needs a second open Project'
    );
    expect(state.commands['toggle-split'].available).toBe(false);
    expect(state.commands['jump-attention'].available).toBe(false);
  });

  it('withholds filesystem commands from a folderless Project', () => {
    const state = deriveWorkspaceCommandAvailability(
      input({
        activeProjectName: 'Remote operations',
        hasLocalProjectRoot: false,
        canClose: true,
      })
    );

    for (const command of [
      'launch-shell',
      'open-roadmap',
      'reveal-path',
    ] as const) {
      expect(state.commands[command]).toEqual({
        available: false,
        reason: 'This Project has no local folder',
      });
    }
    expect(state.commands['rename-project'].available).toBe(true);
    expect(state.commands['close-project'].available).toBe(true);
  });

  it('enables tab and attention verbs only when they have a target', () => {
    const state = deriveWorkspaceCommandAvailability(
      input({
        activeProjectName: 'Exawatt',
        hasActiveTab: true,
        canToggleSplit: true,
        canClose: true,
        canMoveTabLeft: true,
        canMoveTabRight: true,
        canMoveProjectLeft: true,
        canMoveProjectRight: true,
        hasAttentionTarget: true,
      })
    );

    expect(state.commands['rename-tab'].available).toBe(true);
    expect(state.commands['toggle-split'].available).toBe(true);
    expect(state.commands['move-tab-left'].available).toBe(true);
    expect(state.commands['move-tab-right'].available).toBe(true);
    expect(state.commands['move-project-left'].available).toBe(true);
    expect(state.commands['move-project-right'].available).toBe(true);
    expect(state.commands['jump-attention'].available).toBe(true);
    expect(state.commands['reopen-closed-tab'].reason).toBe(
      'No recently closed Sessions'
    );
  });

  it('disables only the impossible direction at a reorder edge', () => {
    const state = deriveWorkspaceCommandAvailability(
      input({
        activeProjectName: 'Exawatt',
        hasActiveTab: true,
        canToggleSplit: true,
        canClose: true,
        canMoveTabRight: true,
        canMoveProjectLeft: true,
      })
    );

    expect(state.commands['move-tab-left']).toEqual({
      available: false,
      reason: 'Already the first Session in the Project',
    });
    expect(state.commands['move-tab-right'].available).toBe(true);
    expect(state.commands['move-project-left'].available).toBe(true);
    expect(state.commands['move-project-right']).toEqual({
      available: false,
      reason: 'Already the last open Project',
    });
  });

  // ENG-016 D36/D47 keyboard surface (operator, 2026-08-13): resume had no
  // chord and no ⌘K row. The scope these produce must be the recovery bar's
  // own, never a third recovery model.
  describe('relaunch recovery scopes', () => {
    it('offers nothing while no Agent is parked', () => {
      const state = deriveWorkspaceCommandAvailability(
        input({ activeProjectName: 'Exawatt', hasActiveTab: true })
      );

      expect(state.resumeScope).toBeNull();
      expect(state.commands['resume-scope']).toEqual({
        available: false,
        reason: SESSION_RESUME_UNAVAILABLE.scope,
      });
      expect(state.commands['resume-agent']).toEqual({
        available: false,
        reason: SESSION_RESUME_UNAVAILABLE.agent,
      });
    });

    it('makes the selected Project the default scope, matching the bar', () => {
      const state = deriveWorkspaceCommandAvailability(
        input({
          activeProjectName: 'Exawatt',
          hasActiveTab: true,
          resumableAgents: agents(5),
          activeProjectResumableAgents: agents(2),
          activeTabCanResume: true,
        })
      );

      expect(state.resumeScope).toEqual({
        kind: 'project',
        agents: agents(2),
        projectName: 'Exawatt',
      });
      expect(state.commands['resume-scope'].available).toBe(true);
      expect(state.commands['resume-agent'].available).toBe(true);
    });

    it('falls back to every Project once this one has nothing parked', () => {
      const state = deriveWorkspaceCommandAvailability(
        input({
          activeProjectName: 'Exawatt',
          hasActiveTab: true,
          resumableAgents: agents(3),
          activeProjectResumableAgents: agents(0),
        })
      );

      expect(state.resumeScope).toEqual({
        kind: 'all',
        agents: agents(3),
        projectName: null,
      });
      expect(state.commands['resume-scope'].available).toBe(true);
      // the selected tab is live: the per-Agent verb stays unavailable even
      // though the wider scope has work (exact-identity eligibility, D36)
      expect(state.commands['resume-agent'].available).toBe(false);
    });

    it('resumes every Project when none is selected', () => {
      const state = deriveWorkspaceCommandAvailability(
        input({ resumableAgents: agents(4) })
      );

      expect(state.resumeScope).toEqual({
        kind: 'all',
        agents: agents(4),
        projectName: null,
      });
    });
  });

  it('reset returns the module snapshot to the empty truth (ENG-027: the publisher must not outlive its workspace)', () => {
    const published = deriveWorkspaceCommandAvailability(
      input({
        activeProjectName: 'Exawatt',
        hasActiveTab: true,
        canToggleSplit: true,
        canClose: true,
        canMoveTabLeft: true,
        canMoveTabRight: true,
        canMoveProjectLeft: true,
        canMoveProjectRight: true,
        hasAttentionTarget: true,
        closedSessionCount: 3,
      })
    );
    publishWorkspaceCommandAvailability(published);
    expect(getWorkspaceCommandAvailability()).toBe(published);
    expect(
      getWorkspaceCommandAvailability().commands['launch-shell'].available
    ).toBe(true);

    resetWorkspaceCommandAvailability();
    expect(getWorkspaceCommandAvailability()).toBe(
      EMPTY_WORKSPACE_COMMAND_AVAILABILITY
    );
    expect(
      getWorkspaceCommandAvailability().commands['launch-shell'].available
    ).toBe(false);
  });
});
