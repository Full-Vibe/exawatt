import { createHash } from 'node:crypto';
import {
  consumptionSamplesToRunFacts,
  deriveOperatorStatsSnapshot,
  isCalendarDate,
  operatorLocalDate,
  parseOperatorStatsSyncEvent,
  planOperatorStatsPublication,
  type ConsumptionSample,
  type OperatorStatsPublicationPlan,
  type PublicRunUpload,
} from '@exawatt/core';
import type { DiagnosticRecorder } from './diagnostics-log';
import { handleTrusted } from './ipc-security';
import { recordOperatorStatsSync } from './settings-store';
import type { OperatorStatsPlanRequest } from '@exawatt/core/desktop-bridge';

export interface OperatorStatsConsumptionSource {
  /**
   * A complete, incrementally maintained local sample view, and the instant
   * after which it is complete (retention may have dropped what is older).
   */
  settledSampleView(sinceMs: number): Promise<{
    samples: ConsumptionSample[];
    completeSinceMs: number;
  }>;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function parsePlanRequest(value: unknown): OperatorStatsPlanRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid operator stats request');
  }
  const raw = value as Record<string, unknown>;
  const cursor = raw.cursor as Record<string, unknown> | null | undefined;
  if (
    typeof raw.since !== 'string' ||
    typeof raw.timezone !== 'string' ||
    !(
      cursor === null ||
      (cursor !== undefined &&
        typeof cursor === 'object' &&
        isCalendarDate(cursor.publishedThrough) &&
        Number.isInteger(cursor.derivation))
    )
  ) {
    throw new Error('Invalid operator stats request');
  }
  return {
    since: raw.since,
    timezone: raw.timezone,
    cursor: cursor
      ? {
          publishedThrough: cursor.publishedThrough as string,
          derivation: cursor.derivation as number,
        }
      : null,
  };
}

/**
 * Plans the publications a sync sends: the whole local derivation since
 * consent, cut to the hosted contract. Identifiers leave this function only
 * as one-way hashes; content, paths, and provider Session ids never do.
 */
export async function planLocalOperatorStats(
  source: OperatorStatsConsumptionSource,
  request: OperatorStatsPlanRequest,
  now: number = Date.now()
): Promise<OperatorStatsPublicationPlan> {
  const sinceMs = Date.parse(request.since);
  if (!Number.isFinite(sinceMs) || sinceMs > now + 60_000) {
    throw new Error('Invalid publication start');
  }
  operatorLocalDate(now, request.timezone);
  // Operator stats is a projection of the canonical Consumption spine, not a
  // second corpus scanner. Besides avoiding a multi-gigabyte reread every six
  // hours, this keeps source parsing/watermarks under one main-process owner.
  // V1's hosted allowlist accepts Claude Code and Codex only; newer source
  // adapters remain absent until the public schema explicitly evolves.
  const view = await source.settledSampleView(sinceMs);
  const samples = view.samples.filter(
    sample => sample.source === 'claude-code' || sample.source === 'codex'
  );
  const facts = consumptionSamplesToRunFacts(samples, {
    since: request.since,
  });
  const snapshot = deriveOperatorStatsSnapshot(facts, request.timezone);
  const runs: PublicRunUpload[] = snapshot.runs.map(run => ({
    publicId: `run_${hash(`public:${run.localKey}`).slice(0, 24)}`,
    localDate: operatorLocalDate(run.startedAt, request.timezone),
    idempotencyKey: hash(`operator-run-v1:${run.localKey}`),
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
  }));
  return planOperatorStatsPublication({
    timezone: request.timezone,
    since: request.since,
    completeSinceMs: view.completeSinceMs,
    cursor: request.cursor,
    now,
    days: snapshot.days,
    runs,
  });
}

export function registerOperatorStatsIPC(
  source: OperatorStatsConsumptionSource,
  record: DiagnosticRecorder
): void {
  handleTrusted('operator-stats:plan', async (_event, raw: unknown) => {
    const plan = await planLocalOperatorStats(source, parsePlanRequest(raw));
    // A quarantined row is published around, never silently: it is the
    // earliest sign the derivation produced something the contract refuses.
    for (const exclusion of plan.excluded) {
      record('operator-stats.row-excluded', { ...exclusion });
    }
    return plan;
  });
  handleTrusted('operator-stats:record', (_event, raw: unknown) =>
    recordOperatorStatsSyncEvent(raw, record)
  );
}

/**
 * Folds one renderer-reported sync step into the durable record, and writes
 * every failure to the diagnostics log — the line a "my leaderboard stopped
 * updating" report starts from, which BUG-164's nine silent days lacked.
 */
export function recordOperatorStatsSyncEvent(
  raw: unknown,
  record: DiagnosticRecorder,
  persist: typeof recordOperatorStatsSync = recordOperatorStatsSync
) {
  const event = parseOperatorStatsSyncEvent(raw);
  if (!event) throw new Error('Invalid operator stats sync event');
  if (event.kind === 'failed') {
    record('operator-stats.sync-failed', {
      failure: event.failure,
      retryable: event.retryable,
      status: event.status,
      code: event.code,
      detail: event.detail,
    });
  }
  return persist(event);
}
