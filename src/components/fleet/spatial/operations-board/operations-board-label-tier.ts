/**
 * Zone label tier: how much a Project's label says at the current zoom.
 *
 * **Why this is a store and not canvas state.** The tier used to be `useState`
 * at the canvas root, and it flips when the projected zone width crosses a
 * threshold -- which, on a Fleet -> Project flight, happens mid-flight. A
 * root-level state change re-rendered every layer under the canvas (measured:
 * one 61ms task, a 76ms frame gap, and a visible catch-up jump in the camera)
 * to change two lines of DOM. Here the rig writes zoom per frame, hysteresis
 * decides the tier, and only the zone controls subscribe.
 *
 * Hysteresis (enter `full` above 290px, drop to `compact` below 250px) is what
 * stops a label flickering when the camera rests near the boundary; the gap
 * is ~15% of the threshold, in the range LOD systems use for the same reason.
 */
export type ZoneLabelTier = 'full' | 'compact' | 'nano';

export const ZONE_LABEL_TIER_POLICY = {
  /** Projected zone width (px) above which labels go full. */
  fullAbovePx: 290,
  /** Projected zone width (px) below which labels go compact. */
  compactBelowPx: 250,
  /** Projected zone width (px) above which nano labels return to compact. */
  compactAbovePx: 150,
  /** Projected zone width (px) below which labels go nano: hotkey, count, and
   *  attention only. This is the 390px-viewport case, where zones project
   *  narrower than a compact card and world-anchored chips buried each other
   *  and the board they label. */
  nanoBelowPx: 122,
} as const;

/** Pure: the next tier given the current one and the projected width. */
export function nextZoneLabelTier(
  current: ZoneLabelTier,
  projectedPx: number
): ZoneLabelTier {
  if (projectedPx < ZONE_LABEL_TIER_POLICY.nanoBelowPx) return 'nano';
  if (current === 'nano' && projectedPx <= ZONE_LABEL_TIER_POLICY.compactAbovePx)
    return 'nano';
  if (current === 'full') {
    return projectedPx < ZONE_LABEL_TIER_POLICY.compactBelowPx
      ? 'compact'
      : 'full';
  }
  return projectedPx > ZONE_LABEL_TIER_POLICY.fullAbovePx ? 'full' : 'compact';
}

export interface ZoneLabelTierStore {
  /** Current tier; stable reference semantics for `useSyncExternalStore`. */
  get(): ZoneLabelTier;
  subscribe(listener: () => void): () => void;
  /** Called per frame by the camera rig; notifies only when the tier flips. */
  setZoom(zoom: number): void;
  /** Called when the smallest visible zone changes width. */
  setMinZoneWidth(width: number): void;
}

export function createZoneLabelTierStore(
  initial: ZoneLabelTier = 'full'
): ZoneLabelTierStore {
  let tier = initial;
  let zoom = 1;
  let minZoneWidth = 24;
  const listeners = new Set<() => void>();
  const evaluate = () => {
    const next = nextZoneLabelTier(tier, minZoneWidth * zoom);
    if (next === tier) return;
    tier = next;
    for (const listener of listeners) listener();
  };
  return {
    get: () => tier,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setZoom(nextZoom) {
      zoom = nextZoom;
      evaluate();
    },
    setMinZoneWidth(width) {
      minZoneWidth = width;
      evaluate();
    },
  };
}
