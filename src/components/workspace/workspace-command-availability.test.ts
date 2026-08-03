import { describe, expect, it } from 'vitest';
import { deriveWorkspaceCommandAvailability } from './workspace-command-availability';

describe('workspace command availability', () => {
  it('explains commands that cannot act before a Project is open', () => {
    const state = deriveWorkspaceCommandAvailability({
      activeProjectName: null,
      hasActiveTab: false,
      canToggleSplit: false,
      canClose: false,
      canMoveTab: false,
      canMoveProject: false,
      hasAttentionTarget: false,
      closedSessionCount: 0,
    });

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
    const state = deriveWorkspaceCommandAvailability({
      activeProjectName: 'Exawatt',
      hasActiveTab: false,
      canToggleSplit: false,
      canClose: true,
      canMoveTab: false,
      canMoveProject: false,
      hasAttentionTarget: false,
      closedSessionCount: 2,
    });

    expect(state.commands['launch-shell'].available).toBe(true);
    expect(state.commands['rename-project'].available).toBe(true);
    expect(state.commands['open-roadmap'].available).toBe(true);
    expect(state.commands['close-tab'].available).toBe(true);
    expect(state.commands['reopen-closed-tab'].available).toBe(true);
    expect(state.commands['rename-tab'].reason).toBe('Select a Session first');
    expect(state.commands['move-tab'].reason).toBe(
      'Needs a second Session in the Project'
    );
    expect(state.commands['move-project'].reason).toBe(
      'Needs a second open Project'
    );
    expect(state.commands['toggle-split'].available).toBe(false);
    expect(state.commands['jump-attention'].available).toBe(false);
  });

  it('enables tab and attention verbs only when they have a target', () => {
    const state = deriveWorkspaceCommandAvailability({
      activeProjectName: 'Exawatt',
      hasActiveTab: true,
      canToggleSplit: true,
      canClose: true,
      canMoveTab: true,
      canMoveProject: true,
      hasAttentionTarget: true,
      closedSessionCount: 0,
    });

    expect(state.commands['rename-tab'].available).toBe(true);
    expect(state.commands['toggle-split'].available).toBe(true);
    expect(state.commands['move-tab'].available).toBe(true);
    expect(state.commands['move-project'].available).toBe(true);
    expect(state.commands['jump-attention'].available).toBe(true);
    expect(state.commands['reopen-closed-tab'].reason).toBe(
      'No recently closed Sessions'
    );
  });
});
