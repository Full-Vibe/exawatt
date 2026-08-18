import { BOARD_TRANSITION_MS, boardTransitionEase } from './operations-board-transition';

/**
 * Piece emergence: how a piece that appears or disappears while the board is
 * mounted scales in or out, instead of popping.
 *
 * Under one geometry (V3.7) nothing MOVES on a semantic change, but at scale
 * the focused Project reveals its Agents (dots -> hexes) and hides them again
 * on the way out. Those pieces used to mount at full size in one frame and
 * unmount in one frame. This tracks each id's arrival or departure and yields
 * a scale factor per frame on the same duration and ease as every other board
 * transition, so a reveal reads as the same motion language as a flight.
 *
 * It keeps its own start times rather than sampling the shared clock: a piece
 * can arrive from live data with no semantic move under way, and a piece that
 * arrives with a move lands a commit later than the camera started. Same
 * policy, honest timing.
 */
export const EMERGENCE_ARRIVAL_FROM = 0.35;

interface EmergenceRecord {
  kind: 'arriving' | 'retiring';
  startedAt: number;
}

export interface EmergenceTracker {
  /** Tell the tracker which ids are present now. New ids arrive, missing ids retire. */
  reconcile(ids: readonly string[], nowMs: number): void;
  /** Scale factor for an id at `nowMs`: 1 when settled, <1 while arriving or retiring. */
  scaleOf(id: string, nowMs: number): number;
  /** Ids that are still visibly retiring at `nowMs` (render these too). */
  retiring(nowMs: number): string[];
  /** Is anything still in motion? */
  active(nowMs: number): boolean;
  /** Drop finished records; call once per frame after sampling. */
  prune(nowMs: number): void;
}

export function createEmergenceTracker(
  initialIds: readonly string[] = [],
  durationMs: number = BOARD_TRANSITION_MS
): EmergenceTracker {
  const present = new Set(initialIds);
  const records = new Map<string, EmergenceRecord>();
  // A non-positive duration means "instant" -- reduced motion snaps.
  const progress = (record: EmergenceRecord, nowMs: number) =>
    durationMs <= 0
      ? 1
      : Math.min(1, Math.max(0, (nowMs - record.startedAt) / durationMs));
  return {
    reconcile(ids, nowMs) {
      const next = new Set(ids);
      for (const id of next) {
        if (present.has(id)) continue;
        present.add(id);
        const record = records.get(id);
        if (record?.kind === 'retiring') {
          // A retiring piece asked back turns around from where it is.
          const scale = 1 - boardTransitionEase(progress(record, nowMs));
          records.set(id, {
            kind: 'arriving',
            startedAt: nowMs - inverseArrival(scale) * durationMs,
          });
          continue;
        }
        records.set(id, { kind: 'arriving', startedAt: nowMs });
      }
      for (const id of [...present]) {
        if (next.has(id)) continue;
        const record = records.get(id);
        const scale = record ? this.scaleOf(id, nowMs) : 1;
        present.delete(id);
        records.set(id, {
          kind: 'retiring',
          startedAt: nowMs - inverseRetire(scale) * durationMs,
        });
      }
    },
    scaleOf(id, nowMs) {
      const record = records.get(id);
      if (!record) return 1;
      const eased = boardTransitionEase(progress(record, nowMs));
      return record.kind === 'arriving'
        ? EMERGENCE_ARRIVAL_FROM + (1 - EMERGENCE_ARRIVAL_FROM) * eased
        : 1 - eased;
    },
    retiring(nowMs) {
      const out: string[] = [];
      for (const [id, record] of records) {
        if (record.kind === 'retiring' && progress(record, nowMs) < 1) out.push(id);
      }
      return out;
    },
    active(nowMs) {
      for (const record of records.values()) {
        if (progress(record, nowMs) < 1) return true;
      }
      return false;
    },
    prune(nowMs) {
      for (const [id, record] of records) {
        if (progress(record, nowMs) >= 1) records.delete(id);
      }
    },
  };
}

/** Progress at which an arrival is at `scale`, so a turnaround has no jump. */
function inverseArrival(scale: number): number {
  const eased = Math.min(
    1,
    Math.max(0, (scale - EMERGENCE_ARRIVAL_FROM) / (1 - EMERGENCE_ARRIVAL_FROM))
  );
  return inverseEase(eased);
}

/** Progress at which a departure is at `scale`. */
function inverseRetire(scale: number): number {
  return inverseEase(Math.min(1, Math.max(0, 1 - scale)));
}

/** Numeric inverse of the transition ease (monotone on [0,1]). */
function inverseEase(eased: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (boardTransitionEase(mid) < eased) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
