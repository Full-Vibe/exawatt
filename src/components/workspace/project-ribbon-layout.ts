/**
 * The Project ribbon is ONE row (ENG-016 D45). This pure module owns the
 * policy that keeps it one row without ever hiding work.
 *
 * D41 packed the ribbon into a hard two-row budget and dropped whatever did
 * not fit behind a `+N` button. D42 kept every tab rendered, but the budget
 * still evicted them, so the ribbon showed a different amount of truth
 * depending on how many tabs the Project you were in happened to have — at
 * 1100px a five-tab active Project evicted every other Project's chips.
 * Wrapping also meant items hopped between rows on any width change, which
 * the operator ranked as the worst of the ribbon's motion.
 *
 * The ladder, in order, each step used only when the previous runs out:
 *
 *   1. every Project open-or-mini at its natural width
 *   2. the active Project's tabs SHRINK toward `minTabWidth` (Chrome does
 *      exactly this) — the common case stops here and never scrolls
 *   3. quiet Projects FOLD into counted containers, in reverse manual
 *      order; the active Project never folds. Folding replaces eviction:
 *      the work stays visible as a number instead of vanishing
 *   4. the row scrolls horizontally, with the caller drawing edge fades
 *
 * Nothing here removes an item, so admission and `visibleIds` are no longer
 * concepts: a caller renders every target it is given.
 */

export const RIBBON_ROW_HEIGHT = 30;
export const RIBBON_COLUMN_GAP = 4;
/** Gap between different Projects — grouping reads from spacing alone
 *  (D42 review round: uniform gaps left chips floating ambiguously between
 *  their own header and the next Project's). */
export const RIBBON_GROUP_GAP = 12;

export interface RibbonLayoutPolicy {
  /** hard floor: an open tab is never drawn narrower than this */
  minTabWidth: number;
  /**
   * How much title the active Project's tabs are *entitled* to before quiet
   * Projects start folding to protect it. This is the single dial between
   * the operator's three acceptable outcomes (2026-08-03):
   *
   *   comfort == min   fold only to avoid scrolling — tabs shrink first and
   *                    the row scrolls the last inch  ("scrolling is fine")
   *   comfort >  min   fold quiet Projects earlier so tabs keep their title
   *                    and nothing scrolls             ("aggressive folding")
   *
   * and `minTabWidth` itself is the third ("narrower tabs"). Everything in
   * between is reachable, which is why this is a number and not a mode.
   */
  comfortTabWidth: number;
  /** widest an open tab is ever drawn */
  maxTabWidth: number;
  /** a folded Project's container chip: its name plus a count */
  foldedProjectWidth: number;
  columnGap: number;
  groupGap: number;
}

/** One object so the behaviour can be retuned after dogfooding without
 *  touching the algorithm (operator, 2026-08-03: "build it well enough that
 *  we can test and change our minds after playing with it"). */
export const DEFAULT_RIBBON_POLICY: RibbonLayoutPolicy = {
  // Chrome's model (operator, 2026-08-04, superseding the 380–400px band):
  // a tab is as wide as its title wants up to a cap, shrinks with its
  // siblings as the row fills, and only scrolls once the floor is reached.
  //
  // The floor is set from what is LEFT for the title, not from the tab box.
  // An Agent tab also carries a status glyph, the delegated-child dots, and
  // the active tab's close control — about 84px of chrome once the harness
  // glyph has dropped out. At 132px that left 35px of title, roughly four
  // characters; this is the width at which a delegating tab still shows a
  // couple of real words.
  minTabWidth: 180,
  // Above the floor: quiet Projects fold to protect roughly this much title
  // before the row gives up and scrolls.
  comfortTabWidth: 208,
  // Chrome parity. Past this a tab is spending space it cannot use — the
  // title has already fit and the rest is dead padding.
  maxTabWidth: 240,
  foldedProjectWidth: 124,
  columnGap: RIBBON_COLUMN_GAP,
  groupGap: RIBBON_GROUP_GAP,
};

export type ProjectPresentation = 'open' | 'mini' | 'folded';

export interface RibbonProjectInput {
  dir: string;
  /** measured or estimated width of the Project's own header chip */
  headerWidth: number;
  /** width of the folded container chip (name + count); falls back to the
   *  policy cap. Content-derived so a short name does not leave dead space. */
  foldedWidth?: number;
  /** the Project's tabs, in display order */
  tabs: ReadonlyArray<{
    id: string;
    /** natural width when drawn with its title */
    openWidth: number;
    /** width as a glyph chip */
    miniWidth: number;
  }>;
  active: boolean;
}

export interface RibbonTarget {
  id: string;
  x: number;
  y: number;
  row: number;
  width: number;
}

export interface RibbonRowLayout {
  targets: Map<string, RibbonTarget>;
  /** what each Project ended up rendering as */
  presentation: Map<string, ProjectPresentation>;
  /** total laid-out width; more than the available width means it scrolls */
  contentWidth: number;
  scrollable: boolean;
  height: number;
  /** always 1 while any Project is open — the row count cannot vary now */
  rows: number;
}

