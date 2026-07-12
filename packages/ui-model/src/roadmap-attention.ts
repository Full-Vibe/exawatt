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

/**
 * The ⌘J walk order over roadmap-blocked sessions: oldest-blocked first,
 * and NEVER the already-active tab. Roadmap-blocked attention (unlike PTY
 * bells) doesn't clear on focus, so without excluding the active session a
 * repeat ⌘J would re-select the same tab forever and a second blocked
 * session — or the starving branch — would be unreachable (review P1).
 */
export function orderedRoadmapJumpTargets(
  roadmapAttention: Record<string, { since: number }>,
  activeSessionId: string | null
): string[] {
  return Object.entries(roadmapAttention)
    .filter(([sessionId]) => sessionId !== activeSessionId)
    .sort((a, b) => a[1].since - b[1].since)
    .map(([sessionId]) => sessionId);
}
