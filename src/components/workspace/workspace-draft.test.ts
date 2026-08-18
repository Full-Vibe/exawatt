import { describe, expect, it } from 'vitest';
import {
  applyWorkspaceDraftPatch,
  type SessionTab,
} from './use-workspace-state';

function draft(): SessionTab {
  return {
    id: 'draft-a',
    kind: 'session' as const,
    durableSessionId: 'durable-a',
    harness: 'claude',
    title: 'New agent',
    titleKind: 'default',
    cwd: '/repo',
    sessionId: null,
    harnessSessionId: null,
    resumeState: 'identity-missing',
    lifecycle: 'draft',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
    draftTask: 'Finish the close flow',
    draftSource: 'claude',
    draftModel: 'claude-fable-5[1m]',
    draftEffort: 'high',
    draftTouched: true,
    draftWorktree: true,
    draftBranch: 'agent/close-flow',
    draftRoadmapItemId: 'ENG-017',
  };
}

describe('workspace draft intent', () => {
  it('preserves every launch choice when one field changes', () => {
    expect(
      applyWorkspaceDraftPatch(draft(), { draftTask: 'Revised task' })
    ).toMatchObject({
      draftTask: 'Revised task',
      draftSource: 'claude',
      draftModel: 'claude-fable-5[1m]',
      draftEffort: 'high',
      draftTouched: true,
      draftWorktree: true,
      draftBranch: 'agent/close-flow',
      draftRoadmapItemId: 'ENG-017',
    });
  });

  it('invalidates source-specific model and effort when the source changes', () => {
    expect(
      applyWorkspaceDraftPatch(draft(), { draftSource: 'codex' })
    ).toMatchObject({
      draftSource: 'codex',
      draftModel: null,
      draftEffort: null,
      draftBranch: 'agent/close-flow',
    });
  });
});
