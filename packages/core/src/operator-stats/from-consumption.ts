import { totalTokens } from '../consumption/merge';
import { resolveModelWeight, weightUsage } from '../consumption/model-weights';
import {
  isOperatorEntrypoint,
  SOURCE_CAPABILITIES,
  type ConsumptionSample,
} from '../consumption/types';
import type { OperatorActivityInterval, OperatorRunFacts } from './types';

const DEFAULT_INACTIVITY_CEILING_MS = 15 * 60 * 1000;

interface MemberSeries {
  timestamps: number[];
  reported: boolean;
}

/**
 * Conservative historical adapter for timestamped consumption logs. It never
 * claims exact turn boundaries: activity is the observed time between usage
 * events, capped at a documented inactivity ceiling. Live sources can emit
 * exact activity intervals through OperatorRunFacts directly.
 */
export function consumptionSamplesToRunFacts(
  samples: readonly ConsumptionSample[],
  options: { since: string; inactivityCeilingMs?: number }
): OperatorRunFacts[] {
  const since = Date.parse(options.since);
  if (!Number.isFinite(since)) throw new Error('Invalid operator stats start');
  const ceiling = options.inactivityCeilingMs ?? DEFAULT_INACTIVITY_CEILING_MS;
  const sessions = new Map<string, ConsumptionSample[]>();

  for (const sample of samples) {
    const at = Date.parse(sample.at);
    if (at < since || !isOperatorEntrypoint(sample.entrypoint)) continue;
    const key = `${sample.source}:${sample.providerSessionId}`;
    const bucket = sessions.get(key) ?? [];
    bucket.push(sample);
    sessions.set(key, bucket);
  }

  return [...sessions.entries()].map(([localKey, bucket]) => {
    bucket.sort((left, right) => left.at.localeCompare(right.at));
    const members = new Map<string, MemberSeries>();
    let rawTokens = 0;
    let normalizedTokens = 0;
    for (const sample of bucket) {
      const member = sample.delegation
        ? `delegated:${sample.delegation.agentId}`
        : 'root';
      const series = members.get(member) ?? {
        timestamps: [],
        reported: Boolean(sample.delegation),
      };
      series.timestamps.push(Date.parse(sample.at));
      members.set(member, series);
      rawTokens += totalTokens(sample.usage);
      normalizedTokens += weightUsage(
        sample.usage,
        resolveModelWeight(sample.model).weight
      );
    }

    const activity: OperatorActivityInterval[] = [];
    for (const series of members.values()) {
      const timestamps = [...new Set(series.timestamps)].sort((a, b) => a - b);
      for (let index = 1; index < timestamps.length; index += 1) {
        const endedAt = timestamps[index];
        const startedAt = Math.max(timestamps[index - 1], endedAt - ceiling);
        if (endedAt <= startedAt) continue;
        activity.push({
          startedAt: new Date(startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          activeMembers: 1,
          assurance: series.reported ? 'reported' : 'derived',
        });
      }
    }

    return {
      localKey,
      startedAt: bucket[0].at,
      endedAt: bucket[bucket.length - 1].at,
      activity,
      operatorInterventionsAt: null,
      rawTokens,
      normalizedTokens,
      sources: [...new Set(bucket.map(sample => sample.source))].sort(),
      assurance:
        activity.length === 0
          ? ['unavailable']
          : bucket.some(
                sample => !SOURCE_CAPABILITIES[sample.source].delegation
              )
            ? ['observed', 'derived', 'unavailable']
            : ['observed', 'derived'],
      outcome: 'unknown',
    };
  });
}
