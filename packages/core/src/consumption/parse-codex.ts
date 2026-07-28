/**
 * Codex rollout parser.
 *
 * Input shape (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`), one envelope
 * per line: `{ timestamp, type, payload }`.
 *
 * - `type: "session_meta"` — `payload.session_id`, `payload.cwd`,
 *   `payload.cli_version`, `payload.model_provider`. First line of the file.
 * - `type: "turn_context"` — `payload.model`, `payload.cwd`, and
 *   `payload.collaboration_mode.settings.reasoning_effort`. This is the ONLY
 *   place Codex records the model; `session_meta` does not carry one. Emitted
 *   before each turn, so the model can change mid-session.
 * - `type: "event_msg"` with `payload.type === "token_count"` — usage and
 *   rate limits.
 *
 * ## The cumulative-vs-delta problem
 *
 * `payload.info.total_token_usage` is CUMULATIVE for the session;
 * `payload.info.last_token_usage` is that turn's delta. Naive summing of either
 * one is wrong, and in three distinct ways that the real corpus exhibits:
 *
 * 1. **Duplicate emission.** Some CLI versions emit each `token_count` twice
 *    (older ones more). 3,574 of 79,481 events over the corpus (4.5%) are exact
 *    repeats; on the worst single session, summing `last_token_usage` naively
 *    over-counts by 5.2x.
 * 2. **Interleaved counters.** A session running concurrent turns interleaves
 *    two independent cumulative series into one file, so
 *    `max(total_token_usage)` under-counts — it sees only the larger series.
 * 3. **Resumed sessions.** A resumed rollout opens with the parent session's
 *    cumulative total already carried in, so `max(total_token_usage)` counts
 *    the parent's whole history again. Three sessions in the corpus show this;
 *    on one, `max` over-counts by 12x.
 *
 * The fix that survives all three: **dedupe on the full cumulative snapshot,
 * then sum `last_token_usage` over the survivors.** The cumulative total
 * strictly increases within a series whenever a turn consumed tokens, so two
 * genuine turns cannot share a snapshot — dropping repeats is exact, not
 * heuristic. Deltas telescope correctly across resets, count both interleaved
 * series, and attribute a resumed rollout only what it actually added.
 *
 * Validated against the real corpus: the reconstruction agrees with
 * `max(total_token_usage)` within 2% on 319 of 329 sessions, and every
 * disagreement is one of the three cases above.
 *
 * `token_count` events with `info: null` are rate-limit-only heartbeats: 147 in
 * the corpus. They still produce a `PlanWindow` and no sample.
 *
 * ## Field semantics
 *
 * Codex's `input_tokens` INCLUDES `cached_input_tokens` and
 * `cache_write_input_tokens` (verified over 79,481 events: `cached <= input`
 * always). `reasoning_output_tokens` is a SUBSET of `output_tokens`
 * (`input + output == total` holds on 99.4% of events). Both are normalized
 * into `RawUsage` accordingly.
 */
import {
  parseJsonObject,
  readCount,
  readObject,
  readPositiveInt,
  readString,
  toIso,
} from './lines';
import { localLogAssurance, planWindowAssurance } from './assurance';
import type {
  ConsumptionDiagnostics,
  ConsumptionSample,
  PlanWindow,
  RawUsage,
} from './types';
import { emptyDiagnostics } from './types';

const SOURCE = 'codex' as const;

/**
 * Session-scoped facts a rollout establishes once and reuses. An incremental
 * scanner persists this alongside the byte watermark so a tail-only read still
 * knows the cwd and model.
 */
export interface CodexSessionContext {
  providerSessionId: string | null;
  cwd: string | null;
  model: string | null;
  effort: string | null;
  contextWindow: number | null;
  cliVersion: string | null;
  /** Codex's `originator` (e.g. `codex-tui`) — the entrypoint analogue. */
  originator: string | null;
  /** Cumulative snapshots already counted, for cross-read idempotency. */
  seenSnapshots: string[];
}

