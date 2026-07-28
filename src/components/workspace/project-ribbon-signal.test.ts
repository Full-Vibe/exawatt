import { describe, expect, it } from 'vitest';
import type { SessionDelegation } from '@/types/electron';
import { deriveProjectRibbonSignal } from './project-ribbon-signal';
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
    attention: overrides.attention ?? {},
    activity: overrides.activity ?? {},
    engaged: overrides.engaged ?? {},
    delegation: overrides.delegation ?? {},
  });
}

describe('deriveProjectRibbonSignal', () => {
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
            ownTurn: 'available',
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
