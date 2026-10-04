import type { FleetRoadmapAttention } from '@exawatt/core';
import type { RoadmapLensView } from './roadmap-lens';

// Compatibility surface: main and renderer use one source-neutral join.
export { deriveFleetRoadmapBlocked } from '@exawatt/core';
export type {
  RoadmapBlockedSession,
  RoadmapAttentionSession,
  RoadmapAttentionRead,
  RoadmapAttentionProject,
  FleetRoadmapAttention,
} from '@exawatt/core';

/**
 * `since` is the ⌘J walk order, so it must be the moment the block became
 * true — not the moment this surface last happened to look at it.
 *
 * The pre-BUG-026 pin was pruned against the ACTIVE Project's view, so
 * leaving a Project dropped its pins and returning re-stamped them with a
 * fresh clock: the documented oldest-first walk silently ordered by "least
 * recently visited" instead. Pins now survive Project switches, drop when the
 * block clears, and are held (never re-stamped) while a Project's roadmap
 * read is still pending or has failed.
 */
export function pinRoadmapBlockedSince(
  previous: ReadonlyMap<string, number>,
  fleet: FleetRoadmapAttention,
  now: number
): Map<string, number> {
  const pinned = new Map<string, number>();
  for (const entry of fleet.blocked) {
    if (pinned.has(entry.sessionId)) continue;
    pinned.set(entry.sessionId, previous.get(entry.sessionId) ?? now);
  }
  // A block whose Project cannot currently be read is not cleared either.
  for (const sessionId of [...fleet.pending, ...fleet.unread]) {
    const held = previous.get(sessionId);
    if (held !== undefined && !pinned.has(sessionId)) {
      pinned.set(sessionId, held);
    }
  }
  return pinned;
}

/** The "no food" condition: nothing left to execute while agents run. */
export function isProjectStarving(
  view: RoadmapLensView,
  liveSessionCount: number
): boolean {
  return view.status === 'ok' && view.queueEmpty && liveSessionCount > 0;
}
