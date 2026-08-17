/**
 * Consumption sample retention (BUG-032).
 *
 * `WindowObservationAccumulator` gave plan-window observations a horizon;
 * samples never got one. The consequence was structural, not incidental:
 * `ConsumptionStateStore.compact()` rewrites the log FROM LIVE STATE, so the
 * compacted floor is whatever the live sample map holds. With no state bound,
 * that floor only ever rose, and the "log bloat is bounded" comment described
 * a ratio (1x-3x) around a number that grew forever. On the operator's machine
 * it reached 139.5 MB / 173,571 lines, fully `JSON.parse`d before `ready`
 * resolves at every launch.
 *
 * This is the missing state bound, expressed the same way the observation
 * horizon is: anchored at the NEWEST sample seen, never at wall time, so a
 * machine whose clock jumps, or a corpus restored from backup, cannot silently
 * empty the window.
 *
 * The horizon is a policy input rather than a constant because one consumer's
 * window is not fixed by this module. Rendered surfaces read a 7-day window
 * (`LIVE_WINDOW_DAYS`); the Operator-profile publication (ENG-035) rescans
 * everything since its opt-in anchor and REPLACES the hosted aggregate, so
 * silently pruning under it would truncate a published profile. Main widens
 * the horizon to cover an active publication anchor and clamps it at
 * `CONSUMPTION_SAMPLE_MAX_HORIZON_MS`, which is the hosted contract's own
 * 400-day `days` cap — past that the payload is rejected anyway, so retaining
 * the samples behind it buys nothing.
 */
import { mergeSamples } from './merge';
import type { ConsumptionSample } from './types';

/** Default retention: the same horizon plan-window observations already use. */
export const CONSUMPTION_SAMPLE_HORIZON_MS = 14 * 24 * 3_600_000;

/**
 * Hard ceiling on any widened horizon. `sync_operator_stats` refuses a payload
 * with more than 400 `days`, so nothing can consume a sample older than this.
 */
export const CONSUMPTION_SAMPLE_MAX_HORIZON_MS = 400 * 24 * 3_600_000;

export interface ConsumptionSampleWindowOptions {
  /** Retention behind the newest sample. Default `CONSUMPTION_SAMPLE_HORIZON_MS`. */
  horizonMs?: number;
}

/**
 * Bounded, idempotency-keyed sample state.
 *
 * Size is capped by `horizon x arrival rate` instead of by lifetime activity.
 * `add` returns the retained value (so a persisting caller appends only what
 * survived, which is what keeps the LOG bounded too) or null when the sample
 * fell outside the horizon.
 */
export class ConsumptionSampleWindow {
  private readonly horizonMs: number;
  private readonly samples = new Map<string, ConsumptionSample>();
  private readonly instants = new Map<string, number>();
  private newestMs = Number.NEGATIVE_INFINITY;
  private evicted = 0;
  /** Prune is amortized: only after this many admissions past the last sweep. */
  private admissionsSinceSweep = 0;

  constructor(
    options: ConsumptionSampleWindowOptions = {},
    initial: Iterable<ConsumptionSample> = []
  ) {
    this.horizonMs = clampHorizon(
      options.horizonMs ?? CONSUMPTION_SAMPLE_HORIZON_MS
    );
    for (const sample of initial) this.add(sample);
  }

  /** The retention horizon actually in force, after clamping. */
  get retentionMs(): number {
    return this.horizonMs;
  }

  /** Samples dropped for age since this window was created. */
  get evictedCount(): number {
    return this.evicted;
  }

  get size(): number {
    this.sweep();
    return this.samples.size;
  }

  get(idempotencyKey: string): ConsumptionSample | undefined {
    return this.samples.get(idempotencyKey);
  }

  /**
   * Merge one sample in. Returns the post-merge value that is now retained, or
   * null when the sample is older than the horizon and was dropped.
   */
  add(sample: ConsumptionSample): ConsumptionSample | null {
    const at = Date.parse(sample.at);
    const instant = Number.isNaN(at) ? this.newestMs : at;
    if (
      Number.isFinite(this.newestMs) &&
      instant < this.newestMs - this.horizonMs
    ) {
      this.evicted += 1;
      return null;
    }
    if (Number.isFinite(instant)) {
      this.newestMs = Math.max(this.newestMs, instant);
    }
    const existing = this.samples.get(sample.idempotencyKey);
    const merged = existing
      ? mergeSamples([existing, sample]).samples[0]
      : sample;
    this.samples.set(sample.idempotencyKey, merged);
    this.instants.set(sample.idempotencyKey, instant);
    this.admissionsSinceSweep += 1;
    if (this.admissionsSinceSweep >= 1_000) this.sweep();
    return merged;
  }

  /** Every retained sample, horizon-pruned. Insertion order, not sorted. */
  values(): IterableIterator<ConsumptionSample> {
    this.sweep();
    return this.samples.values();
  }

  keys(): IterableIterator<string> {
    this.sweep();
    return this.samples.keys();
  }

  entries(): IterableIterator<[string, ConsumptionSample]> {
    this.sweep();
    return this.samples.entries();
  }

  /** Map-compatible so a caller can `new Map(window)` for a settled copy. */
  [Symbol.iterator](): IterableIterator<[string, ConsumptionSample]> {
    return this.entries();
  }

  /**
   * Retained samples at or after `sinceMs`, ascending by instant.
   *
   * Reads the instant the window already parsed on admission. `snapshot()`
   * runs on every `workspace:changed` — that is, on every tab switch — and it
   * used to re-`Date.parse` the whole corpus each time.
   */
  since(sinceMs?: number): ConsumptionSample[] {
    this.sweep();
    const out: ConsumptionSample[] = [];
    for (const [key, sample] of this.samples) {
      const instant = this.instants.get(key) ?? Number.NEGATIVE_INFINITY;
      if (sinceMs !== undefined && instant < sinceMs) continue;
      out.push(sample);
    }
    out.sort((left, right) => (left.at < right.at ? -1 : 1));
    return out;
  }

  /** Drop everything that has aged out behind the newest sample. */
  sweep(): number {
    this.admissionsSinceSweep = 0;
    if (!Number.isFinite(this.newestMs)) return 0;
    const cutoff = this.newestMs - this.horizonMs;
    let dropped = 0;
    for (const [key, instant] of this.instants) {
      if (instant >= cutoff) continue;
      this.instants.delete(key);
      this.samples.delete(key);
      dropped += 1;
    }
    this.evicted += dropped;
    return dropped;
  }
}

function clampHorizon(horizonMs: number): number {
  if (!Number.isFinite(horizonMs) || horizonMs <= 0) {
    return CONSUMPTION_SAMPLE_HORIZON_MS;
  }
  return Math.min(
    CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
    Math.max(CONSUMPTION_SAMPLE_HORIZON_MS, horizonMs)
  );
}

/**
 * The retention a running app should use: never below the default floor, never
 * above the ceiling, and always wide enough to cover an active Operator-profile
 * publication anchor whose sync replaces the hosted aggregate wholesale.
 */
export function resolveSampleHorizonMs(
  publicationStartedAt: string | null | undefined,
  nowMs: number
): number {
  if (!publicationStartedAt) return CONSUMPTION_SAMPLE_HORIZON_MS;
  const started = Date.parse(publicationStartedAt);
  if (Number.isNaN(started)) return CONSUMPTION_SAMPLE_HORIZON_MS;
  return clampHorizon(nowMs - started + CONSUMPTION_SAMPLE_HORIZON_MS);
}
