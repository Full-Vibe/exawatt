import { describe, expect, it } from 'vitest';
import { orderTeamTabs, teamOrderRank } from './team-order';
import type { WorkspaceTab } from './use-workspace-state';

const tab = (
  id: string,
  startedAt: number | null,
  over: Partial<WorkspaceTab> = {}
): WorkspaceTab =>
  ({
    id,
    kind: 'session' as const,
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
    startedAt,
    roadmapItemId: null,
    ...over,
  }) as WorkspaceTab;

const NO_SIGNALS = { activity: {}, attention: {} };

describe('orderTeamTabs (FIX-008, operator picks 2026-08-07)', () => {
  it('started = Chrome model: oldest first, a new Agent appends', () => {
    // manual order deliberately NOT creation order
    const tabs = [tab('b', 200), tab('a', 100), tab('new', 900), tab('c', 300)];
    expect(orderTeamTabs(tabs, 'started', NO_SIGNALS).map(t => t.id)).toEqual([
      'a',
      'b',
      'c',
      'new',
    ]);
  });

  it('undated tabs sort after every dated one, keeping their manual order', () => {
    const tabs = [tab('draft2', null), tab('a', 100), tab('draft1', null)];
    expect(orderTeamTabs(tabs, 'started', NO_SIGNALS).map(t => t.id)).toEqual([
      'a',
      'draft2',
      'draft1',
    ]);
  });

  it('activity: working leads, needs-you second, rest keep started order', () => {
    const tabs = [
      tab('idle-old', 100),
      tab('needs', 200),
      tab('working', 300),
      tab('idle-new', 400),
      tab('stopped', 50, {
        resumeState: 'ended-resumable',
        sessionId: null,
        lifecycle: 'stopped-clean',
      }),
    ];
    const signals = {
      activity: { 's-working': true },
      attention: { 's-needs': { kind: 'bell' as const, since: 1 } },
    };
    expect(orderTeamTabs(tabs, 'activity', signals).map(t => t.id)).toEqual(
      ['working', 'needs', 'idle-old', 'idle-new', 'stopped']
    );
  });

  it('within a band, started order is the tiebreak — never manual position', () => {
    const tabs = [tab('late', 900), tab('early', 100)];
    const signals = {
      activity: { 's-late': true, 's-early': true },
      attention: {},
    };
    expect(orderTeamTabs(tabs, 'activity', signals).map(t => t.id)).toEqual(
      ['early', 'late']
    );
  });

  it('a live re-sort moves a tile only when its band changes', () => {
    // deterministic: same signals in, same order out — an activity ping
    // that does not change any band cannot shuffle anything
    const tabs = [tab('a', 100), tab('b', 200), tab('c', 300)];
    const signals = { activity: { 's-b': true }, attention: {} };
    const first = orderTeamTabs(tabs, 'activity', signals).map(t => t.id);
    const second = orderTeamTabs(tabs, 'activity', signals).map(t => t.id);
    expect(first).toEqual(['b', 'a', 'c']);
    expect(second).toEqual(first);
  });

  it('a finished turn is a result, not needs-you (D51 predicate)', () => {
    const signals = {
      activity: {},
      attention: { 's-a': { kind: 'turn-end' as const, since: 1 } },
    };
    expect(teamOrderRank(tab('a', 100), 'activity', signals).band).toBe(2);
  });

  it('among Agents needing you, the newest signal is the most recent activity', () => {
    const tabs = [tab('older-signal', 100), tab('newer-signal', 200)];
    const signals = {
      activity: {},
      attention: {
        's-older-signal': { kind: 'bell' as const, since: 1_000 },
        's-newer-signal': { kind: 'bell' as const, since: 9_000 },
      },
    };
    expect(orderTeamTabs(tabs, 'activity', signals).map(t => t.id)).toEqual([
      'newer-signal',
      'older-signal',
    ]);
  });
});
