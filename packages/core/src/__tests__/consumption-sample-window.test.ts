/**
 * BUG-032 — the sample retention bound.
 *
 * Plan-window observations always had a horizon; samples did not, and
 * compaction rewrites the log from live state, so the compaction floor rose
 * forever. These are the rules that bound it.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSUMPTION_SAMPLE_HORIZON_MS,
  CONSUMPTION_SAMPLE_MAX_HORIZON_MS,
  ConsumptionSampleWindow,
  localLogAssurance,
  resolveSampleHorizonMs,
  type ConsumptionSample,
} from '../index';

const DAY = 24 * 3_600_000;
const NEWEST = Date.parse('2026-08-16T00:00:00.000Z');

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
});

describe('resolveSampleHorizonMs', () => {
  it('is the default when nothing publishes', () => {
    expect(resolveSampleHorizonMs(null, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
    expect(resolveSampleHorizonMs('not a date', NEWEST)).toBe(
      CONSUMPTION_SAMPLE_HORIZON_MS
    );
  });

  it('covers an active publication anchor, which replaces the hosted aggregate', () => {
    const startedAt = new Date(NEWEST - 60 * DAY).toISOString();
    expect(resolveSampleHorizonMs(startedAt, NEWEST)).toBe(
      60 * DAY + CONSUMPTION_SAMPLE_HORIZON_MS
    );
  });

  it('never exceeds the ceiling, because nothing can consume past it', () => {
    const startedAt = new Date(NEWEST - 5000 * DAY).toISOString();
    expect(resolveSampleHorizonMs(startedAt, NEWEST)).toBe(
      CONSUMPTION_SAMPLE_MAX_HORIZON_MS
    );
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
