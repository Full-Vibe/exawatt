/**
 * Claude Code transcript parser.
 *
 * Input shape (`~/.claude/projects/<dir-slug>/<sessionId>.jsonl`, and the
 * subagent transcripts nested under
 * `<dir-slug>/<sessionId>/subagents/[workflows/<wf>/]agent-*.jsonl`):
 *
 *   { type: "assistant", requestId, timestamp, effort, sessionId, cwd,
 *     gitBranch, version, isSidechain,
 *     message: { model, usage: { input_tokens, cache_creation_input_tokens,
 *       cache_read_input_tokens, output_tokens,
 *       server_tool_use: { web_search_requests, web_fetch_requests } } } }
 *
 * Only `type: "assistant"` lines with a `message.usage` object carry usage.
 * Every other line is counted as `linesWithoutUsage` and dropped.
 *
 * Anthropic's `input_tokens` is disjoint from the two cache counters, so it maps
 * straight to `RawUsage.inputTokens`. There is no reasoning-token field.
 *
 * ## Delegated runs are additive, not a subset
 *
 * Subagent transcripts are NOT optional. Over the operator's real corpus they
 * hold 39% of all usage lines, and their usage is NOT reflected anywhere in the
 * parent transcript. Verified three ways:
 *
 * - `agentId` partitions the corpus exactly: present on 23,198 of 23,198
 *   delegated usage lines and on 0 of 36,044 parent usage lines.
 * - No parent `toolUseResult` carries any token or usage rollup field.
 * - Only 18 `requestId`s (0.07%) appear on both sides, all of them context-
 *   inheriting `fork` runs. The idempotency key includes `agentId`, so a parent
 *   turn and a delegated run are never merged into each other even when the
 *   provider reused a request id.
 *
 * Scanning only the top-level `*.jsonl` files therefore under-reports Claude
 * consumption by the whole delegated share.
 */
import {
  parseJsonObject,
  readCount,
  readObject,
  readPositiveInt,
  readString,
  toIso,
} from './lines';
import { localLogAssurance } from './assurance';
import type {
  ConsumptionDelegation,
  ConsumptionDiagnostics,
  ConsumptionSample,
  RawUsage,
} from './types';
import { emptyDiagnostics } from './types';

const SOURCE = 'claude-code' as const;

/** Claude Code writes this in place of a model id for locally synthesized turns. */
const SYNTHETIC_MODEL = '<synthetic>';

/**
 * The `agent-<agentId>.meta.json` written beside a delegated transcript at
 * spawn time. Every field is optional in the real corpus: `agentType` appears on
 * 641 of 671 delegated transcripts and `spawnDepth` on only 300, so the parser
 * treats the whole file as enrichment and never depends on it.
 */
export interface ClaudeDelegationMeta {
  agentType?: unknown;
  spawnDepth?: unknown;
  parentAgentId?: unknown;
  isFork?: unknown;
}

export interface ClaudeParseContext {
  /** Path recorded on emitted samples for evidence links. */
  sourceFile?: string | null;
  /** Fallback session id when a line omits one (subagent files never do). */
  fallbackSessionId?: string | null;
  /** Spawn metadata for a delegated transcript, when the adapter read one. */
  delegationMeta?: ClaudeDelegationMeta | null;
}

export interface ClaudeParseResult {
  samples: ConsumptionSample[];
  diagnostics: ConsumptionDiagnostics;
}

function claudeUsage(usage: Record<string, unknown>): RawUsage {
  const serverToolUse = readObject(usage, 'server_tool_use');
  return {
    inputTokens: readCount(usage, 'input_tokens'),
    cacheReadTokens: readCount(usage, 'cache_read_input_tokens'),
    cacheWriteTokens: readCount(usage, 'cache_creation_input_tokens'),
    outputTokens: readCount(usage, 'output_tokens'),
    // Claude Code does not report reasoning tokens separately.
    reasoningTokens: 0,
    webSearches: readCount(serverToolUse, 'web_search_requests'),
    webFetches: readCount(serverToolUse, 'web_fetch_requests'),
  };
}

/**
 * Delegation attribution for one record.
 *
 * `agentId` on the transcript line is the discriminator — it is present on every
 * delegated usage record and on no parent record, so delegation is a fact read
 * from the data rather than inferred from the file path. `attributionAgent`
 * carries the same vocabulary as the spawn metadata's `agentType`, so it is
 * preferred: it covers 99.8% of delegated records with no extra file read.
 */
