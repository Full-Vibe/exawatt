/**
 * Grok Build session-update parser (ENG-003 S4).
 *
 * Input shape: `<grok home>/sessions/<encoded cwd>/<uuid>/updates.jsonl`, one
 * JSON-RPC envelope per line —
 * `{ timestamp, method, params: { sessionId, update: { sessionUpdate, … } } }`
 * — where `method` is `session/update` (ACP) or `_x.ai/session/update` (the
 * xAI extension stream). Only one update carries billing:
 *
 * ```json
 * {"sessionUpdate":"turn_completed","prompt_id":"…","stop_reason":"end_turn",
 *  "usage":{"inputTokens":…,"outputTokens":…,"cachedReadTokens":…,
 *           "cacheCreationTokens":…,"reasoningTokens":…,"numTurns":…,
 *           "modelUsage":{"grok-4.5":{…}},"usageIsIncomplete":false}}
 * ```
 *
 * ## Why this file, not `signals.json`
 *
 * `signals.json` is the obvious candidate and it is the wrong one. It records
 * `turnCount`, `toolCallCount`, `contextTokensUsed`, `contextWindowTokens`,
 * and `totalTokensBeforeCompaction` — live occupancy and counters, not billed
 * totals. There is no cumulative input/output/cache field on it. Reading
 * context occupancy as consumption would report a number that FALLS after a
 * compaction, so it stays out of the ledger and only `turn_completed` usage
 * is counted. `signals.json` remains the honest source for turn and tool
 * counts, which this module does not need.
 *
 * ## Field semantics (the normalization that matters)
 *
 * On the ACP wire — which is what `updates.jsonl` records — `inputTokens` is
 * the FULL prompt sum and INCLUDES `cachedReadTokens` and
 * `cacheCreationTokens`. Exawatt's `RawUsage.inputTokens` is fresh, uncached
 * input only, so both cache buckets are subtracted, exactly as the Codex
 * parser subtracts Codex's. `reasoningTokens` is a SUBSET of `outputTokens`
 * and is never added to it. The subtraction is floored at zero: an
 * inconsistent record must under-report rather than emit a negative.
 *
 * ## Idempotency
 *
 * One `turn_completed` per prompt, keyed by the harness's own `prompt_id`
 * within its `sessionId`. Grok fires the gate again for each Stop-hook
 * continuation, but `turn_completed` is the terminal outcome for a prompt, so
 * `session:prompt` is a genuine unit key rather than a content hash. A
 * redelivered or replayed line therefore merges instead of double-counting.
 *
 * ## Plan windows
 *
 * Grok Build writes NO local rate-limit or plan-window record, and xAI
 * publishes no per-tier limits. That is absence, never zero:
 * `SOURCE_CAPABILITIES.grok.planWindows` is false and this parser emits no
 * `PlanWindow` at all, so no surface can render a fabricated headroom bar.
 */
import { parseJsonObject, readObject, readString, toIso } from './lines';
import { localLogAssurance } from './assurance';
import type {
  ConsumptionDiagnostics,
  ConsumptionSample,
  RawUsage,
} from './types';
import { emptyDiagnostics } from './types';

const SOURCE = 'grok' as const;

/** Session-scoped facts a stream establishes once. An incremental scanner
 *  persists this beside the byte watermark so a tail-only read still knows
 *  which session, directory, and model the appended lines belong to. */
export interface GrokSessionContext {
  providerSessionId: string;
  cwd: string | null;
  model: string | null;
  /** `prompt_id`s already counted, so at-least-once replay cannot double-bill. */
  seenPrompts: string[];
}

export function emptyGrokContext(): GrokSessionContext {
  return {
    providerSessionId: '',
    cwd: null,
    model: null,
    seenPrompts: [],
  };
}

export interface GrokParseContext {
  session?: Partial<GrokSessionContext>;
  /** Session id from the directory name when no line has named one yet. */
  fallbackSessionId?: string;
  /** Launch directory decoded from the `sessions/<dir>` component. */
  fallbackCwd?: string | null;
  sourceFile?: string | null;
}

export interface GrokParseResult {
  samples: ConsumptionSample[];
  session: GrokSessionContext;
  diagnostics: ConsumptionDiagnostics;
}

/** Bounds the replay-dedupe memory. A turn cohort never approaches this. */
const SEEN_PROMPT_CAP = 512;

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.trunc(value);
}

/** Grok's ACP usage record, normalized into Exawatt's disjoint buckets. */
export function grokUsage(usage: Record<string, unknown>): RawUsage {
  const fullInput = readNumber(usage, 'inputTokens');
  const cacheReadTokens = readNumber(usage, 'cachedReadTokens');
  const cacheWriteTokens = readNumber(usage, 'cacheCreationTokens');
  const outputTokens = readNumber(usage, 'outputTokens');
  const reasoningTokens = Math.min(
    readNumber(usage, 'reasoningTokens'),
    outputTokens
  );
  return {
    inputTokens: Math.max(0, fullInput - cacheReadTokens - cacheWriteTokens),
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    reasoningTokens,
    // Grok's web_search / web_fetch are ordinary tools, not provider-side
    // billed calls, and no usage record counts them. Absent, reported as 0
    // with `SOURCE_CAPABILITIES.grok.webToolUse` false.
    webSearches: 0,
    webFetches: 0,
  };
}

