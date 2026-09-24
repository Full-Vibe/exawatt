/**
 * BUG-032 — the sample retention bound.
 *
 * Plan-window observations always had a horizon; samples did not, and
 * compaction rewrites the log from live state, so the compaction floor rose
 * forever. These are the rules that bound it.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSUMPTION_SAMPLE_FUTURE_TOLERANCE_MS,
  CONSUMPTION_SAMPLE_HORIZON_MS,
  CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
  ConsumptionSampleWindow,
  localLogAssurance,
  resolveSampleHorizonMs,
  type ConsumptionSample,
} from '../index';

const DAY = 24 * 3_600_000;
const NEWEST = Date.parse('2026-08-16T00:00:00.000Z');
/** A wall clock a little past the newest fixture, as on the real machine. */
const WALL = NEWEST + 6 * 3_600_000;

const sample = (key: string, daysBack: number): ConsumptionSample => ({
  at: new Date(NEWEST - daysBack * DAY).toISOString(),
  source: 'claude-code',
  model: 'claude-sonnet-5',
  effort: null,
  providerSessionId: 'sess-1',
  cwd: '/w/acme',
  gitBranch: null,
  usage: {
    inputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 5,
    reasoningTokens: 0,
    webSearches: 0,
    webFetches: 0,
  },
  assurance: localLogAssurance('claude-code'),
  idempotencyKey: key,
  contextWindow: null,
  sourceFile: '/root/claude/x.jsonl',
  delegation: null,
  entrypoint: 'cli',
});