export function emptyCodexContext(): CodexSessionContext {
  return {
    providerSessionId: null,
    cwd: null,
    model: null,
    effort: null,
    contextWindow: null,
    cliVersion: null,
    originator: null,
    seenSnapshots: [],
  };
}

export interface CodexParseContext {
  sourceFile?: string | null;
  /** Session id derived from the filename when `session_meta` is unavailable. */
  fallbackSessionId?: string | null;
  /** Carried context from a previous incremental read of the same file. */
  session?: CodexSessionContext;
}

export interface CodexParseResult {
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  diagnostics: ConsumptionDiagnostics;
  /** Updated context to persist for the next incremental read. */
  session: CodexSessionContext;
}

function usageSignature(usage: Record<string, unknown>): string {
  return [
    readCount(usage, 'input_tokens'),
    readCount(usage, 'cached_input_tokens'),
    readCount(usage, 'cache_write_input_tokens'),
    readCount(usage, 'output_tokens'),
    readCount(usage, 'reasoning_output_tokens'),
    readCount(usage, 'total_tokens'),
  ].join('.');
}

function codexUsage(usage: Record<string, unknown>): RawUsage {
  const promptTokens = readCount(usage, 'input_tokens');
  const cacheReadTokens = readCount(usage, 'cached_input_tokens');
  const cacheWriteTokens = readCount(usage, 'cache_write_input_tokens');
  return {
    // Codex counts cached and cache-write tokens inside `input_tokens`.
    inputTokens: Math.max(0, promptTokens - cacheReadTokens - cacheWriteTokens),
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: readCount(usage, 'output_tokens'),
    reasoningTokens: readCount(usage, 'reasoning_output_tokens'),
    // Codex does not report provider-side web tool calls in the rollout.
    webSearches: 0,
    webFetches: 0,
  };
}

function planWindowsFrom(
  rateLimits: Record<string, unknown>,
  observedAt: string,
  providerSessionId: string
): PlanWindow[] {
  const planType = readString(rateLimits, 'plan_type');
  const limitId = readString(rateLimits, 'limit_id');
  const limitName = readString(rateLimits, 'limit_name');
  const out: PlanWindow[] = [];
  for (const scope of ['primary', 'secondary'] as const) {
    const window = readObject(rateLimits, scope);
    if (!window) continue;
    const usedPercent = window.used_percent;
    const windowMinutes = window.window_minutes;
    if (
      typeof usedPercent !== 'number' ||
      !Number.isFinite(usedPercent) ||
      typeof windowMinutes !== 'number' ||
      !Number.isFinite(windowMinutes)
    ) {
      continue;
    }
    out.push({
      source: SOURCE,
      limitId,
      limitName,
      scope,
      usedPercent,
      windowMinutes: Math.trunc(windowMinutes),
      resetsAt: toIso(window.resets_at),
      planType,
      observedAt,
      providerSessionId,
    });
  }
  return out;
}

/**
 * Parse already-framed complete lines of one rollout file. Pure: no IO, no
 * clock, no throw.
 */
