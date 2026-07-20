/**
 * The tab ring (ENG-002 / ENG-016 D18): all tabs across all Projects in
 * display order form ONE global ring. ⌘⇧[/⌘⇧] rotate through it and ⌘1–⌘9
 * jump straight to a position. Stopped tabs are deliberately ring members —
 * a stopped Session is a real tab with a real restore surface, not a hole
 * in the strip.
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
  tab: T;
}

function flatten<T extends { id: string }>(
  projects: ReadonlyArray<RingProject<T>>
): Array<RingTarget<T>> {
  return projects.flatMap(g => g.tabs.map(tab => ({ dir: g.dir, tab })));
}

/**
 * The tab `delta` steps around the ring from the active tab, wrapping across
 * Project boundaries. When the active tab cannot be resolved (stale id,
 * zero-tab Project), recovery still ADVANCES from the nearest anchor instead
 * of re-landing on it — a resolution failure must never turn the ring into a
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
    e => e.dir === activeDir && e.tab.id === active?.activeTabId
  );
  if (cur !== -1) {
    return flat[(cur + delta + flat.length) % flat.length];
  }

  // Stale/no active tab: recover on the current Project's first tab when it
  // has one (never yank the user to another Project on a mere resolution
  // hiccup); otherwise step into the ring from the top.
  const anchor = flat.findIndex(e => e.dir === activeDir);
  if (anchor !== -1) return flat[anchor];
  return flat[delta === 1 ? 0 : flat.length - 1];
}

/** The tab at ordinal `index` (0-based) in the global ring, for ⌘1–⌘9. */
export function tabAtOrdinal<T extends { id: string }>(
  projects: ReadonlyArray<RingProject<T>>,
  index: number
): RingTarget<T> | null {
  const flat = flatten(projects);
  return flat[index] ?? null;
}