const tabKey = (id: string) => `tab:${id}`;
const headerKey = (dir: string) => `project:${dir}`;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Width a Project's block occupies in a given presentation. */
function blockWidth(
  project: RibbonProjectInput,
  presentation: ProjectPresentation,
  policy: RibbonLayoutPolicy,
  openTabWidth: number
): number {
  if (presentation === 'folded') {
    return Math.min(
      policy.foldedProjectWidth,
      project.foldedWidth ?? policy.foldedProjectWidth
    );
  }
  return project.tabs.reduce(
    (total, tab) =>
      total +
      policy.columnGap +
      (presentation === 'open' ? openTabWidth : tab.miniWidth),
    project.headerWidth
  );
}

/**
 * Lay the ribbon out as one row.
 *
 * Placement always follows the caller's manual order; the policy only ever
 * changes how WIDE something is drawn, never where it sits relative to its
 * neighbours. That is what keeps a selection change from reordering work.
 */
export function layoutRibbonRow(
  projects: readonly RibbonProjectInput[],
  availableWidth: number,
  policy: RibbonLayoutPolicy = DEFAULT_RIBBON_POLICY
): RibbonRowLayout {
  const width = Math.max(1, Math.floor(availableWidth));
  const active = projects.find(project => project.active) ?? null;

  // How many Projects must fold? Answer it for the WORST CASE — the
  // Project with the most tabs being the open one — rather than for the
  // current selection. Otherwise how much of the ribbon you can see would
  // depend on which Project you happen to be in, which is exactly the
  // complaint D45 exists to fix: a five-tab Project used to blank every
  // other Project's chips while a one-tab Project showed them all.
  const hungriest = projects.reduce<RibbonProjectInput | null>(
    (worst, project) =>
      !worst || project.tabs.length > worst.tabs.length ? project : worst,
    null
  );
  const widthWithFolds = (
    foldCount: number,
    openProject: RibbonProjectInput | null,
    openWidth: number
  ) => {
    // `slice(-0)` is `slice(0)` — the WHOLE array. Folding "none" therefore
    // used to measure a row with EVERY quiet Project folded, while the
    // placement below correctly read 0 as none. The probe and the row it was
    // predicting were inverted, so the search stopped the moment the
    // all-folded row fit and the ribbon then drew the un-folded one: widening
    // 1180px → 1200px unfolded five Projects at once, snapped tabs from 206px
    // back to the floor, and started the row scrolling (measured 2026-08-04).
    const candidates = projects.filter(
      project => project !== openProject && project.tabs.length > 0
    );
    const foldTargets = new Set(
      (foldCount > 0 ? candidates.slice(-foldCount) : []).map(
        project => project.dir
      )
    );
    return projects.reduce(
      (total, project, index) =>
        total +
        (index === 0 ? 0 : policy.groupGap) +
        blockWidth(
          project,
          foldTargets.has(project.dir)
            ? 'folded'
            : project === openProject
              ? 'open'
              : 'mini',
          policy,
          openWidth
        ),
      0
    );
  };
  const foldable = projects.filter(project => project.tabs.length > 0).length;
  // Fold until the WORST-CASE row fits with tabs at their entitled width.
  // Raising `comfortTabWidth` above the floor buys title length by folding
  // quiet Projects sooner; leaving it at the floor folds only to avoid
  // scrolling. Either way the count is computed from the hungriest Project,
  // never the current selection — that is what keeps the ribbon's
  // presentation identical wherever you are standing.
  const entitledWidth = Math.max(policy.minTabWidth, policy.comfortTabWidth);
  let foldCount = 0;
  while (
    foldCount < Math.max(0, foldable - 1) &&
    widthWithFolds(foldCount, hungriest, entitledWidth) > width
  ) {
    foldCount += 1;
  }

  // Now place the ACTUAL selection under that fold budget: the folded set
  // is the trailing `foldCount` Projects that are not the one you are in.
  const foldCandidates = projects.filter(
    project => !project.active && project.tabs.length > 0
  );
  const folded = new Set(
    foldCount > 0
      ? foldCandidates.slice(-foldCount).map(project => project.dir)
      : []
  );
  const presentation = new Map<string, ProjectPresentation>(
    projects.map(project => [
      project.dir,
      (project.active
        ? 'open'
        : folded.has(project.dir)
          ? 'folded'
          : 'mini') as ProjectPresentation,
    ])
  );

  // Steps 1-2: with the fold budget known, give the active Project's tabs
  // whatever room is left, clamped into [minTabWidth, natural].
  const natural = active
    ? Math.min(
        policy.maxTabWidth,
        Math.max(
          policy.minTabWidth,
          ...active.tabs.map(tab => Math.min(tab.openWidth, policy.maxTabWidth))
        )
      )
    : policy.maxTabWidth;
  let openTabWidth = natural;
  if (active && active.tabs.length > 0) {
    const others = projects
      .filter(project => project !== active)
      .reduce(
        (total, project) =>
          total +
          policy.groupGap +
          blockWidth(
            project,
            presentation.get(project.dir) ?? 'mini',
            policy,
            0
          ),
        0
      );
    const room =
      width -
      others -
      active.headerWidth -
      policy.columnGap * active.tabs.length;
    const share = Math.floor(room / active.tabs.length);
    openTabWidth = clamp(
      Number.isFinite(share) ? share : natural,
      policy.minTabWidth,
      natural
    );
  }

  // Step 4: place. Anything still wider than the viewport scrolls.
  const targets = new Map<string, RibbonTarget>();
  let x = 0;
  projects.forEach((project, index) => {
    if (index > 0) x += policy.groupGap;
    const mode = presentation.get(project.dir) ?? 'mini';
    const headerWidth =
      mode === 'folded'
        ? Math.min(
            policy.foldedProjectWidth,
            project.foldedWidth ?? policy.foldedProjectWidth
          )
        : project.headerWidth;
    targets.set(headerKey(project.dir), {
      id: headerKey(project.dir),
      x,
      y: 0,
      row: 0,
      width: headerWidth,
    });
    x += headerWidth;
    if (mode === 'folded') return;
    for (const tab of project.tabs) {
      x += policy.columnGap;
      const tabWidth = mode === 'open' ? openTabWidth : tab.miniWidth;
      targets.set(tabKey(tab.id), {
        id: tabKey(tab.id),
        x,
        y: 0,
        row: 0,
        width: tabWidth,
      });
      x += tabWidth;
    }
  });

  return {
    targets,
    presentation,
    contentWidth: x,
    scrollable: x > width,
    height: projects.length === 0 ? 0 : RIBBON_ROW_HEIGHT,
    rows: projects.length === 0 ? 0 : 1,
  };
}