describe('ConsumptionSampleWindow', () => {
  it('is bounded by the horizon, not by lifetime activity', () => {
    const window = new ConsumptionSampleWindow();
    // Nine months of one sample per day, the operator's actual span.
    for (let day = 270; day >= 0; day -= 1) {
      window.add(sample(`day-${day}`, day));
    }
    expect(window.size).toBe(15); // days 0..14 inclusive
    expect(window.evictedCount).toBe(256);
  });

  // BUG-164: a consumer that REPLACES hosted history with this view needs to
  // know where the view stops being complete.
  it('remembers the newest instant it ever dropped, even after widening', () => {
    const window = new ConsumptionSampleWindow({ now: () => WALL });
    expect(window.prunedThroughMs).toBe(Number.NEGATIVE_INFINITY);
    for (let day = 30; day >= 0; day -= 1) {
      window.add(sample(`day-${day}`, day));
    }
    expect(window.prunedThroughMs).toBe(NEWEST - 15 * DAY);

    window.setHorizonMs(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
    window.add(sample('late-arrival', 20));
    expect(window.prunedThroughMs).toBe(NEWEST - 15 * DAY);
  });

  it('anchors on the newest sample, never on wall time', () => {
    const window = new ConsumptionSampleWindow();
    // An entire corpus that is a year old still retains its own last 14 days.
    for (let day = 380; day >= 366; day -= 1) {
      window.add(sample(`old-${day}`, day));
    }
    expect(window.size).toBe(15);
  });

  it('drops nothing while everything is inside the horizon', () => {
    const window = new ConsumptionSampleWindow();
    for (let index = 0; index < 500; index += 1) {
      window.add(sample(`k-${index}`, index % 14));
    }
    expect(window.size).toBe(500);
    expect(window.evictedCount).toBe(0);
  });

  it('refuses a sample behind the horizon and reports the refusal', () => {
    const window = new ConsumptionSampleWindow();
    window.add(sample('anchor', 0));
    expect(window.add(sample('ancient', 90))).toBeNull();
    expect(window.get('ancient')).toBeUndefined();
  });

  it('merges by idempotency key rather than double counting', () => {
    const window = new ConsumptionSampleWindow();
    window.add(sample('k', 0));
    const merged = window.add({
      ...sample('k', 0),
      usage: { ...sample('k', 0).usage, outputTokens: 90 },
    });
    expect(window.size).toBe(1);
    expect(merged?.usage.outputTokens).toBe(90);
  });

  it('answers `since` from the instant it already parsed, in order', () => {
    const window = new ConsumptionSampleWindow();
    window.add(sample('a', 10));
    window.add(sample('b', 2));
    window.add(sample('c', 0));
    const recent = window.since(NEWEST - 3 * DAY);
    expect(recent.map(s => s.idempotencyKey)).toEqual(['b', 'c']);
    expect(window.since().map(s => s.idempotencyKey)).toEqual(['a', 'b', 'c']);
  });

  it('is Map-compatible so a caller can settle a copy', () => {
    const window = new ConsumptionSampleWindow();
    window.add(sample('a', 0));
    expect([...new Map(window).keys()]).toEqual(['a']);
  });

  // BUG-141's sibling: a harness whose clock was two years fast stamps one
  // sample in the future. Anchored on the data alone, that sample becomes the
  // newest seen and the whole real corpus falls behind the horizon until wall
  // time catches up. The anchor trusts the data only up to wall time plus a
  // tolerance, and clamping it DOWN can only retain more.
  it('does not let one future-dated sample evict the real corpus', () => {
    const window = new ConsumptionSampleWindow({ now: () => WALL });
    // Twelve days of real activity: all inside the horizon even when the
    // anchor sits the full tolerance past wall time.
    for (let day = 12; day >= 0; day -= 1) {
      window.add(sample(`real-${day}`, day));
    }
    expect(window.add(sample('from-the-future', -730))).not.toBeNull();
    expect(window.anchorMs).toBe(WALL + CONSUMPTION_SAMPLE_FUTURE_TOLERANCE_MS);
    expect(window.size).toBe(14);
    expect(window.evictedCount).toBe(0);
    // Still admits real activity arriving after the misdated sample.
    expect(window.add(sample('real-next', -0.25))).not.toBeNull();
    expect(window.size).toBe(15);
  });

  it('keeps a small clock skew as an ordinary anchor', () => {
    const window = new ConsumptionSampleWindow({ now: () => WALL });
    window.add(sample('slightly-ahead', -0.5)); // twelve hours past wall time
    expect(window.anchorMs).toBe(NEWEST + 0.5 * DAY);
  });

  it('a restored backup still anchors on its own data, not the clock', () => {
    // Wall time is a year past the corpus; nothing about that empties it.
    const window = new ConsumptionSampleWindow({
      now: () => NEWEST + 365 * DAY,
    });
    for (let day = 14; day >= 0; day -= 1) window.add(sample(`k-${day}`, day));
    expect(window.size).toBe(15);
    expect(window.evictedCount).toBe(0);
  });

  it('re-resolves its horizon in place, sweeping only when it narrows', () => {
    const window = new ConsumptionSampleWindow({
      horizonMs: CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
    });
    for (const day of [0, 10, 40, 90]) window.add(sample(`d-${day}`, day));
    expect(window.size).toBe(4);
    // Widening past the ceiling is a no-op.
    expect(window.setHorizonMs(5000 * DAY)).toBe(0);
    // Narrowing to 60 days drops the 90-day sample and reports it.
    expect(window.setHorizonMs(60 * DAY)).toBe(1);
    expect(window.retentionMs).toBe(60 * DAY);
    expect([...window.keys()].sort()).toEqual(['d-0', 'd-10', 'd-40']);
    // Widening again recovers nothing: what was refused is gone.
    expect(window.setHorizonMs(CONSUMPTION_SAMPLE_MAX_HORIZON_MS)).toBe(0);
    expect(window.size).toBe(3);
  });
});

describe('resolveSampleHorizonMs', () => {
  it('is the default when nothing publishes', () => {
    expect(resolveSampleHorizonMs(null, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
    expect(resolveSampleHorizonMs(undefined, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
    expect(resolveSampleHorizonMs({ autoPublish: false }, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
    // A switched-off profile's stale anchor widens nothing.
    expect(
      resolveSampleHorizonMs(
        {
          autoPublish: false,
          startedAt: new Date(NEWEST - 60 * DAY).toISOString(),
        },
        NEWEST
      )
    ).toBe(CONSUMPTION_SAMPLE_HORIZON_MS);
  });

  it('covers an active publication anchor, which replaces the hosted aggregate', () => {
    const startedAt = new Date(NEWEST - 60 * DAY).toISOString();
    expect(
      resolveSampleHorizonMs({ autoPublish: true, startedAt }, NEWEST)
    ).toBe(60 * DAY + CONSUMPTION_SAMPLE_HORIZON_MS);
  });

  // BUG-141: a v0.1.10 profile publishes with no `startedAt` (the field is
  // newer than the release); the renderer's first sync recovers the hosted
  // `joined_at` minutes after boot and then publishes everything since it.
  // Until that anchor exists, the only horizon that cannot prune under it is
  // the ceiling.
  it('is the ceiling while a publication is active and its anchor is unknown', () => {
    expect(resolveSampleHorizonMs({ autoPublish: true }, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_MAX_HORIZON_MS
    );
    expect(
      resolveSampleHorizonMs({ autoPublish: true, startedAt: null }, NEWEST)
    ).toBe(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
    expect(
      resolveSampleHorizonMs(
        { autoPublish: true, startedAt: 'not a date' },
        NEWEST
      )
    ).toBe(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
  });

  it('never exceeds the ceiling, because nothing can consume past it', () => {
    const startedAt = new Date(NEWEST - 5000 * DAY).toISOString();
    expect(
      resolveSampleHorizonMs({ autoPublish: true, startedAt }, NEWEST)
    ).toBe(CONSUMPTION_SAMPLE_MAX_HORIZON_MS);
  });

  it('never falls below the floor, whatever a caller asks for', () => {
    expect(new ConsumptionSampleWindow({ horizonMs: 1 }).retentionMs).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
    expect(new ConsumptionSampleWindow({ horizonMs: -5 }).retentionMs).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
  });
});