/**
 * Pick the model for a turn.
 *
 * `modelUsage` is keyed by model id and is the only per-turn model statement
 * in the record. One key means one model; several mean the turn spanned a
 * switch, and no single id is honest, so the session's last observed model is
 * used and the ambiguity is not invented away.
 */
function turnModel(
  usage: Record<string, unknown>,
  fallback: string | null
): string | null {
  const modelUsage = readObject(usage, 'modelUsage');
  if (!modelUsage) return fallback;
  const keys = Object.keys(modelUsage).filter(Boolean);
  return keys.length === 1 ? keys[0] : fallback;
}

export function parseGrokUpdates(
  lines: Iterable<string>,
  context: GrokParseContext = {}
): GrokParseResult {
  const diagnostics = emptyDiagnostics();
  const samples: ConsumptionSample[] = [];
  const assurance = localLogAssurance(SOURCE);
  const sourceFile = context.sourceFile ?? null;

  const session: GrokSessionContext = {
    ...emptyGrokContext(),
    ...(context.session ?? {}),
    seenPrompts: [...(context.session?.seenPrompts ?? [])],
  };
  if (!session.providerSessionId && context.fallbackSessionId) {
    session.providerSessionId = context.fallbackSessionId;
  }
  if (!session.cwd && context.fallbackCwd) session.cwd = context.fallbackCwd;
  const seen = new Set(session.seenPrompts);

  for (const line of lines) {
    diagnostics.linesRead += 1;
    const envelope = parseJsonObject(line);
    if (!envelope) {
      diagnostics.linesUnparsable += 1;
      continue;
    }
    const params = readObject(envelope, 'params');
    if (!params) continue;
    const sessionId = readString(params, 'sessionId');
    if (sessionId) session.providerSessionId = sessionId;
    const update = readObject(params, 'update');
    if (!update) continue;
    const kind = readString(update, 'sessionUpdate');
    if (kind !== 'turn_completed') {
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    // `prompt_id` is the field name the Rust enum serializes; the ACP-side
    // producer camelCases the same value. Accept both so a wire-shape change
    // degrades to "unkeyed turn", not to silent double-counting.
    const promptId =
      readString(update, 'prompt_id') ?? readString(update, 'promptId');
    const usage = readObject(update, 'usage');
    if (!usage) {
      // A cancelled turn completes without a bill. Not a defect.
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const providerSessionId = session.providerSessionId;
    if (!providerSessionId) {
      diagnostics.recordsWithoutSessionId += 1;
      continue;
    }
    if (!session.cwd) diagnostics.recordsWithoutCwd += 1;
    const key = promptId
      ? `${providerSessionId}:${promptId}`
      : // No prompt id means no unit key the source vouches for. Fall back to
        // this line's position in the stream so the record is still counted
        // once — under-counting real spend would be the worse failure — and
        // accept that a replayed stream can only be deduped by prompt id.
        `${providerSessionId}:line:${diagnostics.linesRead}`;
    if (seen.has(key)) {
      diagnostics.duplicatesMerged += 1;
      continue;
    }
    seen.add(key);
    session.seenPrompts.push(key);
    if (session.seenPrompts.length > SEEN_PROMPT_CAP) {
      const dropped = session.seenPrompts.splice(
        0,
        session.seenPrompts.length - SEEN_PROMPT_CAP
      );
      for (const stale of dropped) seen.delete(stale);
    }

    const model = turnModel(usage, session.model);
    if (model) session.model = model;
    else diagnostics.recordsWithoutModel += 1;
    // `timestamp` is Unix SECONDS on this envelope; `toIso` scales it.
    const at = toIso(envelope['timestamp']);
    samples.push({
      at: at ?? new Date(0).toISOString(),
      source: SOURCE,
      model,
      // `--reasoning-effort` is accepted at launch but never written into a
      // usage record, so effort is absent for every Grok sample.
      effort: null,
      providerSessionId,
      cwd: session.cwd,
      gitBranch: null,
      usage: grokUsage(usage),
      assurance,
      idempotencyKey: `grok:${key}`,
      contextWindow: null,
      sourceFile,
      // A subagent runs as its OWN Grok session directory rather than as a
      // nested transcript, so a sample never carries a parent here. The
      // relationship lives in `summary.json`'s `parent_session_id` /
      // `session_kind`, which this stream does not restate — reporting a
      // guess would be worse than the honest null.
      delegation: null,
      entrypoint: null,
    });
    diagnostics.samplesEmitted += 1;
  }

  session.seenPrompts = [...seen].slice(-SEEN_PROMPT_CAP);
  return { samples, session, diagnostics };
}
