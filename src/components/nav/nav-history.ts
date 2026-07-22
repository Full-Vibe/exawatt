/**
 * App-location back stack (ENG-016 D27). ⌘[/⌘] used to walk bare router
 * history, which never saw most navigation: Sessions open/close is a
 * router.replace, and tab selection is pure state. This module records
 * every LOCATION the operator lands on — command surface (Terminal,
 * Sessions, Spatial, Settings) plus the active workspace tab — and back/
 * forward walk those locations across zoom levels, tabs, and routes.
 *
 * Applying a location never re-records: recorders call visit(), and
 * visit() is a no-op when the location equals the current entry, so the
 * state changes caused by applying back()/forward() dedupe away instead
 * of truncating the forward stack.
 *
 * Roadmap focus deliberately stays OUT of the stack — esc owns backing
 * out of the roadmap hierarchy (D9 doctrine).
 *
 * Pure; module-singleton per renderer. Not persisted.
 */

export interface NavLocation {
  /** command-surface address: '/workspace', '/workspace?view=sessions',
   *  '/fleet/spatial…', '/settings', … */
  surface: string;
  /** active workspace tab, when the location is tab-specific */
  tab?: { dir: string; tabId: string } | null;
}

export function sameLocation(a: NavLocation, b: NavLocation): boolean {
  return (
    a.surface === b.surface &&
    (a.tab?.dir ?? null) === (b.tab?.dir ?? null) &&
    (a.tab?.tabId ?? null) === (b.tab?.tabId ?? null)
  );
}

const CAP = 100;

export class NavHistory {
  private stack: NavLocation[] = [];
  private index = -1;

  current(): NavLocation | null {
    return this.stack[this.index] ?? null;
  }

  canBack(): boolean {
    return this.index > 0;
  }

  canForward(): boolean {
    return this.index < this.stack.length - 1;
  }

  /** record a location the operator landed on; equal-to-current is a no-op
   *  (that's how applying back/forward avoids re-recording) */
  visit(location: NavLocation): void {
    const current = this.current();
    if (current && sameLocation(current, location)) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(location);
    if (this.stack.length > CAP) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  back(): NavLocation | null {
    if (!this.canBack()) return null;
    this.index -= 1;
    return this.current();
  }

  forward(): NavLocation | null {
    if (!this.canForward()) return null;
    this.index += 1;
    return this.current();
  }

  reset(): void {
    this.stack = [];
    this.index = -1;
  }
}

export const navHistory = new NavHistory();