export function parseCodexRollout(
  lines: Iterable<string>,
  context: CodexParseContext = {}
): CodexParseResult {
  const diagnostics = emptyDiagnostics();
  const samples: ConsumptionSample[] = [];
  const planWindows: PlanWindow[] = [];
  const sampleAssurance = localLogAssurance(SOURCE);
  const sourceFile = context.sourceFile ?? null;

  const session: CodexSessionContext = {
    ...emptyCodexContext(),
    ...(context.session ?? {}),
    seenSnapshots: [...(context.session?.seenSnapshots ?? [])],
  };
  if (!session.providerSessionId && context.fallbackSessionId) {
    session.providerSessionId = context.fallbackSessionId;
  }
  const seen = new Set(session.seenSnapshots);

  for (const line of lines) {
    diagnostics.linesRead += 1;
    const record = parseJsonObject(line);
    if (!record) {
      diagnostics.linesUnparsable += 1;
      continue;
    }
    const payload = readObject(record, 'payload');
    const type = readString(record, 'type');

    if (type === 'session_meta' && payload) {
      session.providerSessionId =
        readString(payload, 'session_id') ??
        readString(payload, 'id') ??
        session.providerSessionId;
      session.cwd = readString(payload, 'cwd') ?? session.cwd;
      session.cliVersion =
        readString(payload, 'cli_version') ?? session.cliVersion;
      session.originator =
        readString(payload, 'originator') ?? session.originator;
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    if (type === 'turn_context' && payload) {
      // The model can change mid-session; the most recent turn_context wins.
      session.model = readString(payload, 'model') ?? session.model;
      session.cwd = readString(payload, 'cwd') ?? session.cwd;
      const settings = readObject(
        readObject(payload, 'collaboration_mode'),
        'settings'
      );
      session.effort =
        readString(settings, 'reasoning_effort') ??
        readString(payload, 'reasoning_effort') ??
        session.effort;
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    if (type !== 'event_msg' || !payload || payload.type !== 'token_count') {
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const at = toIso(record.timestamp);
    const providerSessionId = session.providerSessionId;
    if (!providerSessionId) {
      diagnostics.recordsWithoutSessionId += 1;
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const rateLimits = readObject(payload, 'rate_limits');
    if (rateLimits && at) {
      const windows = planWindowsFrom(rateLimits, at, providerSessionId);
      for (const window of windows) planWindows.push(window);
      diagnostics.planWindowsEmitted += windows.length;
    }

    const info = readObject(payload, 'info');
    if (!info) {
      // Rate-limit-only heartbeat. Counted, not dropped in silence.
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const cumulative = readObject(info, 'total_token_usage');
    const delta = readObject(info, 'last_token_usage');
    if (!cumulative || !delta || !at) {
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    session.contextWindow =
      readPositiveInt(info, 'model_context_window') ?? session.contextWindow;

    // Dedupe on the cumulative snapshot. Exact, not heuristic: within one
    // counter series the cumulative total strictly increases whenever a turn
    // consumed tokens, so a repeated snapshot is always a repeated event.
    const snapshot = `${usageSignature(cumulative)}|${usageSignature(delta)}`;
    if (seen.has(snapshot)) {
      diagnostics.duplicatesMerged += 1;
      continue;
    }
    seen.add(snapshot);

    if (!session.cwd) diagnostics.recordsWithoutCwd += 1;
    if (!session.model) diagnostics.recordsWithoutModel += 1;

    samples.push({
      at,
      source: SOURCE,
      model: session.model,
      effort: session.effort,
      providerSessionId,
      cwd: session.cwd,
      // Codex does not record a git branch in the rollout.
      gitBranch: null,
      usage: codexUsage(delta),
      assurance: sampleAssurance,
      idempotencyKey: `${SOURCE}:snap:${providerSessionId}:${snapshot}`,
      contextWindow: session.contextWindow,
      sourceFile,
      // Codex writes no on-disk delegation record. `SOURCE_CAPABILITIES.codex`
      // reports the capability as absent so this null is never read as "no
      // delegation happened".
      delegation: null,
      entrypoint: session.originator,
    });
    diagnostics.samplesEmitted += 1;
  }

  session.seenSnapshots = [...seen];
  return { samples, planWindows, diagnostics, session };
}

/** Assurance carried by every `PlanWindow` this parser emits. */
export const CODEX_PLAN_WINDOW_ASSURANCE = planWindowAssurance(SOURCE);

/**
 * Latest observed state per (limitId, scope, windowMinutes). Repeated identical
 * windows across thousands of events collapse to the one that matters.
 */
export function latestPlanWindows(
  windows: Iterable<PlanWindow>
): PlanWindow[] {
  const byBucket = new Map<string, PlanWindow>();
  for (const window of windows) {
    const key = `${window.source}|${window.limitId ?? ''}|${window.scope}|${window.windowMinutes}`;
    const existing = byBucket.get(key);
    if (!existing || window.observedAt > existing.observedAt) {
      byBucket.set(key, window);
    }
  }
  return [...byBucket.values()].sort((left, right) =>
    left.observedAt < right.observedAt ? 1 : -1
  );
}
