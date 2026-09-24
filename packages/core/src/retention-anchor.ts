/**
 * Where an age bound is measured from (decision `0039` §4 and its 2026-09-16
 * amendment).
 *
 * A persisted collection bounded by age anchors that age on its own NEWEST
 * record, never on wall time: a clock jump, a machine restored from backup, or
 * an old corpus must not silently empty it. But the data is trusted only so
 * far. One record stamped by a fast clock would otherwise become the anchor
 * and evict everything real behind it until wall time caught up (BUG-141's
 * sibling for consumption samples, BUG-182 for Agent Source observations).
 * So the anchor is the newest record, clamped to no further ahead of wall
 * time than a stated tolerance. Clamping it DOWN can only retain more, never
 * less, so the backup and clock-jump cases above still hold.
 *
 * Every age-bounded collection uses this one rule, so a new one cannot ship
 * with the unclamped form.
 */

/**
 * How far ahead of wall time a record may sit and still move the anchor. A
 * clock a few minutes fast is ordinary; a day is not.
 */
export const RETENTION_ANCHOR_FUTURE_TOLERANCE_MS = 24 * 3_600_000;

/**
 * The instant an age bound is measured from: `newestMs`, but no later than
 * `nowMs` plus the tolerance. A non-finite `newestMs` (an empty collection)
 * passes through unchanged.
 */
export function retentionAnchorMs(newestMs: number, nowMs: number): number {
  if (!Number.isFinite(newestMs)) return newestMs;
  return Math.min(newestMs, nowMs + RETENTION_ANCHOR_FUTURE_TOLERANCE_MS);
}
