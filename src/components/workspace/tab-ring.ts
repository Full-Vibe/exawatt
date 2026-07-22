/**
 * The tab ring (ENG-002 / ENG-016 D18, D19): every visible section of the
 * strip in display order forms ONE global ring. ⌘⇧[/⌘⇧] rotate through it
 * and ⌘1–⌘9 jump straight to a tab position. Stopped tabs are deliberately
 * ring members — a stopped Session is a real tab with a real restore
 * surface, not a hole in the strip. Open zero-tab Projects are ring members
 * too (D19): a Project kept open with no Sessions is a real destination —
 * cycling lands on its empty state (the Agent composer) instead of skipping
 * it, which read as "is this Project even open?".
 *
 * Pure and unit-tested: the interactive bug where cycling silently stopped
 * advancing lived in untested inline state math.
 */

export interface RingProject<T extends { id: string }> {
  dir: string;
  activeTabId: string | null;
  tabs: T[];
}

export interface RingTarget<T> {
  dir: string;
  /** null = the Project's zero-tab empty state (its composer), a real stop */
  tab: T | null;
}

/** every ring stop in display order: each tab, plus one stop per open
 *  zero-tab Project so cycling visits it instead of skipping it */
function flatten<T extends { id: string }>(
  projects: ReadonlyArray<RingProject<T>>
): Array<RingTarget<T>> {
  return projects.flatMap((g): Array<RingTarget<T>> =>
    g.tabs.length === 0
      ? [{ dir: g.dir, tab: null }]
      : g.tabs.map(tab => ({ dir: g.dir, tab }))
  );
}

/**
 * The stop `delta` steps around the ring from the active stop, wrapping
 * across Project boundaries. When the active stop cannot be resolved (stale
 * id), recovery still ADVANCES from the nearest anchor instead of
 * re-landing on it — a resolution failure must never turn the ring into a
 * fixed point where repeated presses go nowhere.
 */
export function nextTabInRing<T extends { id: string }>(
  projects: ReadonlyArray<RingProject<T>>,
  activeDir: string | null,
  delta: 1 | -1
): RingTarget<T> | null {
  const flat = flatten(projects);
  if (flat.length === 0) return null;

  const active = projects.find(g => g.dir === activeDir);
  const cur = flat.findIndex(
    e =>
      e.dir === activeDir &&
      (e.tab === null || e.tab.id === active?.activeTabId)
  );
  if (cur !== -1) {
    return flat[(cur + delta + flat.length) % flat.length];
  }

  // Stale active tab id: recover on the current Project's first stop (never
  // yank the user to another Project on a mere resolution hiccup);
  // otherwise step into the ring from the top.
  const anchor = flat.findIndex(e => e.dir === activeDir);
  if (anchor !== -1) return flat[anchor];
  return flat[delta === 1 ? 0 : flat.length - 1];
}

/** The tab at ordinal `index` (0-based) among REAL tabs, for ⌘1–⌘9.
 *  Ordinals deliberately skip zero-tab Project stops: ⌘digit is "select
 *  Session tab N" (D18) and numbering empty sections would shift every
 *  tab's ordinal when a Project merely opens or closes. */
export function tabAtOrdinal<T extends { id: string }>(
  projects: ReadonlyArray<RingProject<T>>,
  index: number
): { dir: string; tab: T } | null {
  const tabs = projects.flatMap(g => g.tabs.map(tab => ({ dir: g.dir, tab })));
  // ⌘9 is LAST-tab, like Chrome (D27); ⌘1–8 stay positional
  if (index === 8) return tabs[tabs.length - 1] ?? null;
  return index < 8 ? (tabs[index] ?? null) : null;
}

// ── Arrangement (ENG-016 D20) ──────────────────────────────────────────
// With ⌘1–9 and ⌘⌥1–9 as ordinals, ORDER is an interface: tabs arrange
// within their Project (grouping is directory truth and never changes by
// drag) and Projects arrange globally. Pure so persistence and every ring
// consumer inherit the new order for free.

interface ArrangeProject<T extends { id: string }> {
  dir: string;
  tabs: T[];
}

/** Move `tabId` one step within its Project. Returns null when it cannot
 *  move (unknown id, or already at its Project's edge — arrangement never
 *  crosses Projects; grouping is directory truth). */
export function moveTabWithinProject<
  T extends { id: string },
  P extends ArrangeProject<T>,
>(projects: ReadonlyArray<P>, tabId: string, delta: 1 | -1): P[] | null {
  for (const project of projects) {
    const from = project.tabs.findIndex(tab => tab.id === tabId);
    if (from === -1) continue;
    const to = from + delta;
    if (to < 0 || to >= project.tabs.length) return null;
    const tabs = [...project.tabs];
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    return projects.map(p => (p === project ? { ...p, tabs } : p));
  }
  return null;
}

/** Drop `tabId` beside `targetTabId` (same Project only). */
export function placeTabBeside<
  T extends { id: string },
  P extends ArrangeProject<T>,
>(
  projects: ReadonlyArray<P>,
  tabId: string,
  targetTabId: string,
  place: 'before' | 'after'
): P[] | null {
  if (tabId === targetTabId) return null;
  for (const project of projects) {
    const from = project.tabs.findIndex(tab => tab.id === tabId);
    const targetAt = project.tabs.findIndex(tab => tab.id === targetTabId);
    if (from === -1 && targetAt === -1) continue;
    // dragging across Projects is not an arrangement — grouping is truth
    if (from === -1 || targetAt === -1) return null;
    const tabs = [...project.tabs];
    const [moved] = tabs.splice(from, 1);
    const anchor = tabs.findIndex(tab => tab.id === targetTabId);
    tabs.splice(place === 'before' ? anchor : anchor + 1, 0, moved);
    if (tabs.every((tab, i) => tab === project.tabs[i])) return null;
    return projects.map(p => (p === project ? { ...p, tabs } : p));
  }
  return null;
}

/** Move the Project group `dir` one step in the global order. */
export function moveProjectInList<P extends { dir: string }>(
  projects: ReadonlyArray<P>,
  dir: string,
  delta: 1 | -1
): P[] | null {
  const from = projects.findIndex(project => project.dir === dir);
  if (from === -1) return null;
  const to = from + delta;
  if (to < 0 || to >= projects.length) return null;
  const next = [...projects];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Drop Project `dir` beside Project `targetDir`. */
export function placeProjectBeside<P extends { dir: string }>(
  projects: ReadonlyArray<P>,
  dir: string,
  targetDir: string,
  place: 'before' | 'after'
): P[] | null {
  if (dir === targetDir) return null;
  const from = projects.findIndex(project => project.dir === dir);
  const targetAt = projects.findIndex(project => project.dir === targetDir);
  if (from === -1 || targetAt === -1) return null;
  const next = [...projects];
  const [moved] = next.splice(from, 1);
  const anchor = next.findIndex(project => project.dir === targetDir);
  next.splice(place === 'before' ? anchor : anchor + 1, 0, moved);
  if (next.every((project, i) => project === projects[i])) return null;
  return next;
}

/** Chrome close policy (D24): closing a tab activates its RIGHT neighbor;
 *  closing the rightmost activates the new rightmost. Pure. */
export function nextActiveTabAfterClose(
  tabs: ReadonlyArray<{ id: string }>,
  closedId: string
): string | null {
  const index = tabs.findIndex(tab => tab.id === closedId);
  const remaining = tabs.filter(tab => tab.id !== closedId);
  if (remaining.length === 0) return null;
  if (index === -1) return remaining[remaining.length - 1].id;
  return remaining[Math.min(index, remaining.length - 1)].id;
}
