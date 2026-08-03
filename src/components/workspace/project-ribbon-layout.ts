/**
 * The Project ribbon has one job the browser's flexbox algorithm cannot do for
 * us: preserve a compact two-row budget while guaranteeing that the selected
 * work remains reachable. This pure module owns that policy. Rendering and
 * motion consume its target rectangles; neither gets to invent ordering.
 */

export const RIBBON_ROW_HEIGHT = 30;
export const RIBBON_COLUMN_GAP = 4;
export const RIBBON_ROW_GAP = 4;
export const RIBBON_MAX_ROWS = 2;
export const RIBBON_OVERFLOW_WIDTH = 44;

export interface RibbonLayoutInput {
  id: string;
  width: number;
  /** Lower numbers survive overflow first. */
  priority: number;
  /** Admission dependency: this item may only be visible while `parentId`
   *  is (a tab never renders without its Project header). Parents must
   *  carry a stricter priority than their dependents. */
  parentId?: string;
}

export interface RibbonTarget {
  id: string;
  x: number;
  y: number;
  row: number;
  width: number;
}

export interface RibbonLayout {
  targets: Map<string, RibbonTarget>;
  visibleIds: ReadonlySet<string>;
  hiddenIds: readonly string[];
  overflowTarget: RibbonTarget | null;
  rows: number;
  height: number;
}

interface Packed {
  targets: Map<string, RibbonTarget>;
  rows: number;
}

function normalizedWidth(width: number, availableWidth: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.min(Math.ceil(width), Math.max(1, availableWidth));
}

function pack(
  items: readonly Pick<RibbonLayoutInput, 'id' | 'width'>[],
  availableWidth: number,
  maxRows: number
): Packed | null {
  const targets = new Map<string, RibbonTarget>();
  let row = 0;
  let x = 0;

  for (const item of items) {
    const width = normalizedWidth(item.width, availableWidth);
    if (x > 0 && x + width > availableWidth) {
      row += 1;
      x = 0;
    }
    if (row >= maxRows) return null;
    targets.set(item.id, {
      id: item.id,
      x,
      y: row * (RIBBON_ROW_HEIGHT + RIBBON_ROW_GAP),
      row,
      width,
    });
    x += width + RIBBON_COLUMN_GAP;
  }

  return { targets, rows: items.length === 0 ? 0 : row + 1 };
}

/**
 * Compute stable ribbon target bounds.
 *
 * When everything does not fit, priority decides admission and original order
 * decides placement. That means the active Project/header/tab can remain
 * visible without visually reordering the operator's manually arranged work.
 * A real overflow target is packed alongside the admitted items, so it never
 * overlays or clips the final Initiative.
 */
export function layoutProjectRibbon(
  items: readonly RibbonLayoutInput[],
  availableWidth: number,
  {
    maxRows = RIBBON_MAX_ROWS,
    overflowWidth = RIBBON_OVERFLOW_WIDTH,
  }: { maxRows?: number; overflowWidth?: number } = {}
): RibbonLayout {
  const width = Math.max(1, Math.floor(availableWidth));
  const all = pack(items, width, maxRows);
  if (all) {
    const rows = all.rows;
    return {
      targets: all.targets,
      visibleIds: new Set(items.map(item => item.id)),
      hiddenIds: [],
      overflowTarget: null,
      rows,
      height:
        rows === 0 ? 0 : rows * RIBBON_ROW_HEIGHT + (rows - 1) * RIBBON_ROW_GAP,
    };
  }

  const admitted = new Set<string>();
  const byPriority = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.priority - b.item.priority || a.index - b.index);
  const overflow: RibbonLayoutInput = {
    id: '__ribbon-overflow__',
    width: overflowWidth,
    priority: Number.NEGATIVE_INFINITY,
  };

  for (const candidate of byPriority) {
    // An orphan chip beside a hidden Project header reads as belonging to
    // its visible neighbor; a dependent is only admissible with its parent.
    if (candidate.item.parentId && !admitted.has(candidate.item.parentId)) {
      continue;
    }
    const proposed = new Set(admitted).add(candidate.item.id);
    const ordered = items.filter(item => proposed.has(item.id));
    if (pack([...ordered, overflow], width, maxRows)) {
      admitted.add(candidate.item.id);
    }
  }

  const visible = items.filter(item => admitted.has(item.id));
  const packed = pack([...visible, overflow], width, maxRows);
  // The overflow button itself is narrower than every supported viewport. The
  // fallback keeps the function total for synthetic zero-width unit fixtures.
  const overflowOnly = packed ?? pack([overflow], width, maxRows);
  const targets = overflowOnly?.targets ?? new Map<string, RibbonTarget>();
  const overflowTarget = targets.get(overflow.id) ?? null;
  targets.delete(overflow.id);
  const hiddenIds = items
    .filter(item => !admitted.has(item.id))
    .map(item => item.id);
  const rows = overflowOnly?.rows ?? 1;

  return {
    targets,
    visibleIds: admitted,
    hiddenIds,
    overflowTarget,
    rows,
    height: rows * RIBBON_ROW_HEIGHT + (rows - 1) * RIBBON_ROW_GAP,
  };
}

/**
 * The strip's outer height must be SELECTION-INVARIANT (D42): switching
 * Projects may never resize the terminal below. Callers pass one item list
 * per hypothetical selection (each Project active in turn); the reserved
 * row count is the maximum any selection needs, so no switch can change it.
 * Only data changes — open/close — move this number, and the container
 * snaps rather than animating it.
 */
export function stableRibbonRows(
  variants: ReadonlyArray<readonly RibbonLayoutInput[]>,
  availableWidth: number,
  options?: { maxRows?: number; overflowWidth?: number }
): number {
  return variants.reduce(
    (rows, items) =>
      items.length === 0
        ? rows
        : Math.max(
            rows,
            layoutProjectRibbon(items, availableWidth, options).rows
          ),
    0
  );
}

export function ribbonHeightForRows(rows: number): number {
  return rows <= 0 ? 0 : rows * RIBBON_ROW_HEIGHT + (rows - 1) * RIBBON_ROW_GAP;
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
