/**
 * Plan-window history (ENG-008 E1/E5).
 *
 * `PlanWindow` is capacity truth at one instant; PACE needs history — %/h is
 * only observable from two observations spaced in time. The corpus already
 * carries that history (Codex writes `rate_limits` on every `token_count`
 * event), so the scanner accumulates a BOUNDED, downsampled series per window
 * bucket and derives an observed rate from it. Pure module: no IO, no clock —
 * the horizon is anchored at the newest observation seen, not at wall time.
 */
import type { PlanWindowObservation } from './live-snapshot';
import type { PlanWindow } from './types';

/**
 * Canonical identity of one plan-window bucket.
 *
 * NOT just `limitId`: the corpus shows one `limit_id` carrying BOTH a primary
 * (5h) and a secondary (weekly) window, so limitId alone collides. Everything
 * that keys windows — latest-state collapse, history, `windowRates` in the
 * live snapshot — uses this composition, and the renderer should call this
 * function rather than composing keys by hand.
 */
export function planWindowKey(
  window: Pick<PlanWindow, 'source' | 'limitId' | 'scope' | 'windowMinutes'>
): string {
  return `${window.source}|${window.limitId ?? ''}|${window.scope}|${window.windowMinutes}`;
}

export function observationKey(observation: PlanWindowObservation): string {
  return planWindowKey({
    source: observation.source,
    limitId: observation.limitId,
    scope: observation.scope,
    windowMinutes: observation.windowMinutes,
  });
}

export interface WindowObservationOptions {
  /** One observation kept per bucket per slot. Default 15 minutes. */
  slotMs?: number;
  /** Observations older than this before the newest one are pruned. Default 14 days. */
  horizonMs?: number;
}

const DEFAULT_SLOT_MS = 15 * 60_000;
const DEFAULT_HORIZON_MS = 14 * 24 * 3_600_000;

/**
 * Bounded accumulator: at most one observation per bucket per time slot,
 * within a horizon behind the newest observation. Size is therefore capped by
 * `buckets x (horizon / slot)` regardless of how many raw `rate_limits`
 * records the corpus holds (~79k on the real machine).
 */
export class WindowObservationAccumulator {
  private readonly slotMs: number;
  private readonly horizonMs: number;
  /** bucket key -> slot index -> latest observation in that slot. */
  private readonly buckets = new Map<string, Map<number, PlanWindowObservation>>();
  private newestMs = Number.NEGATIVE_INFINITY;

  constructor(options: WindowObservationOptions = {}, initial: PlanWindowObservation[] = []) {
    this.slotMs = options.slotMs ?? DEFAULT_SLOT_MS;
    this.horizonMs = options.horizonMs ?? DEFAULT_HORIZON_MS;
    for (const observation of initial) this.addObservation(observation);
  }

  /**
   * Returns the observation when it was RETAINED (new slot, or newer than the
   * slot's holder), null when it was ignored — a persisting caller appends
   * only retained observations, which keeps the log bounded too.
   */
  addWindow(window: PlanWindow): PlanWindowObservation | null {
    // Degenerate windows carry no usable denominator; they are counted and
    // discarded upstream and must not enter the history either.
    if (window.windowMinutes <= 0) return null;
    if (!Number.isFinite(window.usedPercent)) return null;
    const observedAtMs = Date.parse(window.observedAt);
    if (Number.isNaN(observedAtMs)) return null;
    return this.addObservation({
      source: window.source,
      limitId: window.limitId,
      scope: window.scope,
      windowMinutes: window.windowMinutes,
      usedPercent: window.usedPercent,
      observedAtMs,
    });
  }

  addObservation(
    observation: PlanWindowObservation
  ): PlanWindowObservation | null {
    if (observation.windowMinutes <= 0) return null;
    if (!Number.isFinite(observation.usedPercent)) return null;
    if (!Number.isFinite(observation.observedAtMs)) return null;
    if (
      Number.isFinite(this.newestMs) &&
      observation.observedAtMs < this.newestMs - this.horizonMs
    ) {
      return null;
    }
    this.newestMs = Math.max(this.newestMs, observation.observedAtMs);
    const key = observationKey(observation);
    let slots = this.buckets.get(key);
    if (!slots) {
      slots = new Map();
      this.buckets.set(key, slots);
    }
    const slot = Math.floor(observation.observedAtMs / this.slotMs);
    const existing = slots.get(slot);
    if (!existing || observation.observedAtMs >= existing.observedAtMs) {
      slots.set(slot, observation);
      return observation;
    }
    return null;
  }

  /** All retained observations, ascending by instant, horizon-pruned. */
  list(): PlanWindowObservation[] {
    const cutoff = this.newestMs - this.horizonMs;
    const out: PlanWindowObservation[] = [];
    for (const slots of this.buckets.values()) {
      for (const [slot, observation] of slots) {
        if (observation.observedAtMs < cutoff) {
          slots.delete(slot);
          continue;
        }
        out.push(observation);
      }
    }
    out.sort((left, right) => left.observedAtMs - right.observedAtMs);
    return out;
  }
}

/** Below this observation span a rate would be mostly noise. */
export const MIN_RATE_SPAN_MS = 10 * 60_000;

/**
 * Observed consumption rate per window bucket, in percent per hour.
 *
 * Per bucket: take the newest observation, then walk backwards while (a) the
 * observation still lies within one window-length of the newest — beyond that
 * the pace belongs to another era of the window — and (b) `usedPercent` is
 * non-increasing going backwards. A DROP in the forward direction is a reset;
 * pace must never be computed across one, or a week of quiet after a reset
 * reads as furious burn. Buckets with fewer than two usable observations, or
 * a span under `MIN_RATE_SPAN_MS`, are ABSENT from the result — a rate that
 * cannot be observed is never reported as zero. A genuinely flat window does
 * report `0`, which is a real observed pace.
 */
export function derivePlanWindowRates(
  observations: readonly PlanWindowObservation[]
): Record<string, number> {
  const byBucket = new Map<string, PlanWindowObservation[]>();
  for (const observation of observations) {
    const key = observationKey(observation);
    const list = byBucket.get(key);
    if (list) list.push(observation);
    else byBucket.set(key, [observation]);
  }
  const rates: Record<string, number> = {};
  for (const [key, list] of byBucket) {
    list.sort((left, right) => left.observedAtMs - right.observedAtMs);
    const latest = list[list.length - 1];
    const windowMs = latest.windowMinutes * 60_000;
    let earliest = latest;
    for (let i = list.length - 2; i >= 0; i -= 1) {
      const candidate = list[i];
      if (candidate.observedAtMs < latest.observedAtMs - windowMs) break;
      if (candidate.usedPercent > earliest.usedPercent) break; // reset boundary
      earliest = candidate;
    }
    const spanMs = latest.observedAtMs - earliest.observedAtMs;
    if (spanMs < MIN_RATE_SPAN_MS) continue;
    const deltaPercent = latest.usedPercent - earliest.usedPercent;
    if (deltaPercent < 0) continue;
    rates[key] = deltaPercent / (spanMs / 3_600_000);
  }
  return rates;
}
