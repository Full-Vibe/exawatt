import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  calendarDaysBetween,
  MAX_PUBLICATION_DAYS,
  MAX_PUBLICATION_RUNS,
  OPERATOR_STATS_DERIVATION_VERSION,
  parseOperatorStatsPublication,
  planOperatorStatsPublication,
  PUBLICATION_TRAILING_DAYS,
  type OperatorDayAggregate,
  type OperatorStatsPublicationPlan,
  type OperatorStatsPublicationPlanInput,
  type PublicRunUpload,
} from '../operator-stats';

/**
 * BUG-164 — the planner is where the hosted contract is satisfied by
 * construction. The load-bearing property: whatever history it is handed,
 * every publication it emits passes the service's own parser, and together
 * they cover one contiguous range exactly once.
 */

const hour = 3_600_000;
const SINCE = '2026-08-03T21:48:02.000Z';
const NOW = Date.parse('2026-09-23T20:00:00.000Z');

function day(localDate: string, overrides: Partial<OperatorDayAggregate> = {}) {
  return {
    localDate,
    agentMs: hour,
    runCount: 1,
    peakFleet: 1,
    longestHandsOffMs: hour / 2,
    rawTokens: 100,
    normalizedTokens: 140,
    sources: ['codex'],
    assurance: ['observed'],
    ...overrides,
  } satisfies OperatorDayAggregate;
}

let serial = 0;
function run(localDate: string, overrides: Partial<PublicRunUpload> = {}) {
  serial += 1;
  return {
    publicId: `run_${String(serial).padStart(16, '0')}`,
    localDate,
    idempotencyKey: serial.toString(16).padStart(64, '0'),
    elapsedMs: hour,
    activeMs: hour,
    longestHandsOffMs: hour / 2,
    interventionCount: null,
    peakActiveMembers: 1,
    agentMs: hour,
    rawTokens: 100,
    normalizedTokens: 140,
    sources: ['codex'],
    assurance: ['observed'],
    outcome: 'unknown',
    ...overrides,
  } satisfies PublicRunUpload;
}

function plan(overrides: Partial<OperatorStatsPublicationPlanInput> = {}) {
  return planOperatorStatsPublication({
    timezone: 'America/Los_Angeles',
    since: SINCE,
    completeSinceMs: Number.NEGATIVE_INFINITY,
    cursor: null,
    now: NOW,
    days: [],
    runs: [],
    ...overrides,
  });
}

function expectWellFormed(result: OperatorStatsPublicationPlan) {
  let expected = result.coverage?.from ?? null;
  for (const publication of result.publications) {
    expect(parseOperatorStatsPublication(publication)).toEqual(publication);
    if (expected) expect(publication.coverage.from).toBe(expected);
    expected = addCalendarDays(publication.coverage.through, 1);
  }
}

