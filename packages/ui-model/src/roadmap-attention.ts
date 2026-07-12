import type { RoadmapLensView } from './roadmap-lens';

/**
 * Roadmap-derived attention (ENG-017 S8): blocked items with live agents
 * attached, and project starvation, expressed as inputs to the EXISTING
 * needs-you pipeline — one attention truth, no second machine.
 *
 * Pure: the workspace merges these with PTY attention (bell/turn-end, which
 * always wins on collision) and routes ⌘J/badges through the merged set.
 */

export interface RoadmapBlockedSession {
  sessionId: string;
  tabId: string | null;
  itemId: string;
  /** "APP-018 is blocked" — badge/tooltip copy */
  reason: string;
}

/** Sessions attached to blocked now/next items, in queue order. */
export function deriveRoadmapBlockedSessions(
  view: RoadmapLensView
): RoadmapBlockedSession[] {
  if (view.status !== 'ok') return [];
  const out: RoadmapBlockedSession[] = [];
  for (const item of [...view.now, ...view.next]) {
    if (!item.blocked) continue;
    for (const chip of item.chips) {
      out.push({
        sessionId: chip.sessionId,
        tabId: chip.tabId,
        itemId: item.id,
        reason: `${item.declaredId ?? item.title} is blocked`,
      });
    }
  }
  return out;
}

/** The "no food" condition: nothing left to execute while agents run. */
export function isProjectStarving(
  view: RoadmapLensView,
  liveSessionCount: number
): boolean {
  return view.status === 'ok' && view.queueEmpty && liveSessionCount > 0;
}
