import { describe, expect, it } from 'vitest';
import { nextTabInRing, tabAtOrdinal, type RingProject } from './tab-ring';

type Tab = { id: string; stopped?: boolean };

function project(
  dir: string,
  tabIds: string[],
  activeTabId: string | null = tabIds[0] ?? null
): RingProject<Tab> {
  return { dir, activeTabId, tabs: tabIds.map(id => ({ id })) };
}

describe('nextTabInRing', () => {
  it('advances within a project and wraps across project boundaries', () => {
    const projects = [project('/a', ['a1', 'a2'], 'a2'), project('/b', ['b1'])];
    expect(nextTabInRing(projects, '/a', 1)).toMatchObject({
      dir: '/b',
      tab: { id: 'b1' },
    });
    expect(nextTabInRing(projects, '/a', -1)).toMatchObject({
      dir: '/a',
      tab: { id: 'a1' },
    });
  });

  it('wraps from the last tab back to the first', () => {
    const projects = [project('/a', ['a1']), project('/b', ['b1'], 'b1')];
    expect(nextTabInRing(projects, '/b', 1)).toMatchObject({
      dir: '/a',
      tab: { id: 'a1' },
    });
  });

  it('includes stopped tabs as ordinary ring members and moves past them', () => {
    // The 2026-07-20 dogfood report: cycling "gets stuck at a stopped codex
    // tab". A stopped tab must be landable AND leavable in either direction.
    const projects = [
      project('/a', ['claude-live', 'codex-stopped', 'shell-live']),
    ];
    const landed = nextTabInRing(projects, '/a', 1);
    expect(landed?.tab?.id).toBe('codex-stopped');

    const after = nextTabInRing(
      [{ ...projects[0], activeTabId: 'codex-stopped' }],
      '/a',
      1
    );
    expect(after?.tab?.id).toBe('shell-live');

    const before = nextTabInRing(
      [{ ...projects[0], activeTabId: 'codex-stopped' }],
      '/a',
      -1
    );
    expect(before?.tab?.id).toBe('claude-live');
  });

  it('never becomes a fixed point on a stale active tab id', () => {
    const stale = [
      { dir: '/a', activeTabId: 'gone', tabs: [{ id: 'a1' }, { id: 'a2' }] },
    ];
    // first press recovers on the project's first tab…
    const first = nextTabInRing(stale, '/a', 1);
    expect(first?.tab?.id).toBe('a1');
    // …and once the recovery lands, the next press advances normally
    const recovered = [{ ...stale[0], activeTabId: 'a1' }];
    expect(nextTabInRing(recovered, '/a', 1)?.tab?.id).toBe('a2');
  });

  it('advances out of an active zero-tab project in both directions', () => {
    const projects = [
      { dir: '/empty', activeTabId: null, tabs: [] as Tab[] },
      project('/b', ['b1', 'b2']),
    ];
    expect(nextTabInRing(projects, '/empty', 1)?.tab?.id).toBe('b1');
    expect(nextTabInRing(projects, '/empty', -1)?.tab?.id).toBe('b2');
  });

  it('visits open zero-tab projects as real ring stops (D19)', () => {
    // The 2026-07-20 dogfood report: open Projects with no Sessions were
    // skipped by ⌘⇧[/⌘⇧], which read as "are they even open?". They are
    // sections of the strip, so the ring must land on their empty state.
    const projects = [
      project('/a', ['a1'], 'a1'),
      { dir: '/cortex-ehr', activeTabId: null, tabs: [] as Tab[] },
      project('/c', ['c1']),
    ];
    // forward from /a lands ON the empty project…
    expect(nextTabInRing(projects, '/a', 1)).toEqual({
      dir: '/cortex-ehr',
      tab: null,
    });
    // …and forward from the empty project continues to the next section
    expect(nextTabInRing(projects, '/cortex-ehr', 1)?.tab?.id).toBe('c1');
    // backward from /c lands on the empty project too
    expect(nextTabInRing(projects, '/c', -1)).toEqual({
      dir: '/cortex-ehr',
      tab: null,
    });
  });

  it('cycles between zero-tab projects without a fixed point', () => {
    const projects = [
      { dir: '/x', activeTabId: null, tabs: [] as Tab[] },
      { dir: '/y', activeTabId: null, tabs: [] as Tab[] },
    ];
    expect(nextTabInRing(projects, '/x', 1)?.dir).toBe('/y');
    expect(nextTabInRing(projects, '/y', 1)?.dir).toBe('/x');
  });

  it('returns null for an empty workspace', () => {
    expect(nextTabInRing([], '/a', 1)).toBeNull();
  });

  it('returns the sole zero-tab project as its own stop', () => {
    // one open empty Project: the ring has exactly one stop; cycling stays
    // there rather than pretending there is nowhere to go
    expect(
      nextTabInRing([{ dir: '/a', activeTabId: null, tabs: [] }], '/a', 1)
    ).toEqual({ dir: '/a', tab: null });
  });
});

describe('tabAtOrdinal', () => {
  it('indexes the global ring across projects (⌘1–⌘9)', () => {
    const projects = [project('/a', ['a1', 'a2']), project('/b', ['b1'])];
    expect(tabAtOrdinal(projects, 0)?.tab?.id).toBe('a1');
    expect(tabAtOrdinal(projects, 2)).toMatchObject({
      dir: '/b',
      tab: { id: 'b1' },
    });
    expect(tabAtOrdinal(projects, 3)).toBeNull();
  });

  it('skips zero-tab projects — ⌘digit ordinals number real tabs only', () => {
    // an open empty Project must not shift every later tab's ⌘digit
    const projects = [
      project('/a', ['a1']),
      { dir: '/empty', activeTabId: null, tabs: [] as Tab[] },
      project('/c', ['c1']),
    ];
    expect(tabAtOrdinal(projects, 1)).toMatchObject({
      dir: '/c',
      tab: { id: 'c1' },
    });
  });
});
