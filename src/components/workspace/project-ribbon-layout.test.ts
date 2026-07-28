import { describe, expect, it } from 'vitest';
import {
  layoutProjectRibbon,
  orderProjectsForRibbon,
  RIBBON_OVERFLOW_WIDTH,
  RIBBON_ROW_HEIGHT,
  RIBBON_ROW_GAP,
} from './project-ribbon-layout';

const item = (id: string, width = 100, priority = 4) => ({
  id,
  width,
  priority,
});

describe('layoutProjectRibbon', () => {
  it('lays out a compact first row, then a bounded second row', () => {
    const layout = layoutProjectRibbon(
      [item('a'), item('b'), item('c'), item('d')],
      208
    );
    expect([...layout.targets.values()]).toMatchObject([
      { id: 'a', x: 0, y: 0, row: 0 },
      { id: 'b', x: 104, y: 0, row: 0 },
      { id: 'c', x: 0, y: RIBBON_ROW_HEIGHT + RIBBON_ROW_GAP, row: 1 },
      { id: 'd', x: 104, y: RIBBON_ROW_HEIGHT + RIBBON_ROW_GAP, row: 1 },
    ]);
    expect(layout.height).toBe(RIBBON_ROW_HEIGHT * 2 + RIBBON_ROW_GAP);
    expect(layout.overflowTarget).toBeNull();
  });

  it('reserves a real overflow slot and never creates a third row', () => {
    const layout = layoutProjectRibbon(
      Array.from({ length: 12 }, (_, index) => item(`i${index}`, 84)),
      300
    );
    expect(layout.rows).toBe(2);
    expect(layout.hiddenIds.length).toBeGreaterThan(0);
    expect(layout.overflowTarget).toMatchObject({
      width: RIBBON_OVERFLOW_WIDTH,
      row: 1,
    });
    expect(
      Math.max(...[...layout.targets.values()].map(target => target.row))
    ).toBeLessThan(2);
  });

  it('keeps selected work visible without changing its manual position', () => {
    const items = [
      item('early-1', 120, 4),
      item('early-2', 120, 4),
      item('active-project', 110, 0),
      item('active-tab', 170, 1),
      item('late', 120, 4),
    ];
    const layout = layoutProjectRibbon(items, 260);
    expect(layout.visibleIds.has('active-project')).toBe(true);
    expect(layout.visibleIds.has('active-tab')).toBe(true);
    const visibleInOrder = items
      .filter(entry => layout.visibleIds.has(entry.id))
      .map(entry => entry.id);
    expect([...layout.targets.keys()]).toEqual(visibleInOrder);
  });

  it('handles forty Initiatives without exceeding its vertical contract', () => {
    const layout = layoutProjectRibbon(
      Array.from({ length: 40 }, (_, index) =>
        item(`initiative-${index}`, 150, index === 31 ? 0 : 4)
      ),
      1_000
    );
    expect(layout.rows).toBe(2);
    expect(layout.height).toBe(RIBBON_ROW_HEIGHT * 2 + RIBBON_ROW_GAP);
    expect(layout.visibleIds.has('initiative-31')).toBe(true);
    expect(layout.hiddenIds.length).toBeGreaterThan(20);
  });
});

describe('orderProjectsForRibbon', () => {
  it('moves dormant empties to the tail while preserving relative order', () => {
    const projects = ['a', 'b', 'c', 'd'].map(dir => ({ dir }));
    expect(
      orderProjectsForRibbon(projects, new Set(['b', 'd'])).map(
        project => project.dir
      )
    ).toEqual(['a', 'c', 'b', 'd']);
  });
});
