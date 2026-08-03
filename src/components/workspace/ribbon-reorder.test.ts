import { describe, expect, it } from 'vitest';
import {
  dropIndexForPointer,
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
      priority: 0,
    });
    for (const tab of project.tabs) {
      out.push({
        key: `tab:${tab.id}`,
        kind: 'tab',
        project,
        tab,
        priority: 2,
      });
    }
  }
  return out;
}

const keys = (tokens: readonly RibbonToken[]) =>
  tokens.map(token => token.key);

describe('dropIndexForPointer', () => {
  const centers = [
    { id: 'a', x: 50, y: 0, row: 0 },
    { id: 'b', x: 150, y: 0, row: 0 },
    { id: 'c', x: 50, y: ROW, row: 1 },
  ];

  it('counts siblings whose center precedes the pointer in reading order', () => {
    expect(dropIndexForPointer(centers, { x: 10, y: 5 }, ROW)).toBe(0);
    expect(dropIndexForPointer(centers, { x: 100, y: 5 }, ROW)).toBe(1);
    expect(dropIndexForPointer(centers, { x: 400, y: 5 }, ROW)).toBe(2);
  });

  it('is row-aware: a pointer on row two sits after every row-one sibling', () => {
    expect(dropIndexForPointer(centers, { x: 10, y: ROW + 5 }, ROW)).toBe(2);
    expect(dropIndexForPointer(centers, { x: 400, y: ROW + 5 }, ROW)).toBe(3);
  });

  it('derives centers from targets', () => {
    expect(slotCenter({ id: 'x', x: 100, y: 0, row: 0, width: 50 })).toEqual({
      id: 'x',
      x: 125,
      y: 0,
      row: 0,
    });
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
