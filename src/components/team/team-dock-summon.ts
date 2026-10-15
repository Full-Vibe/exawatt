/**
 * Summoning Team's dock from anywhere (ENG-017 S12, ENG-029 B3).
 *
 * The dock lives in the Team overlay, but ⌘B, the palette row and the
 * context chip fire from Terminal before the overlay exists. The request is
 * parked here and read on mount. Reads are IDEMPOTENT within a short
 * freshness window instead of consume-once: StrictMode's dev double-mount
 * re-runs the readers' effects, so a destructive consume left the second pass
 * with nothing to re-apply.
 */

export type TeamDockTab = 'roadmap' | 'chatter';

interface TeamDockSummon {
  /** the tab to show; absent means the one the operator last used */
  tab: TeamDockTab | null;
  /** a roadmap item to open drilled into (implies the Roadmap tab) */
  drillId: string | null;
}

/** dispatched to move focus into the dock (after a summon is parked) */
export const TEAM_DOCK_FOCUS_EVENT = 'exawatt:focus-team-dock';

const SUMMON_FRESH_MS = 3000;
let pending: (TeamDockSummon & { at: number }) | null = null;

export function requestTeamDockSummon(
  request: { tab?: TeamDockTab; drillId?: string } = {}
): void {
  const drillId = request.drillId ?? null;
  pending = {
    tab: drillId ? 'roadmap' : (request.tab ?? null),
    drillId,
    at: Date.now(),
  };
}

export function takeTeamDockSummon(): TeamDockSummon | null {
  if (!pending) return null;
  if (Date.now() - pending.at > SUMMON_FRESH_MS) {
    pending = null;
    return null;
  }
  return { tab: pending.tab, drillId: pending.drillId };
}

/** non-consuming peek: the Team overlay reveals the drawer and holds its
 *  entrance focus when a summon is in flight */
export function hasTeamDockSummon(): boolean {
  return pending !== null && Date.now() - pending.at <= SUMMON_FRESH_MS;
}
