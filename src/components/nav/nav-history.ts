/**
 * App-location back stack (ENG-016 D27, repaired D50). ⌘[/⌘] used to walk
 * bare router history, which never saw most navigation: Sessions open/close
 * is a router.replace, and tab selection is pure state. This module records
 * every LOCATION the operator lands on — command surface (Terminal,
 * Sessions, Spatial, Settings) plus the active workspace tab — and back/
 * forward walk those locations across zoom levels, tabs, and routes.
 *
 * Two invariants, both learned from BUG-006, are owned HERE rather than by
 * the callers that kept getting them wrong:
 *
 * 1. **Every stop is reachable.** A recorded entry whose target no longer
 *    exists (⌘W destroyed the tab) is not a stop, it is garbage. `back()`
 *    and `forward()` walk THROUGH dead entries and drop them, and `canBack`
 *    / `canForward` answer for live entries only — so Back can never
 *    "reach nothing" and the chrome's disabled state stays truthful.
 *    Reopening a closed Session is `⌘⇧T`'s job (D39), never Back's.
 *
 * 2. **Applying a location never records one.** Applying back/forward lands
 *    in stages — the tab select is synchronous, the surface change is a
 *    router round trip — so recorders observe HYBRID states in between
 *    (old surface, new tab) that match no entry at all. Recording one
 *    truncated the forward stack and pushed a phantom, which is what turned
 *    the stack into a two-element oscillator. `beginApply()` suspends
 *    recording until the applied location is actually observed (or the
 *    apply is abandoned), so intermediate states are ignored by
 *    construction instead of by a TTL race the caller has to win.
 *
 *    Applies OVERLAP, which is why the second invariant tracks a set rather
 *    than the one pending apply D50 shipped (BUG-035, same family). A round
 *    trip takes long enough that the next ⌘[ / ⌘] routinely starts before
 *    the previous one has landed, and a single slot meant the newer apply
 *    erased the older one's record. The older apply then completed unclaimed,
 *    was read as an independent navigation, walked the index forward, and let
 *    the newer apply's own completion truncate the forward stack — ⌘] from
 *    the workspace reaching nothing while the Forward control, pressed a beat
 *    later, still worked. Every apply is expected until it lands or expires.
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

/** True when `observed` is a partially-applied stage of `target` rather than
 *  an independent navigation: it agrees on the surface or on the tab. */
function partOfApply(target: NavLocation, observed: NavLocation): boolean {
  if (target.surface === observed.surface) return true;
  const targetTab = target.tab;
  const observedTab = observed.tab;
  if (!targetTab || !observedTab) return false;
  return (
    targetTab.dir === observedTab.dir && targetTab.tabId === observedTab.tabId
  );
}

/** Answers whether a recorded location can still be navigated to. */
export type LocationResolver = (location: NavLocation) => boolean;

const CAP = 100;

/** An apply that never completes must not silence recording forever. Long
 *  enough for a router round trip plus a slow layout commit; short enough
 *  that a genuinely abandoned apply costs at most one missed stop. */
const APPLY_TIMEOUT_MS = 4_000;

export class NavHistory {
  private stack: NavLocation[] = [];
  private index = -1;
  private revision = 0;
  private listeners = new Set<() => void>();
  private resolve: LocationResolver = () => true;
  /** Applies still expected to land, oldest first. The TTL bounds the list:
   *  each entry is one back/forward keystroke and expires on its own clock. */
  private applying: { location: NavLocation; at: number }[] = [];
  private now: () => number = () => Date.now();

  /** Reactive capability state for chrome controls. The history owner stays
   * framework-neutral; React consumes this tiny external-store contract. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getRevision = (): number => this.revision;

  private notify(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Register how to tell whether a location still exists. The workspace owns
   * that truth (which tabs are open); this module owns what to do about it.
   * Deliberately NOT cleared on unmount: a workspace that is off screen has
   * not destroyed its tabs, and reverting to "everything is live" would
   * resurrect exactly the dead stops this exists to remove. The next mount
   * re-registers with fresh truth.
   */
  setLocationResolver(resolve: LocationResolver): void {
    if (this.resolve === resolve) return;
    this.resolve = resolve;
    // Capability can change with it (a closed tab may have been the only
    // stop behind us), so publish — but only when the resolver actually
    // changed. The workspace re-registers on every tab-activity tick.
    this.notify();
  }

  /** Test seam for the apply-timeout clock. */
  setClock(now: () => number): void {
    this.now = now;
  }

