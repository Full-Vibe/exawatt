import type {
  AssuranceFacetName,
  ConsumptionSourceId,
} from '../consumption/types';

export const OPERATOR_STATS_SCHEMA_VERSION = 1 as const;
export const OPERATOR_STATS_CONSENT_VERSION = 1 as const;

export type OperatorStatsAssurance =
  | 'reported'
  | 'observed'
  | 'derived'
  | 'unavailable';

export type OperatorRunOutcome = 'settled' | 'stopped' | 'faulted' | 'unknown';

/** A source-neutral interval during which one or more Agents were working. */
export interface OperatorActivityInterval {
  startedAt: string;
  endedAt: string;
  activeMembers: number;
  assurance: OperatorStatsAssurance;
}

/**
 * Sanitized facts emitted by a local source adapter. Content and raw harness
 * identifiers are deliberately absent from this contract.
 */
export interface OperatorRunFacts {
  localKey: string;
  startedAt: string;
  endedAt: string;
  activity: OperatorActivityInterval[];
  /** null when the source cannot observe operator messages within the Run. */
  operatorInterventionsAt: string[] | null;
  rawTokens: number;
  normalizedTokens: number;
  sources: ConsumptionSourceId[];
  assurance: OperatorStatsAssurance[];
  outcome: OperatorRunOutcome;
}

export interface DerivedOperatorRun {
  localKey: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  activeMs: number;
  longestHandsOffMs: number;
  interventionCount: number | null;
  peakActiveMembers: number;
  agentMs: number;
  rawTokens: number;
  normalizedTokens: number;
  sources: ConsumptionSourceId[];
  assurance: OperatorStatsAssurance[];
  outcome: OperatorRunOutcome;
}

export interface OperatorDayAggregate {
  localDate: string;
  agentMs: number;
  runCount: number;
  peakFleet: number;
  longestHandsOffMs: number;
  rawTokens: number;
  normalizedTokens: number;
  sources: ConsumptionSourceId[];
  assurance: OperatorStatsAssurance[];
}

export interface OperatorStatsSnapshot {
  schemaVersion: typeof OPERATOR_STATS_SCHEMA_VERSION;
  timezone: string;
  generatedAt: string;
  runs: DerivedOperatorRun[];
  days: OperatorDayAggregate[];
  records: {
    agentMs: number;
    longestHandsOffMs: number;
    peakFleet: number;
    normalizedTokens: number;
  };
}

export interface PublicOperatorIdentity {
  provider: string;
  providerHandle: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  links: string[];
}

export interface PublicRunUpload extends Omit<
  DerivedOperatorRun,
  'localKey' | 'startedAt' | 'endedAt'
> {
  publicId: string;
  localDate: string;
  idempotencyKey: string;
}

export interface OperatorStatsPublishPayload {
  schemaVersion: typeof OPERATOR_STATS_SCHEMA_VERSION;
  consentVersion: typeof OPERATOR_STATS_CONSENT_VERSION;
  enabled: true;
  timezone: string;
  identity: PublicOperatorIdentity;
  days: OperatorDayAggregate[];
  runs: PublicRunUpload[];
}

/**
 * Public ranking axes. The id IS the `/leaderboard?metric=` value and the
 * `get_operator_leaderboard` argument, so it stays readable and matches the
 * visible label. Renamed 2026-08-04 (FIX-003) from `command`/`endurance`/
 * `fleet`/`energy`; the old vocabulary is gone, not aliased.
 */
export type LeaderboardAxis =
  | 'agent-hours'
  | 'hands-off'
  | 'peak-fleet'
  | 'tokens';
export type LeaderboardWindow = 'week' | 'all';

export interface RankableOperator {
  handle: string;
  displayName: string;
  joinedAt: string;
  agentMs: number;
  longestHandsOffMs: number;
  peakFleet: number;
  normalizedTokens: number;
}

export interface RankedOperator extends RankableOperator {
  rank: number;
  value: number;
}
