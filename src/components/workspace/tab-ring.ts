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
  return tabs[index] ?? null;
}