  current(): NavLocation | null {
    return this.stack[this.index] ?? null;
  }

  /**
   * Index of the nearest real STOP in `step` direction, or -1.
   *
   * A stop must be two things, and both were learned from BUG-006: it must
   * still exist, and it must be somewhere ELSE. Closing a tab makes the
   * workspace select a neighbour it has already been to, so the stack can
   * hold the current location twice with the destroyed one between them —
   * a Back that "works" and changes nothing on screen is the same failure
   * as a Back that reaches nothing.
   */
  private seek(step: 1 | -1): number {
    const here = this.current();
    for (let i = this.index + step; i >= 0 && i < this.stack.length; i += step) {
      const entry = this.stack[i];
      if (!entry) continue;
      if (!this.resolve(entry)) continue;
      if (here && sameLocation(here, entry)) continue;
      return i;
    }
    return -1;
  }

  canBack(): boolean {
    return this.seek(-1) !== -1;
  }

  canForward(): boolean {
    return this.seek(1) !== -1;
  }

  /** An apply that never completes must not silence recording forever. */
  private dropExpiredApplies(): void {
    const now = this.now();
    this.applying = this.applying.filter(
      apply => now - apply.at <= APPLY_TIMEOUT_MS
    );
  }

  /**
   * Record a location the operator landed on.
   *
   * Equal-to-current is a no-op. While applies are in flight, only their own
   * targets and stages are accepted — and accepting a target ENDS that apply,
   * so the very next independent navigation records normally. Everything else
   * observed mid-apply is a transient stage of one of those navigations.
   */
  visit(location: NavLocation): void {
    this.dropExpiredApplies();
    if (this.applying.length > 0) {
      const landed = this.applying.findIndex(apply =>
        sameLocation(apply.location, location)
      );
      if (landed !== -1) {
        // This apply arrived. Everything OLDER was superseded before it could
        // land; its completion is now indistinguishable from a real
        // navigation, so it stops being expected along with this one.
        this.applying = this.applying.slice(landed + 1);
        return;
      }
      // A STAGE of an apply shares something with its target — the tab has
      // landed but the router has not, or the reverse. A location sharing
      // neither with ANY apply in flight is the operator having moved on
      // mid-apply, and swallowing that would drop a real stop from the chain
      // (D50 review).
      if (this.applying.some(apply => partOfApply(apply.location, location))) {
        return;
      }
    }
    this.applying = [];
    const current = this.current();
    if (current && sameLocation(current, location)) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push(location);
    if (this.stack.length > CAP) this.stack.shift();
    this.index = this.stack.length - 1;
    this.notify();
  }

  /** Suspend recording until `location` is observed (see class comment).
   *  Additive: an apply already in flight stays expected, because its own
   *  completion is still coming and is not a navigation (BUG-035). */
  beginApply(location: NavLocation): void {
    this.dropExpiredApplies();
    this.applying.push({ location, at: this.now() });
  }

  /** True while an apply is in flight — recorders may skip work entirely. */
  isApplying(): boolean {
    const now = this.now();
    return this.applying.some(apply => now - apply.at <= APPLY_TIMEOUT_MS);
  }

  /** Walk to the nearest live entry, dropping the dead ones passed over. */
  private walk(step: 1 | -1): NavLocation | null {
    const target = this.seek(step);
    if (target === -1) return null;
    // Everything strictly between here and the target failed resolution:
    // remove it so the stack only ever holds reachable stops.
    if (step === -1) {
      // dead run is (target, index) exclusive; the target keeps its index
      this.stack.splice(target + 1, this.index - target - 1);
      this.index = target;
    } else {
      // dead run is (index, target) exclusive; the target slides down to
      // sit immediately after where we stand
      this.stack.splice(this.index + 1, target - this.index - 1);
      this.index += 1;
    }
    this.notify();
    return this.current();
  }

  back(): NavLocation | null {
    return this.walk(-1);
  }

  forward(): NavLocation | null {
    return this.walk(1);
  }

  reset(): void {
    this.applying = [];
    if (this.stack.length === 0 && this.index === -1) return;
    this.stack = [];
    this.index = -1;
    this.notify();
  }

  /** Test/diagnostic view of the recorded stops and where we stand. */
  snapshot(): { entries: readonly NavLocation[]; index: number } {
    return { entries: [...this.stack], index: this.index };
  }
}

export const navHistory = new NavHistory();
