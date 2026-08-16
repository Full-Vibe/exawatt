import { createHash } from 'node:crypto';
import {
  consumptionSamplesToRunFacts,
  deriveOperatorStatsSnapshot,
  type ConsumptionSample,
  type OperatorStatsPublishPayload,
} from '@exawatt/core';
import { handleTrusted } from './ipc-security';

export interface OperatorStatsConsumptionSource {
  /** A complete, incrementally maintained local sample view. */
  settledSamplesSince(sinceMs: number): Promise<ConsumptionSample[]>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function localDate(at: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export async function scanLocalOperatorStats(
  source: OperatorStatsConsumptionSource,
  since: string,
  timezone: string
): Promise<
  Pick<
    OperatorStatsPublishPayload,
    | 'schemaVersion'
    | 'consentVersion'
    | 'enabled'
    | 'timezone'
    | 'days'
    | 'runs'
  >
> {
  const sinceMs = Date.parse(since);
  if (!Number.isFinite(sinceMs) || sinceMs > Date.now() + 60_000) {
    throw new Error('Invalid publication start');
  }
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  // Operator stats is a projection of the canonical Consumption spine, not a
  // second corpus scanner. Besides avoiding a multi-gigabyte reread every six
  // hours, this keeps source parsing/watermarks under one main-process owner.
  // V1's hosted allowlist accepts Claude Code and Codex only; newer source
  // adapters remain absent until the public schema explicitly evolves.
  const samples = (await source.settledSamplesSince(sinceMs)).filter(
    sample => sample.source === 'claude-code' || sample.source === 'codex'
  );
  const facts = consumptionSamplesToRunFacts(samples, { since });
  const snapshot = deriveOperatorStatsSnapshot(facts, timezone);
  return {
    schemaVersion: 1,
    consentVersion: 1,
    enabled: true,
    timezone,
    days: snapshot.days,
    runs: snapshot.runs.map(run => {
      const idempotencyKey = hash(`operator-run-v1:${run.localKey}`);
      return {
        publicId: `run_${hash(`public:${run.localKey}`).slice(0, 24)}`,
        localDate: localDate(run.startedAt, timezone),
        idempotencyKey,
        elapsedMs: run.elapsedMs,
        activeMs: run.activeMs,
        longestHandsOffMs: run.longestHandsOffMs,
        interventionCount: run.interventionCount,
        peakActiveMembers: run.peakActiveMembers,
        agentMs: run.agentMs,
        rawTokens: run.rawTokens,
        normalizedTokens: run.normalizedTokens,
        sources: run.sources,
        assurance: run.assurance,
        outcome: run.outcome,
      };
    }),
  };
}

export function registerOperatorStatsIPC(
  source: OperatorStatsConsumptionSource
): void {
  handleTrusted(
    'operator-stats:scan',
    (_event, since: string, timezone: string) => {
      if (typeof since !== 'string' || typeof timezone !== 'string') {
        throw new Error('Invalid operator stats request');
      }
      return scanLocalOperatorStats(source, since, timezone);
    }
  );
}
