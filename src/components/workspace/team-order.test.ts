import { describe, expect, it } from 'vitest';
import { orderTeamTabs, teamOrderBand } from './team-order';
import type { WorkspaceTab } from './use-workspace-state';

const tab = (id: string, over: Partial<WorkspaceTab> = {}): WorkspaceTab =>
  ({
    id,
    durableSessionId: `d-${id}`,
    sessionId: `s-${id}`,
    harness: 'claude',
    title: id,
    titleKind: 'auto',
    cwd: '/p',
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    harnessSessionId: null,
    initialTask: null,
    startedAt: 1,
    roadmapItemId: null,
    ...over,
  }) as WorkspaceTab;

// a: working · b: needs-you · c: idle live · d: stopped
const TABS = [
  tab('a'),
  tab('b'),
  tab('c'),
  tab('d', { resumeState: 'ended-resumable', sessionId: null }),
];
const SIGNALS = {
  activity: { 's-a': true },
  attention: { 's-b': { kind: 'bell' as const, since: 1 } },
};

describe('orderTeamTabs (FIX-008 bench engine)', () => {
  it('arranged is the identity — the durable manual order untouched', () => {
    expect(orderTeamTabs(TABS, 'arranged', SIGNALS).map(t => t.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('active-first leads with working, then needs-you, then the rest', () => {
    const shuffled = [TABS[3], TABS[2], TABS[1], TABS[0]];
    expect(
      orderTeamTabs(shuffled, 'active-first', SIGNALS).map(t => t.id)
    ).toEqual(['a', 'b', 'c', 'd']);
  });

  it('needs-you-first leads with attention', () => {
    expect(
      orderTeamTabs(TABS, 'needs-you-first', SIGNALS).map(t => t.id)
    ).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is stable: equal-band Agents keep their manual order', () => {
    const three = [tab('x'), tab('y'), tab('z')];
    expect(orderTeamTabs(three, 'active-first', { activity: {}, attention: {} })
      .map(t => t.id)).toEqual(['x', 'y', 'z']);
  });

  it('a finished turn is a result, not needs-you (D51 predicate)', () => {
    const signals = {
      activity: {},
      attention: { 's-a': { kind: 'turn-end' as const, since: 1 } },
    };
    expect(teamOrderBand(tab('a'), 'needs-you-first', signals)).toBeGreaterThan(
      0
    );
  });

  it('never reorders across Projects — callers sort one tab list at a time', () => {
    // structural: the signature takes ONE project's tabs; this pin exists so
    // a future flatten refactor has to consciously delete it
    expect(orderTeamTabs([], 'active-first', SIGNALS)).toEqual([]);
  });
});
