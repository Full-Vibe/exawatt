import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RIBBON_POLICY,
  layoutRibbonRow,
  orderProjectsForRibbon,
  RIBBON_COLUMN_GAP,
  RIBBON_GROUP_GAP,
  RIBBON_ROW_HEIGHT,
  ribbonHeightForRows,
  type RibbonProjectInput,
} from './project-ribbon-layout';

const project = (
  dir: string,
  tabCount: number,
  active = false
): RibbonProjectInput => ({
  dir,
  headerWidth: 100,
  foldedWidth: 120,
  active,
  tabs: Array.from({ length: tabCount }, (_, index) => ({
    id: `${dir}-${index}`,
    openWidth: 400,
    miniWidth: 40,
  })),
});

const modes = (projects: RibbonProjectInput[], width: number) =>
  Object.fromEntries(layoutRibbonRow(projects, width).presentation.entries());

describe('layoutRibbonRow', () => {
  it('is one row whose height cannot vary', () => {
    const wide = layoutRibbonRow([project('/a', 2, true)], 2000);
    const tight = layoutRibbonRow(
      [project('/a', 9, true), project('/b', 9), project('/c', 9)],
      300
    );
    expect(wide.rows).toBe(1);
    expect(tight.rows).toBe(1);
    expect(wide.height).toBe(RIBBON_ROW_HEIGHT);
    expect(tight.height).toBe(RIBBON_ROW_HEIGHT);
    expect(ribbonHeightForRows(1)).toBe(RIBBON_ROW_HEIGHT);
    for (const target of tight.targets.values()) {
      expect(target.row).toBe(0);
      expect(target.y).toBe(0);
    }
  });

  it('opens the active Project and minis the rest when everything fits', () => {
    expect(modes([project('/a', 2, true), project('/b', 2)], 2000)).toEqual({
      '/a': 'open',
      '/b': 'mini',
    });
  });

  it('shrinks the active tabs before folding anyone (Chrome order)', () => {
    const projects = [project('/a', 4, true), project('/b', 2)];
    const policy = DEFAULT_RIBBON_POLICY;
    const widthOf = (available: number) =>
      layoutRibbonRow(projects, available).targets.get('tab:/a-0')?.width ?? 0;

    // With room to spare a tab takes the cap and not a pixel more: past it
    // the title has already fit and the rest would be dead padding.
    expect(widthOf(2000)).toBe(policy.maxTabWidth);

    // Squeezing the row walks tabs DOWN to the floor rather than snapping
    // between two sizes — the elastic half of the Chrome model.
    const sweep = [1600, 1400, 1200, 1000, 700].map(widthOf);
    expect(sweep).toEqual([...sweep].sort((a, b) => b - a));
    expect(Math.min(...sweep)).toBe(policy.minTabWidth);
    expect(
      sweep.some(w => w > policy.minTabWidth && w < policy.maxTabWidth)
    ).toBe(true);

    // nobody folded merely so the tabs could stay wide
    expect(layoutRibbonRow(projects, 1400).presentation.get('/b')).toBe('mini');
  });

  it('never draws a tab wider than the title it has to show', () => {
    // A Project of shortish titles must not inflate to the cap and strand its
    // labels in padding — the cap is a ceiling, not a target. The floor still
    // wins underneath it: a tab is never drawn narrower than minTabWidth.
    const policy = DEFAULT_RIBBON_POLICY;
    const wanted = Math.round((policy.minTabWidth + policy.maxTabWidth) / 2);
    const modest: RibbonProjectInput = {
      dir: '/modest',
      headerWidth: 100,
      foldedWidth: 120,
      active: true,
      tabs: [
        { id: 'modest-0', openWidth: wanted, miniWidth: 40 },
        { id: 'modest-1', openWidth: wanted, miniWidth: 40 },
      ],
    };
    const layout = layoutRibbonRow([modest], 4000);
    expect(layout.targets.get('tab:modest-0')?.width).toBe(wanted);
    expect(layout.targets.get('tab:modest-1')?.width).toBe(wanted);

    // …and a Project whose titles want less than the floor still gets the
    // floor, not a strip of unreadable slivers.
    const tiny = layoutRibbonRow(
      [
        {
          ...modest,
          dir: '/tiny',
          tabs: [{ id: 'tiny-0', openWidth: 60, miniWidth: 40 }],
        },
      ],
      4000
    );
    expect(tiny.targets.get('tab:tiny-0')?.width).toBe(policy.minTabWidth);
  });

  it('folds — never evicts — once shrinking is exhausted', () => {
    const layout = layoutRibbonRow(
      [project('/a', 5, true), project('/b', 3), project('/c', 3)],
      620
    );
    expect([...layout.presentation.values()]).toContain('folded');
    // the active Project is never the one that folds
    expect(layout.presentation.get('/a')).toBe('open');
    // a folded Project still gets a target, so its counted container draws
    for (const [dir, mode] of layout.presentation) {
      if (mode !== 'folded') continue;
      expect(layout.targets.get(`project:${dir}`)).toBeTruthy();
    }
  });

  it('keeps every Project in the SAME presentation whichever one is active', () => {
    // The D45 headline: what the ribbon shows must not depend on how many
    // tabs the Project you happen to be in has.
    const dirs = ['/a', '/b', '/c', '/d'];
    const counts = [5, 1, 2, 1];
    const modeByActive = dirs.map(activeDir =>
      layoutRibbonRow(
        dirs.map((dir, index) =>
          project(dir, counts[index], dir === activeDir)
        ),
        700
      )
    );
    for (const dir of dirs) {
      const asInactive = modeByActive
        .filter((_, index) => dirs[index] !== dir)
        .map(layout => layout.presentation.get(dir));
      expect(new Set(asInactive).size).toBe(1);
    }
  });

  it('scrolls only when even a fully folded row overflows', () => {
    const comfortable = layoutRibbonRow(
      [project('/a', 2, true), project('/b', 2)],
      2000
    );
    expect(comfortable.scrollable).toBe(false);
    const extreme = layoutRibbonRow(
      Array.from({ length: 12 }, (_, index) =>
        project(`/p${index}`, 3, index === 0)
      ),
      500
    );
    expect(extreme.scrollable).toBe(true);
    expect(extreme.contentWidth).toBeGreaterThan(500);
  });

  it('separates Projects by the group gap and own tabs by the column gap', () => {
    const layout = layoutRibbonRow(
      [project('/a', 1, true), project('/b', 1)],
      2000
    );
    const header = layout.targets.get('project:/a')!;
    const tab = layout.targets.get('tab:/a-0')!;
    const next = layout.targets.get('project:/b')!;
    expect(tab.x).toBe(header.x + header.width + RIBBON_COLUMN_GAP);
    expect(next.x).toBe(tab.x + tab.width + RIBBON_GROUP_GAP);
  });

  it('gives every active-Project tab the same Chrome-style width', () => {
    const active = project('/a', 3, true);
    active.tabs[0].openWidth = 180;
    active.tabs[1].openWidth = 310;
    active.tabs[2].openWidth = 700;
    const layout = layoutRibbonRow([active, project('/b', 2)], 1400);
    const widths = active.tabs.map(
      tab => layout.targets.get(`tab:${tab.id}`)?.width
    );
    expect(new Set(widths).size).toBe(1);
    expect(widths[0]).toBeGreaterThanOrEqual(DEFAULT_RIBBON_POLICY.minTabWidth);
  });

  it('places in manual order regardless of which Project is active', () => {
    const order = (activeDir: string) =>
      [
        ...layoutRibbonRow(
          ['/a', '/b', '/c'].map(dir => project(dir, 1, dir === activeDir)),
          2000
        ).targets.entries(),
      ]
        .filter(([id]) => id.startsWith('project:'))
        .sort((a, b) => a[1].x - b[1].x)
        .map(([id]) => id);
    expect(order('/a')).toEqual(order('/c'));
  });

  it('handles an empty ribbon', () => {
    const layout = layoutRibbonRow([], 800);
    expect(layout.rows).toBe(0);
    expect(layout.height).toBe(0);
    expect(layout.scrollable).toBe(false);
    expect(ribbonHeightForRows(0)).toBe(0);
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

describe('the comfort dial (D45 tuning)', () => {
  const shape = (activeIdx: number) => [
    project('/a', 5, activeIdx === 0),
    project('/b', 2, activeIdx === 1),
    project('/c', 2, activeIdx === 2),
  ];

  it('at the floor, shrinks tabs and scrolls rather than folding', () => {
    const layout = layoutRibbonRow(shape(0), 900, {
      ...DEFAULT_RIBBON_POLICY,
      minTabWidth: 100,
      comfortTabWidth: 100,
    });
    expect([...layout.presentation.values()]).not.toContain('folded');
    expect(layout.targets.get('tab:/a-0')?.width).toBeLessThan(200);
  });

  it('raised, folds quiet Projects so the tabs keep their title', () => {
    const layout = layoutRibbonRow(shape(0), 900, {
      ...DEFAULT_RIBBON_POLICY,
      minTabWidth: 100,
      comfortTabWidth: 200,
    });
    expect([...layout.presentation.values()]).toContain('folded');
    // the Project you are in never folds, and its tabs got the room back
    expect(layout.presentation.get('/a')).toBe('open');
    expect(layout.targets.get('tab:/a-0')?.width).toBeGreaterThan(
      layoutRibbonRow(shape(0), 900, {
        ...DEFAULT_RIBBON_POLICY,
        minTabWidth: 100,
        comfortTabWidth: 100,
      }).targets.get('tab:/a-0')!.width
    );
  });

  it('stays selection-invariant at every setting of the dial', () => {
    for (const comfortTabWidth of [100, 160, 220, 280]) {
      const policy = {
        ...DEFAULT_RIBBON_POLICY,
        minTabWidth: 100,
        comfortTabWidth,
      };
      const modes = [0, 1, 2].map(active =>
        layoutRibbonRow(shape(active), 900, policy)
      );
      // '/c' is inactive in the first two selections; its presentation must
      // not depend on which of them is current
      expect(modes[0].presentation.get('/c')).toBe(
        modes[1].presentation.get('/c')
      );
    }
  });
});