describe('planOperatorStatsPublication', () => {
  it('backfills everything since consent when nothing has been published', () => {
    const days = [day('2026-08-03'), day('2026-09-10'), day('2026-09-23')];
    const result = plan({
      days,
      runs: days.map(value => run(value.localDate)),
    });
    expect(result.coverage).toEqual({
      from: '2026-08-03',
      through: '2026-09-23',
    });
    expect(result.publications).toHaveLength(2);
    expectWellFormed(result);
  });

  it('republishes only the trailing week after a current cursor', () => {
    const result = plan({
      cursor: {
        publishedThrough: '2026-09-23',
        derivation: OPERATOR_STATS_DERIVATION_VERSION,
      },
      days: [day('2026-08-10'), day('2026-09-20')],
      runs: [run('2026-08-10'), run('2026-09-20')],
    });
    expect(result.coverage).toEqual({
      from: addCalendarDays('2026-09-23', -PUBLICATION_TRAILING_DAYS),
      through: '2026-09-23',
    });
    expect(result.publications.flatMap(value => value.runs)).toHaveLength(1);
    // Totals still describe everything since consent.
    expect(result.totals.runs).toBe(2);
  });

  it('covers a long outage from where the cursor stopped', () => {
    const result = plan({
      cursor: {
        publishedThrough: '2026-09-13',
        derivation: OPERATOR_STATS_DERIVATION_VERSION,
      },
    });
    expect(result.coverage?.from).toBe(
      addCalendarDays('2026-09-13', -PUBLICATION_TRAILING_DAYS)
    );
  });

  it('republishes since consent when the hosted history has an older derivation', () => {
    const result = plan({
      cursor: { publishedThrough: '2026-09-23', derivation: 1 },
    });
    expect(result.coverage?.from).toBe('2026-08-03');
    expectWellFormed(result);
  });

  it('never covers a date retention may have pruned', () => {
    // Samples up to 2026-09-01 12:00 local were dropped; that day is partial.
    const result = plan({
      completeSinceMs: Date.parse('2026-09-01T19:00:00.000Z'),
      days: [day('2026-08-20'), day('2026-09-05')],
    });
    expect(result.coverage?.from).toBe('2026-09-02');
    expect(
      result.publications.flatMap(value => value.days).map(v => v.localDate)
    ).toEqual(['2026-09-05']);
  });

  it('quarantines a refused day and leaves its date uncovered', () => {
    const result = plan({
      cursor: {
        publishedThrough: '2026-09-23',
        derivation: OPERATOR_STATS_DERIVATION_VERSION,
      },
      days: [
        day('2026-09-18'),
        day('2026-09-20', { rawTokens: Number.POSITIVE_INFINITY }),
        day('2026-09-22'),
      ],
    });
    expect(result.excluded).toEqual([
      {
        localDate: '2026-09-20',
        kind: 'day',
        reason: expect.stringMatching(/rawTokens is out of bounds/),
      },
    ]);
    const covered = result.publications.flatMap(publication => {
      const span = calendarDaysBetween(
        publication.coverage.from,
        publication.coverage.through
      );
      return Array.from({ length: span + 1 }, (_, offset) =>
        addCalendarDays(publication.coverage.from, offset)
      );
    });
    expect(covered).not.toContain('2026-09-20');
    expect(covered).toContain('2026-09-18');
    expect(covered).toContain('2026-09-22');
  });

  it('quarantines a refused Run without holding back its day', () => {
    const result = plan({
      days: [day('2026-09-20')],
      runs: [
        run('2026-09-20', { elapsedMs: 50 * 24 * hour }),
        run('2026-09-20'),
      ],
    });
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].kind).toBe('run');
    const published = result.publications.flatMap(value => value.runs);
    expect(published).toHaveLength(1);
    expect(result.publications.flatMap(value => value.days)).toHaveLength(1);
  });

  it('keeps the biggest receipts when one day has more than a publication carries', () => {
    const runs = Array.from({ length: MAX_PUBLICATION_RUNS + 100 }, (_, i) =>
      run('2026-09-20', { agentMs: i })
    );
    const result = plan({
      days: [day('2026-09-20', { runCount: runs.length })],
      runs,
    });
    const published = result.publications.flatMap(value => value.runs);
    expect(published).toHaveLength(MAX_PUBLICATION_RUNS);
    expect(Math.min(...published.map(value => value.agentMs))).toBe(100);
    expect(result.receiptsOmitted).toBe(100);
    expect(result.publications.flatMap(value => value.days)[0].runCount).toBe(
      runs.length
    );
    expectWellFormed(result);
  });

  it('fits any history into contract-valid, contiguous publications', () => {
    // Deterministic pseudo-random histories spanning well over a year, with
    // days far denser than one publication can carry.
    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 4; trial += 1) {
      const days: OperatorDayAggregate[] = [];
      const runs: PublicRunUpload[] = [];
      for (let offset = 0; offset < 420; offset += 1) {
        if (random() < 0.6) continue;
        const date = addCalendarDays('2026-08-03', offset - 380);
        // Mostly ordinary days, and now and then one busier than a whole
        // publication can carry.
        const count =
          random() < 0.03
            ? MAX_PUBLICATION_RUNS + Math.floor(random() * 50)
            : Math.floor(random() * 30);
        days.push(day(date, { runCount: count }));
        for (let index = 0; index < count; index += 1) runs.push(run(date));
      }
      const result = plan({
        since: '2025-08-01T00:00:00.000Z',
        days,
        runs,
      });
      expectWellFormed(result);
      for (const publication of result.publications) {
        expect(
          calendarDaysBetween(
            publication.coverage.from,
            publication.coverage.through
          ) + 1
        ).toBeLessThanOrEqual(MAX_PUBLICATION_DAYS);
      }
      expect(result.publications.at(-1)?.coverage.through).toBe(
        result.coverage?.through
      );
    }
  });

  it('publishes nothing when no complete date remains', () => {
    const result = plan({ completeSinceMs: NOW + 48 * hour });
    expect(result.coverage).toBeNull();
    expect(result.publications).toEqual([]);
  });
});
