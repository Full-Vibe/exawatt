import { totalTokens } from '../consumption/merge';
import {
  resolveModelWeight,
  weightUsage,
  type ModelWeight,
} from '../consumption/model-weights';
import {
  isOperatorEntrypoint,
  SOURCE_CAPABILITIES,
  type ConsumptionSample,
} from '../consumption/types';
import { MAX_PUBLIC_RUN_MS, RUN_IDLE_SPLIT_MS } from './contract';
import type { OperatorActivityInterval, OperatorRunFacts } from './types';

const DEFAULT_INACTIVITY_CEILING_MS = 15 * 60 * 1000;

interface TimedSample {
  sample: ConsumptionSample;
  at: number;
}

interface RunSegment {
  /** First sample of the segment; stable, so it keys the Run. */
  firstSampleAt: number;
  startMs: number;
  endMs: number;
  samples: TimedSample[];
}

/**
 * Conservative historical adapter for timestamped consumption logs. It never
 * claims exact turn boundaries: activity is the observed time between usage
 * events, capped at a documented inactivity ceiling. Live sources can emit
 * exact activity intervals through OperatorRunFacts directly.
 *
 * A provider Session is not a Run. Sessions are resumed across days and weeks
 * (`claude --resume`, Exawatt's durable Sessions), and reading one as a single
 * Run credited a week of work to the day the Session was first opened and
 * produced a 47-day Run no publication could carry (BUG-164). A Session
 * therefore splits into a new Run whenever none of its members is active for
 * `RUN_IDLE_SPLIT_MS`, and no Run spans more than `MAX_PUBLIC_RUN_MS`.
 *
 * Splitting never changes how much activity is counted: activity intervals
 * are computed over the whole Session exactly as before and then clipped into
 * the Runs they fall in. A Run that follows an idle split begins one ceiling
 * before its first sample, which is where that sample's own interval starts.
 */
export function consumptionSamplesToRunFacts(
  samples: readonly ConsumptionSample[],
  options: {
    since: string;
    inactivityCeilingMs?: number;
    idleSplitMs?: number;
    maxRunMs?: number;
  }
): OperatorRunFacts[] {
  const since = Date.parse(options.since);
  if (!Number.isFinite(since)) throw new Error('Invalid operator stats start');
  const ceiling = options.inactivityCeilingMs ?? DEFAULT_INACTIVITY_CEILING_MS;
  const idleSplit = Math.max(options.idleSplitMs ?? RUN_IDLE_SPLIT_MS, ceiling);
  const maxRun = options.maxRunMs ?? MAX_PUBLIC_RUN_MS;
  const sessions = new Map<string, TimedSample[]>();

  for (const sample of samples) {
    const at = Date.parse(sample.at);
    if (!Number.isFinite(at) || at < since) continue;
    if (!isOperatorEntrypoint(sample.entrypoint)) continue;
    const key = `${sample.source}:${sample.providerSessionId}`;
    const bucket = sessions.get(key);
    if (bucket) bucket.push({ sample, at });
    else sessions.set(key, [{ sample, at }]);
  }

  // One resolution per model, not per sample: the lookup scans the weight
  // table, and a corpus has a handful of models across ~10^5 samples.
  const weights = new Map<string | null, ModelWeight>();
  const weightOf = (model: string | null) => {
    let weight = weights.get(model);
    if (weight === undefined) {
      weight = resolveModelWeight(model).weight;
      weights.set(model, weight);
    }
    return weight;
  };

  const facts: OperatorRunFacts[] = [];
  for (const [sessionKey, bucket] of sessions) {
    bucket.sort((left, right) => left.at - right.at);
    const segments = splitSession(bucket, ceiling, idleSplit, maxRun);
    const activity = sessionActivity(bucket, ceiling);
    const perSegment = clipIntoSegments(activity, segments);
    segments.forEach((segment, index) => {
      // The first Run keeps the Session's own key, so a receipt shared while
      // a Run was a whole Session still resolves to the Run that opened it.
      const localKey =
        index === 0
          ? sessionKey
          : `${sessionKey}@${new Date(segment.firstSampleAt).toISOString()}`;
      facts.push(segmentFacts(localKey, segment, perSegment[index], weightOf));
    });
  }
  return facts;
}

