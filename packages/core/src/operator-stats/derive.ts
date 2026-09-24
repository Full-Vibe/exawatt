import type {
  DerivedOperatorRun,
  OperatorActivityInterval,
  OperatorDayAggregate,
  OperatorRunFacts,
  OperatorStatsAssurance,
  OperatorStatsSnapshot,
} from './types';
import { OPERATOR_STATS_DERIVATION_VERSION } from './contract';

function instant(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${value}`);
  return parsed;
}

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

type SweepEvent = { at: number; delta: number };

function clippedIntervals(
  activity: OperatorActivityInterval[],
  runStart: number,
  runEnd: number
): Array<OperatorActivityInterval & { startMs: number; endMs: number }> {
  return activity
    .map(interval => ({
      ...interval,
      startMs: Math.max(
        runStart,
        instant(interval.startedAt, 'activity start')
      ),
      endMs: Math.min(runEnd, instant(interval.endedAt, 'activity end')),
    }))
    .filter(
      interval =>
        interval.endMs > interval.startMs && interval.activeMembers > 0
    );
}

/** Derive one shareable Run without retaining content or harness identifiers. */
export function deriveOperatorRun(facts: OperatorRunFacts): DerivedOperatorRun {
  const started = instant(facts.startedAt, 'run start');
  const ended = instant(facts.endedAt, 'run end');
  if (ended < started) throw new Error('Run end precedes run start');

  const intervals = clippedIntervals(facts.activity, started, ended);
  const sweep: SweepEvent[] = [];
  for (const interval of intervals) {
    if (!Number.isInteger(interval.activeMembers)) {
      throw new Error('activeMembers must be an integer');
    }
    sweep.push({ at: interval.startMs, delta: interval.activeMembers });
    sweep.push({ at: interval.endMs, delta: -interval.activeMembers });
  }
  sweep.sort((left, right) => left.at - right.at || left.delta - right.delta);

  let activeMembers = 0;
  let cursor = started;
  let activeMs = 0;
  let agentMs = 0;
  let peakActiveMembers = 0;
  const activeSegments: Array<{ started: number; ended: number }> = [];
  let activeSegmentStart: number | null = null;

  for (let index = 0; index < sweep.length; ) {
    const at = sweep[index].at;
    const duration = Math.max(0, at - cursor);
    if (activeMembers > 0) {
      activeMs += duration;
      agentMs += duration * activeMembers;
    }
    let delta = 0;
    while (index < sweep.length && sweep[index].at === at) {
      delta += sweep[index].delta;
      index += 1;
    }
    const next = activeMembers + delta;
    if (activeMembers === 0 && next > 0) activeSegmentStart = at;
    if (activeMembers > 0 && next === 0 && activeSegmentStart !== null) {
      activeSegments.push({ started: activeSegmentStart, ended: at });
      activeSegmentStart = null;
    }
    activeMembers = next;
    peakActiveMembers = Math.max(peakActiveMembers, activeMembers);
    cursor = at;
  }
  if (activeSegmentStart !== null) {
    activeSegments.push({ started: activeSegmentStart, ended });
  }

  const interventions = (facts.operatorInterventionsAt ?? [])
    .map(value => instant(value, 'operator intervention'))
    .filter(value => value >= started && value <= ended)
    .sort((left, right) => left - right);
  let longestHandsOffMs = 0;
  for (const segment of activeSegments) {
    let segmentCursor = segment.started;
    for (const intervention of interventions) {
      if (intervention <= segmentCursor || intervention >= segment.ended)
        continue;
      longestHandsOffMs = Math.max(
        longestHandsOffMs,
        intervention - segmentCursor
      );
      segmentCursor = intervention;
    }
    longestHandsOffMs = Math.max(
      longestHandsOffMs,
      segment.ended - segmentCursor
    );
  }

  return {
    localKey: facts.localKey,
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(ended).toISOString(),
    elapsedMs: ended - started,
    activeMs,
    longestHandsOffMs,
    interventionCount:
      facts.operatorInterventionsAt === null ? null : interventions.length,
    peakActiveMembers,
    agentMs,
    rawTokens: facts.rawTokens,
    normalizedTokens: facts.normalizedTokens,
    sources: uniqueSorted(facts.sources),
    assurance: uniqueSorted<OperatorStatsAssurance>(facts.assurance),
    outcome: facts.outcome,
  };
}

const LOCAL_DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The operator-local calendar date of an instant, as `YYYY-MM-DD`. Throws
 *  for an invalid IANA zone instead of silently falling back. */
export function operatorLocalDate(at: string | number, timezone: string) {
  let format = LOCAL_DATE_FORMATS.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    LOCAL_DATE_FORMATS.set(timezone, format);
  }
  const parts = format.formatToParts(new Date(at));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

export function aggregateOperatorDays(
  runs: readonly DerivedOperatorRun[],
  timezone: string
): OperatorDayAggregate[] {
  // A Run belongs to its local start day. Runs split on idle gaps, so one
  // rarely crosses midnight; splitting agent-time exactly across a boundary
  // would need source intervals in the public payload, a deliberate future
  // schema revision. Assignment is deterministic today.
  const buckets = new Map<string, OperatorDayAggregate>();
  for (const run of runs) {
    const date = operatorLocalDate(run.startedAt, timezone);
    const bucket = buckets.get(date) ?? {
      localDate: date,
      agentMs: 0,
      runCount: 0,
      peakFleet: 0,
      longestHandsOffMs: 0,
      rawTokens: 0,
      normalizedTokens: 0,
      sources: [],
      assurance: [],
    };
    bucket.agentMs += run.agentMs;
    bucket.runCount += 1;
    bucket.peakFleet = Math.max(bucket.peakFleet, run.peakActiveMembers);
    bucket.longestHandsOffMs = Math.max(
      bucket.longestHandsOffMs,
      run.longestHandsOffMs
    );
    bucket.rawTokens += run.rawTokens;
    bucket.normalizedTokens += run.normalizedTokens;
    bucket.sources = uniqueSorted([...bucket.sources, ...run.sources]);
    bucket.assurance = uniqueSorted([...bucket.assurance, ...run.assurance]);
    buckets.set(date, bucket);
  }
  return [...buckets.values()].sort((left, right) =>
    left.localDate.localeCompare(right.localDate)
  );
}

/**
 * Every activity interval of every Run on one timeline, answered as "how many
 * members were active at once between these instants". Built once per
 * snapshot: the former per-Run sweep re-sorted every interval of every Run for
 * each Run, which on the operator's corpus held Electron main for two seconds
 * every six hours.
 */
class ConcurrencyTimeline {
  private readonly times: number[] = [];
  /** Members active from `times[i]` until `times[i + 1]`. */
  private readonly levels: number[] = [];

  constructor(facts: readonly OperatorRunFacts[]) {
    const sweep: SweepEvent[] = [];
    for (const run of facts) {
      const started = instant(run.startedAt, 'run start');
      const ended = instant(run.endedAt, 'run end');
      if (ended <= started) continue;
      for (const interval of clippedIntervals(run.activity, started, ended)) {
        sweep.push({ at: interval.startMs, delta: interval.activeMembers });
        sweep.push({ at: interval.endMs, delta: -interval.activeMembers });
      }
    }
    sweep.sort((left, right) => left.at - right.at || left.delta - right.delta);
    let active = 0;
    for (let index = 0; index < sweep.length; ) {
      const at = sweep[index].at;
      while (index < sweep.length && sweep[index].at === at) {
        active += sweep[index].delta;
        index += 1;
      }
      this.times.push(at);
      this.levels.push(active);
    }
  }

  /** Peak members active at any instant in `[started, ended)`. */
  peak(started = Number.NEGATIVE_INFINITY, ended = Number.POSITIVE_INFINITY) {
    if (ended <= started) return 0;
    // The level in force at `started` comes from the last step at or before it.
    let low = 0;
    let high = this.times.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.times[middle] <= started) low = middle + 1;
      else high = middle;
    }
    let peak = low > 0 ? this.levels[low - 1] : 0;
    for (let index = low; index < this.times.length; index += 1) {
      if (this.times[index] >= ended) break;
      peak = Math.max(peak, this.levels[index]);
    }
    return peak;
  }
}

export function deriveOperatorStatsSnapshot(
  facts: readonly OperatorRunFacts[],
  timezone: string,
  generatedAt = new Date().toISOString()
): OperatorStatsSnapshot {
  // Throws for invalid IANA zones instead of silently falling back.
  operatorLocalDate(0, timezone);
  const timeline = new ConcurrencyTimeline(facts);
  const runs = facts
    .map(run => ({
      ...deriveOperatorRun(run),
      // A public Run reports the whole fleet Exawatt was commanding while it
      // was live, including other concurrent top-level Sessions.
      peakActiveMembers: timeline.peak(
        instant(run.startedAt, 'run start'),
        instant(run.endedAt, 'run end')
      ),
    }))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  // A day's fleet is the largest fleet any of its Runs commanded, which is the
  // same whole-fleet reading each Run already reports.
  const days = aggregateOperatorDays(runs, timezone);
  return {
    derivationVersion: OPERATOR_STATS_DERIVATION_VERSION,
    timezone,
    generatedAt,
    runs,
    days,
    records: {
      agentMs: runs.reduce((sum, run) => sum + run.agentMs, 0),
      longestHandsOffMs: runs.reduce(
        (longest, run) => Math.max(longest, run.longestHandsOffMs),
        0
      ),
      peakFleet: timeline.peak(),
      normalizedTokens: runs.reduce(
        (sum, run) => sum + run.normalizedTokens,
        0
      ),
    },
  };
}

export function activityGraphLevel(agentMs: number): 0 | 1 | 2 | 3 | 4 | 5 {
  const hours = agentMs / 3_600_000;
  if (hours <= 0) return 0;
  if (hours < 1) return 1;
  if (hours < 4) return 2;
  if (hours < 12) return 3;
  if (hours < 24) return 4;
  return 5;
}