function delegationFrom(
  record: Record<string, unknown>,
  providerSessionId: string,
  meta: ClaudeDelegationMeta | null
): ConsumptionDelegation | null {
  const agentId = readString(record, 'agentId');
  if (!agentId) return null;
  const metaAgentType =
    typeof meta?.agentType === 'string' && meta.agentType.length > 0
      ? meta.agentType
      : null;
  const metaParent =
    typeof meta?.parentAgentId === 'string' && meta.parentAgentId.length > 0
      ? meta.parentAgentId
      : null;
  return {
    agentId,
    parentSessionId: providerSessionId,
    agentType: readString(record, 'attributionAgent') ?? metaAgentType,
    spawnDepth: readPositiveInt(
      meta ? ({ ...meta } as Record<string, unknown>) : null,
      'spawnDepth'
    ),
    skill: readString(record, 'attributionSkill'),
    background: readString(record, 'sessionKind') === 'bg',
    parentAgentId: metaParent,
  };
}

/**
 * Parse already-framed complete lines. Pure: no IO, no clock, no throw.
 */
export function parseClaudeTranscript(
  lines: Iterable<string>,
  context: ClaudeParseContext = {}
): ClaudeParseResult {
  const diagnostics = emptyDiagnostics();
  const samples: ConsumptionSample[] = [];
  const assurance = localLogAssurance(SOURCE);
  const sourceFile = context.sourceFile ?? null;
  const meta = context.delegationMeta ?? null;

  for (const line of lines) {
    diagnostics.linesRead += 1;
    const record = parseJsonObject(line);
    if (!record) {
      diagnostics.linesUnparsable += 1;
      continue;
    }
    const message = readObject(record, 'message');
    const usageRecord = readObject(message, 'usage');
    if (record.type !== 'assistant' || !usageRecord) {
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const providerSessionId =
      readString(record, 'sessionId') ??
      readString(record, 'session_id') ??
      context.fallbackSessionId ??
      null;
    if (!providerSessionId) {
      diagnostics.recordsWithoutSessionId += 1;
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const cwd = readString(record, 'cwd');
    if (!cwd) diagnostics.recordsWithoutCwd += 1;

    const rawModel = readString(message, 'model');
    const model = rawModel === SYNTHETIC_MODEL ? null : rawModel;
    if (!model) diagnostics.recordsWithoutModel += 1;

    const at =
      toIso(record.timestamp) ?? toIso(readString(record, 'created_at')) ?? null;
    if (!at) {
      // A usage record with no usable instant cannot be placed in any window.
      diagnostics.linesWithoutUsage += 1;
      continue;
    }

    const delegation = delegationFrom(record, providerSessionId, meta);
    if (delegation) diagnostics.delegatedRecords += 1;

    // `requestId` is the API request identity and is the right idempotency key:
    // every assistant line written while one request streams repeats it. The
    // uuid fallback covers the 41 lines in the real corpus that lack one; it is
    // per-line rather than per-request, so those records are never merged.
    //
    // `agentId` is part of the key because 18 request ids in the real corpus
    // appear on BOTH a parent turn and a context-inheriting `fork` run. Those are
    // separate units of work; merging them would move delegated usage onto the
    // parent (or vice versa) and corrupt the delegated share.
    const requestId = readString(record, 'requestId');
    const scope = delegation ? `agent:${delegation.agentId}:` : '';
    const idempotencyKey = requestId
      ? `${SOURCE}:req:${scope}${requestId}`
      : `${SOURCE}:line:${scope}${providerSessionId}:${readString(record, 'uuid') ?? at}`;

    samples.push({
      at,
      source: SOURCE,
      model,
      effort: readString(record, 'effort'),
      providerSessionId,
      cwd,
      gitBranch: readString(record, 'gitBranch'),
      usage: claudeUsage(usageRecord),
      assurance,
      idempotencyKey,
      contextWindow: null,
      sourceFile,
      delegation,
      entrypoint: readString(record, 'entrypoint'),
    });
    diagnostics.samplesEmitted += 1;
  }

  return { samples, diagnostics };
}