function splitSession(
  bucket: readonly TimedSample[],
  ceiling: number,
  idleSplit: number,
  maxRun: number
): RunSegment[] {
  const segments: RunSegment[] = [];
  let current: RunSegment | null = null;
  let previousAt = Number.NEGATIVE_INFINITY;
  for (const entry of bucket) {
    const gap = entry.at - previousAt;
    if (
      current === null ||
      gap > idleSplit ||
      entry.at - current.startMs > maxRun
    ) {
      // The Session's first Run starts at its first sample, as it always has.
      // A later Run starts where its first sample's interval starts: one
      // ceiling back after an idle split, or at the previous sample after a
      // span split, so the Runs of one Session tile its activity exactly.
      const leadIn: number = current === null ? 0 : Math.min(gap, ceiling);
      current = {
        firstSampleAt: entry.at,
        startMs: entry.at - leadIn,
        endMs: entry.at,
        samples: [],
      };
      segments.push(current);
    }
    current.samples.push(entry);
    current.endMs = entry.at;
    previousAt = entry.at;
  }
  return segments;
}

type TimedInterval = {
  startMs: number;
  endMs: number;
  assurance: OperatorActivityInterval['assurance'];
};

function sessionActivity(
  bucket: readonly TimedSample[],
  ceiling: number
): TimedInterval[] {
  const members = new Map<
    string,
    { timestamps: number[]; reported: boolean }
  >();
  for (const { sample, at } of bucket) {
    const member = sample.delegation
      ? `delegated:${sample.delegation.agentId}`
      : 'root';
    const series = members.get(member);
    if (series) series.timestamps.push(at);
    else
      members.set(member, {
        timestamps: [at],
        reported: Boolean(sample.delegation),
      });
  }
  const activity: TimedInterval[] = [];
  for (const series of members.values()) {
    // Bucket order is already chronological, so each member's series is too.
    let previous = Number.NaN;
    for (const endedAt of series.timestamps) {
      if (endedAt === previous) continue;
      if (Number.isFinite(previous)) {
        const startedAt = Math.max(previous, endedAt - ceiling);
        if (endedAt > startedAt) {
          activity.push({
            startMs: startedAt,
            endMs: endedAt,
            assurance: series.reported ? 'reported' : 'derived',
          });
        }
      }
      previous = endedAt;
    }
  }
  return activity;
}

/** Distributes each interval over the (ordered, non-overlapping) segments it
 *  touches. Segments tile every interval, so the sum is preserved. */
function clipIntoSegments(
  activity: readonly TimedInterval[],
  segments: readonly RunSegment[]
): TimedInterval[][] {
  const result: TimedInterval[][] = segments.map(() => []);
  for (const interval of activity) {
    let index = upperBoundByStart(segments, interval.endMs) - 1;
    while (index >= 0) {
      const segment = segments[index];
      if (segment.endMs <= interval.startMs) break;
      const startMs = Math.max(interval.startMs, segment.startMs);
      const endMs = Math.min(interval.endMs, segment.endMs);
      if (endMs > startMs) {
        result[index].push({ ...interval, startMs, endMs });
      }
      if (segment.startMs <= interval.startMs) break;
      index -= 1;
    }
  }
  return result;
}

/** Index of the first segment whose start is strictly after `at`. */
function upperBoundByStart(segments: readonly RunSegment[], at: number) {
  let low = 0;
  let high = segments.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (segments[middle].startMs <= at) low = middle + 1;
    else high = middle;
  }
  return low;
}

function segmentFacts(
  localKey: string,
  segment: RunSegment,
  intervals: readonly TimedInterval[],
  weightOf: (model: string | null) => ModelWeight
): OperatorRunFacts {
  let rawTokens = 0;
  let normalizedTokens = 0;
  const sources = new Set<ConsumptionSample['source']>();
  let lacksDelegation = false;
  for (const { sample } of segment.samples) {
    rawTokens += totalTokens(sample.usage);
    normalizedTokens += weightUsage(sample.usage, weightOf(sample.model));
    sources.add(sample.source);
    if (!SOURCE_CAPABILITIES[sample.source].delegation) lacksDelegation = true;
  }
  const activity: OperatorActivityInterval[] = intervals.map(interval => ({
    startedAt: new Date(interval.startMs).toISOString(),
    endedAt: new Date(interval.endMs).toISOString(),
    activeMembers: 1,
    assurance: interval.assurance,
  }));
  return {
    localKey,
    startedAt: new Date(segment.startMs).toISOString(),
    endedAt: new Date(segment.endMs).toISOString(),
    activity,
    operatorInterventionsAt: null,
    rawTokens,
    normalizedTokens,
    sources: [...sources].sort(),
    assurance:
      activity.length === 0
        ? ['unavailable']
        : lacksDelegation
          ? ['observed', 'derived', 'unavailable']
          : ['observed', 'derived'],
    outcome: 'unknown',
  };
}