/**
 * Which Project header should be PINNED at the left edge, and where (D50).
 *
 * Once the row scrolls, the Project you are inside scrolls away with it and
 * the strip stops answering "where am I" — the operator's report:
 * "as I horizontally scroll … I find myself forgetting what project I'm in."
 * The fix is the UIScrollView section-header grammar, laid on its side: the
 * current Project's header parks at the left edge, its own tabs slide
 * underneath it, and the NEXT Project's header pushes it out of the way
 * rather than crossfading over it.
 *
 * Pure so the motion can be reasoned about and tested without a viewport:
 * given the laid-out row and a scroll offset, there is exactly one right
 * answer. `offsetX` is 0 while parked and goes NEGATIVE during the push, so
 * the caller only ever writes one transform.
 *
 * Returns null when nothing should be pinned — at rest, or when the left
 * edge sits in a folded Project (a folded block is nothing but its own
 * header, so there is nothing for it to hold above).
 */
export interface RibbonStickyProject {
  dir: string;
  /** translateX for the pinned header: 0 parked, negative while pushed out */
  offsetX: number;
  /** how far the push has run, 0→1; the incoming header owns the rest */
  pushProgress: number;
}

export function stickyProjectForScroll(
  projects: readonly { dir: string }[],
  layout: RibbonRowLayout,
  scrollLeft: number,
  policy: RibbonLayoutPolicy = DEFAULT_RIBBON_POLICY
): RibbonStickyProject | null {
  if (scrollLeft <= 0) return null;

  for (let index = projects.length - 1; index >= 0; index -= 1) {
    const project = projects[index];
    const header = layout.targets.get(headerKey(project.dir));
    if (!header) continue;
    // The block the left edge is standing in.
    if (header.x > scrollLeft) continue;

    // A folded Project is only its container chip: nothing scrolls under it.
    if (layout.presentation.get(project.dir) === 'folded') return null;

    const next = projects[index + 1];
    const nextHeader = next
      ? layout.targets.get(headerKey(next.dir))
      : undefined;
    const blockEnd = nextHeader
      ? nextHeader.x - policy.groupGap
      : layout.contentWidth;
    // Already scrolled clean past this Project's tabs — the next header is
    // in place on its own and needs no help.
    if (blockEnd <= scrollLeft) return null;

    // Parked at 0 until the incoming header reaches us, then pushed out by
    // exactly as much as it has arrived.
    const room = blockEnd - scrollLeft - header.width;
    if (room >= 0) return { dir: project.dir, offsetX: 0, pushProgress: 0 };
    const offsetX = Math.max(-header.width, room);
    const pushProgress =
      header.width > 0 ? Math.min(1, -offsetX / header.width) : 0;
    return { dir: project.dir, offsetX, pushProgress };
  }
  return null;
}

export function ribbonHeightForRows(rows: number): number {
  return rows <= 0 ? 0 : RIBBON_ROW_HEIGHT;
}

/** Stable partition: manual order survives within each side of the divider. */
export function orderProjectsForRibbon<T extends { dir: string }>(
  projects: readonly T[],
  dormantProjectDirs: ReadonlySet<string>
): T[] {
  return [
    ...projects.filter(project => !dormantProjectDirs.has(project.dir)),
    ...projects.filter(project => dormantProjectDirs.has(project.dir)),
  ];
}
