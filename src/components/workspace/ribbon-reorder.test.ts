import { describe, expect, it } from 'vitest';
import {
  dropIndexForPointer,
  ribbonContentX,
  placementForOrder,
  reorderTokensForProjectDrag,
  reorderTokensForTabDrag,
  slotCenter,
} from './ribbon-reorder';
import type { RibbonToken } from './project-ribbon-motion';
import type { Project, WorkspaceTab } from './use-workspace-state';

const ROW = 34;

function fakeTab(id: string): WorkspaceTab {
  return {
    id,
    kind: 'session' as const,
    durableSessionId: `d-${id}`,
    harness: 'claude',
    title: id,
    titleKind: 'operator',
    cwd: '/repo',
    sessionId: `s-${id}`,
    harnessSessionId: null,
    resumeState: 'live',
    lifecycle: 'running',
    exitCode: null,
    roadmapItemId: null,
    initialTask: null,
  };
}

function fakeProject(dir: string, tabIds: string[]): Project {
  return {
    dir,
    name: dir,
    color: '#fff',
    tabs: tabIds.map(fakeTab),
    activeTabId: tabIds[0] ?? null,
  };
}

function tokensFor(spec: Record<string, string[]>): RibbonToken[] {
  const out: RibbonToken[] = [];
  let index = 0;
  for (const [dir, tabIds] of Object.entries(spec)) {
    const project = fakeProject(dir, tabIds);
    out.push({
      key: `project:${dir}`,
      kind: 'project',
      project,
      sourceProjectIndex: index++,
    });
    for (const tab of project.tabs) {
      out.push({
        key: `tab:${tab.id}`,
        kind: 'tab',
        project,
        tab,
      });
    }
  }
  return out;
}

const keys = (tokens: readonly RibbonToken[]) =>
  tokens.map(token => token.key);

describe('dropIndexForPointer', () => {
  const centers = [
    { id: 'a', x: 50 },
    { id: 'b', x: 150 },
    { id: 'c', x: 260 },
  ];

  it('counts the siblings whose centre the pointer has passed', () => {
    expect(dropIndexForPointer(centers, 10)).toBe(0);
    expect(dropIndexForPointer(centers, 100)).toBe(1);
    expect(dropIndexForPointer(centers, 200)).toBe(2);
    expect(dropIndexForPointer(centers, 400)).toBe(3);
  });

  it('is a function of x alone — the ribbon has no rows to reason about', () => {
    // Regression: the row-derived index survived the two-row layout's
    // retirement and read a pointer a few pixels BELOW the strip as "a row
    // after everything", flinging the dragged chip to the end.
    expect(dropIndexForPointer(centers, 100)).toBe(1);
    expect(dropIndexForPointer([], 100)).toBe(0);
  });

  it('derives centres from targets', () => {
    expect(slotCenter({ id: 'x', x: 100, y: 0, row: 0, width: 50 })).toEqual({
      id: 'x',
      x: 125,
    });
  });
});

describe('ribbonContentX', () => {
  const scroller = (left: number, scrollLeft: number) => ({
    scrollLeft,
    getBoundingClientRect: () => ({ left }),
  });

  it('converts a viewport x into the scroller content space', () => {
    expect(ribbonContentX(300, scroller(100, 0))).toBe(200);
  });

  it('includes how far the row is scrolled', () => {
    // Regression: hand-rolled `clientX - rect.left` made every drag a
    // silent no-op once the ribbon scrolled.
    expect(ribbonContentX(300, scroller(100, 250))).toBe(450);
  });
});

describe('reorderTokensForTabDrag', () => {
  const tokens = tokensFor({ '/a': ['a1', 'a2', 'a3'], '/b': ['b1'] });

  it('moves the dragged tab within its Project only', () => {
    expect(keys(reorderTokensForTabDrag(tokens, 'tab:a1', 2))).toEqual([
      'project:/a',
      'tab:a2',
      'tab:a3',
      'tab:a1',
      'project:/b',
      'tab:b1',
    ]);
  });

  it('clamps the index to the sibling range', () => {
    expect(keys(reorderTokensForTabDrag(tokens, 'tab:a3', 99))).toEqual(
      keys(tokens)
    );
    expect(keys(reorderTokensForTabDrag(tokens, 'tab:a2', 0))).toEqual([
      'project:/a',
      'tab:a2',
      'tab:a1',
      'tab:a3',
      'project:/b',
      'tab:b1',
    ]);
  });

  it('returns the same order for an unknown tab', () => {
    expect(keys(reorderTokensForTabDrag(tokens, 'tab:zz', 1))).toEqual(
      keys(tokens)
    );
  });
});

describe('reorderTokensForProjectDrag', () => {
  const tokens = tokensFor({ '/a': ['a1'], '/b': ['b1', 'b2'], '/c': [] });

  it('moves the whole block — header and its tabs travel together', () => {
    expect(keys(reorderTokensForProjectDrag(tokens, '/b', 0))).toEqual([
      'project:/b',
      'tab:b1',
      'tab:b2',
      'project:/a',
      'tab:a1',
      'project:/c',
    ]);
  });

  it('clamps and no-ops on unknown Projects', () => {
    expect(keys(reorderTokensForProjectDrag(tokens, '/a', 99))).toEqual([
      'project:/b',
      'tab:b1',
      'tab:b2',
      'project:/c',
      'project:/a',
      'tab:a1',
    ]);
    expect(keys(reorderTokensForProjectDrag(tokens, '/zz', 0))).toEqual(
      keys(tokens)
    );
  });
});

describe('placementForOrder', () => {
  it('returns null when nothing moved', () => {
    expect(placementForOrder(['a', 'b'], ['a', 'b'], 'a')).toBeNull();
  });

  it('anchors after the left neighbor, or before the head', () => {
    expect(placementForOrder(['a', 'b', 'c'], ['b', 'a', 'c'], 'a')).toEqual({
      targetId: 'b',
      place: 'after',
    });
    expect(placementForOrder(['a', 'b', 'c'], ['c', 'a', 'b'], 'c')).toEqual({
      targetId: 'a',
      place: 'before',
    });
  });

  it('handles a dragged id missing from the final order', () => {
    expect(placementForOrder(['a', 'b'], ['b'], 'a')).toBeNull();
  });
});
