import { describe, expect, it } from 'vitest';
import type { SessionDelegation } from '@/types/electron';
import { deriveProjectRibbonSignal } from './project-ribbon-signal';
import { fleetAttention, mergeFleetAttention } from './session-status';
import type { Project, WorkspaceTab } from './use-workspace-state';

function tab(id: string, lifecycle: WorkspaceTab['lifecycle'] = 'running') {
  return {
    id,
    durableSessionId: `durable-${id}`,
    harness: 'codex',
    title: id,
    titleKind: 'operator',
    cwd: '/repo',
    sessionId: `session-${id}`,
    harnessSessionId: `provider-${id}`,
    resumeState: 'live',
    lifecycle,
    exitCode: lifecycle === 'failed' ? 1 : null,
    roadmapItemId: null,
    initialTask: id,
  } satisfies WorkspaceTab;
}

function signal(
  tabs: WorkspaceTab[],
  overrides: Partial<{
    summaries: Record<string, string>;
    attention: Record<string, { kind: 'bell'; since: number }>;
    activity: Record<string, boolean>;
    engaged: Record<string, boolean>;
    delegation: Record<string, SessionDelegation>;
  }> = {}
) {
  const project: Project = {
    dir: '/repo',
    name: 'repo',
    color: '#19E6FF',
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
  return deriveProjectRibbonSignal({
    project,
    summaries: overrides.summaries ?? {},
    attention: mergeFleetAttention(
      fleetAttention('test', overrides.attention ?? {})
    ),
    activity: overrides.activity ?? {},
    engaged: overrides.engaged ?? {},
    delegation: overrides.delegation ?? {},
  });
}

describe('deriveProjectRibbonSignal', () => {
  // A collapsed Project shows ONLY this dot, so it has to be the same truth an
  // expanded Session would show. It used to re-derive that truth from raw
  // activity/attention and drifted from the shared derivation.
  it('reports a Session waiting on the operator as needs-you', () => {
    expect(
      signal([tab('asking')], {
        engaged: { 'session-asking': true },
        delegation: {
          'session-asking': {
            ownTurn: 'generating',
            blockedOn: 'question',
            children: [],
          },
        },
      })
    ).toBe('needs-you');
  });

  it('stays needs-you after the operator has looked (no attention record)', () => {
    // Focus clears the attention QUEUE entry. The gate is still open, so the
    // Project dot must not fall back to "results ready".
    expect(
      signal([tab('asking')], {
        summaries: { 'durable-asking': 'Plan the migration' },
        attention: {},
        delegation: {
          'session-asking': {
            ownTurn: 'generating',
            blockedOn: 'question',
            children: [],
          },
        },
      })
    ).toBe('needs-you');
  });

  it('never calls a reported-open turn a ready result', () => {
    expect(
      signal([tab('thinking')], {
        engaged: { 'session-thinking': true },
        activity: {},
        delegation: {
          'session-thinking': {
            ownTurn: 'generating',
            blockedOn: null,
            children: [],
          },
        },
      })
    ).toBe('working');
  });

  it('a stopped Session is not a pending result', () => {
    // A real exited tab also loses `live` resume state; the tab strip hides
    // its light entirely, so the Project dot must not invent one.
    const stopped = { ...tab('gone', 'exited'), resumeState: 'ended-resumable' as const };
    expect(signal([stopped], { engaged: { 'session-gone': true } })).toBe(
      'quiet'
    );
  });

  it('gives a fault precedence over every other Project signal', () => {
    expect(
      signal([tab('failed', 'failed'), tab('busy')], {
        attention: { 'session-busy': { kind: 'bell', since: 1 } },
        activity: { 'session-busy': true },
      })
    ).toBe('fault');
  });

  it('gives operator attention precedence over background work', () => {
    expect(
      signal([tab('attention'), tab('busy')], {
        attention: { 'session-attention': { kind: 'bell', since: 1 } },
        activity: { 'session-busy': true },
      })
    ).toBe('needs-you');
  });

  it('aggregates delegated children into the parent Project signal', () => {
    expect(
      signal([tab('parent')], {
        delegation: {
          'session-parent': {
            ownTurn: 'available', blockedOn: null,
            children: [{ id: 'child-1', agentType: 'explorer', startedAt: 1 }],
          },
        },
      })
    ).toBe('working');
  });

  it('shows a ready result once an engaged Session becomes quiet', () => {
    expect(
      signal([tab('done')], {
        engaged: { 'session-done': true },
      })
    ).toBe('result');
  });

  it('keeps an empty or inactive Project quiet', () => {
    expect(signal([])).toBe('quiet');
  });
});
