import { createHash } from 'node:crypto';
import {
  ClaudeConsumptionAdapter,
  CodexConsumptionAdapter,
  consumptionSamplesToRunFacts,
  deriveOperatorStatsSnapshot,
  type OperatorStatsPublishPayload,
} from '@exawatt/core';
import {
  NodeConsumptionFileSystem,
  defaultClaudeConsumptionRoot,
  defaultCodexConsumptionRoot,
} from '@exawatt/core/server';
import { handleTrusted } from './ipc-security';

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
  const fs = new NodeConsumptionFileSystem({ maxFiles: 20_000 });
  const { scanConsumption } = await import('@exawatt/core');
  const scan = await scanConsumption(
    [
      new ClaudeConsumptionAdapter(defaultClaudeConsumptionRoot()),
      new CodexConsumptionAdapter(defaultCodexConsumptionRoot()),
    ],
    fs
  );
  const facts = consumptionSamplesToRunFacts(scan.samples, { since });
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

export function registerOperatorStatsIPC(): void {
  handleTrusted(
    'operator-stats:scan',
    (_event, since: string, timezone: string) => {
      if (typeof since !== 'string' || typeof timezone !== 'string') {
        throw new Error('Invalid operator stats request');
      }
      return scanLocalOperatorStats(since, timezone);
    }
  );
}
