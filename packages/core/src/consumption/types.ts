/**
 * Consumption contract (ENG-008).
 *
 * Honest Consumption is a READ-ONLY LOCAL PARSE over files the harnesses
 * already write. Nothing in this module talks to a provider billing API, and
 * nothing here converts usage into money. Raw usage is preserved first; every
 * derived number (weighted tokens, rollups) is computed from the raw record and
 * carries its own basis.
 *
 * This module is pure TypeScript: no React, no DOM, no Electron, no Three.js.
 * File IO lives behind the `ConsumptionFileSystem` port in `./ports`.
 */

/** A harness whose local records Exawatt can parse. */
export type ConsumptionSourceId = 'claude-code' | 'codex';

/**
 * Raw, provider-normalized token counts for one unit of work.
 *
 * Normalization rules — these matter, because the two harnesses disagree about
 * what "input tokens" means:
 *
 * - `inputTokens` is FRESH, uncached input only. Claude Code already reports it
 *   that way (`input_tokens` is disjoint from the cache counters). Codex does
 *   NOT: its `input_tokens` is the whole prompt including `cached_input_tokens`
 *   and `cache_write_input_tokens`, so the Codex parser subtracts them.
 * - `reasoningTokens` is a SUBSET of `outputTokens`, not an addend. Codex
 *   reports `reasoning_output_tokens` inside `output_tokens`; Claude Code does
 *   not report reasoning separately at all and leaves this 0. Never add
 *   `reasoningTokens` to `outputTokens` when totalling.
 * - Every field is a non-negative integer. A missing field is 0, never
 *   estimated — an absent measure is reported as zero usage of a measure the
 *   source does not expose, and the diagnostics record what was absent.
 */
export interface RawUsage {
  /** Fresh (uncached) prompt tokens. */
  inputTokens: number;
  /** Prompt tokens served from the provider's prefix cache. */
  cacheReadTokens: number;
  /** Prompt tokens written into the provider's prefix cache. */
  cacheWriteTokens: number;
  /** Generated tokens, inclusive of `reasoningTokens`. */
  outputTokens: number;
  /** Generated reasoning tokens. Subset of `outputTokens`. 0 when unreported. */
  reasoningTokens: number;
  /** Provider-side web search calls. 0 when unreported. */
  webSearches: number;
  /** Provider-side web fetch calls. 0 when unreported. */
  webFetches: number;
}

export const ZERO_USAGE: Readonly<RawUsage> = Object.freeze({
  inputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  webSearches: 0,
  webFetches: 0,
});

/**
 * The five independent assurance facets from `docs/product/concepts.md`.
 * Assurance is composable, not a single flag, and unavailable facets stay
 * explicit rather than being inferred.
 */
export type AssuranceFacetName =
  | 'reported'
  | 'observed'
  | 'authorized'
  | 'enforced'
  | 'verified';

/**
 * One facet's state. `held: false` with `by: null` is the explicit
 * "Exawatt cannot claim this" value — it is never an inference that the facet
 * is false in the world, only that no evidence for it exists locally.
 */
export interface AssuranceFacet {
  held: boolean;
  /** Named claimant when held; null when the facet is unavailable. */
  by: string | null;
  /** Why the facet is unavailable, when that is worth surfacing. */
  note?: string;
}

/** All five facets, always present. Absence is a value, not a missing key. */
export type ConsumptionAssurance = Record<AssuranceFacetName, AssuranceFacet>;

/**
 * What a source can and cannot tell Exawatt about consumption.
 *
 * This exists so an absent capability reads as ABSENT rather than as zero
 * (ENG-003 source-capability honesty, restated as a boundary on ENG-023).
 * Codex records no delegation; Claude Code records no plan window. Neither is
 * "0" — a surface must be able to distinguish "this source cannot say" from
 * "this source says none".
 */
export interface ConsumptionSourceCapabilities {
  /** Provider plan / rate-limit windows. */
  planWindows: boolean;
  /** Delegated (subagent) runs recorded as separate consumption. */
  delegation: boolean;
  /** Reasoning tokens broken out of output tokens. */
  reasoningTokens: boolean;
  /** Git branch recorded alongside usage. */
  gitBranch: boolean;
  /** Provider-side web search / fetch counts. */
  webToolUse: boolean;
  /** Reasoning-effort setting recorded alongside usage. */
  effort: boolean;
}

export const SOURCE_CAPABILITIES: Readonly<
  Record<ConsumptionSourceId, ConsumptionSourceCapabilities>
> = Object.freeze({
  'claude-code': {
    planWindows: false,
    delegation: true,
    reasoningTokens: false,
    gitBranch: true,
    webToolUse: true,
    effort: true,
  },
  codex: {
    planWindows: true,
    delegation: false,
    reasoningTokens: true,
    gitBranch: false,
    webToolUse: false,
    effort: true,
  },
});

/**
 * Attribution for a sample produced by a DELEGATED run rather than by the
 * operator's own session turn.
 *
 * Claude Code writes each delegated run to
 * `~/.claude/projects/<slug>/<sessionId>/subagents/agent-<agentId>.jsonl`, with
 * a spawn-time `agent-<agentId>.meta.json` beside it. The transcript lines
 * carry the PARENT `sessionId`, so `ConsumptionSample.providerSessionId` already
 * points at the delegating Session and rollups include delegated spend without
 * any reshaping. This record is what makes the delegated portion separable.
 *
 * Codex has no on-disk equivalent; `SOURCE_CAPABILITIES.codex.delegation` is
 * false and `delegation` is always null for Codex samples.
 */
export interface ConsumptionDelegation {
  /** Harness-assigned id of the delegated run. Present on every delegated record. */
  agentId: string;
  /** The delegating Session. Equal to `ConsumptionSample.providerSessionId`. */
  parentSessionId: string;
  /**
   * Agent type, e.g. `Explore`, `general-purpose`, `workflow-subagent`, `fork`.
   * Read from the transcript's `attributionAgent`, falling back to the spawn
   * metadata. null when neither recorded one.
   */
  agentType: string | null;
  /**
   * Depth below the operator's session. Only the spawn metadata records this,
   * and only for some runs, so null is common and must NOT be read as 1.
   */
  spawnDepth: number | null;
  /** Skill the delegated run was attributed to, when recorded. */
  skill: string | null;
  /** A background run, per the harness's own `sessionKind`. */
  background: boolean;
  /** Parent delegated run, for nested delegation. null at the first level. */
  parentAgentId: string | null;
}

/**
 * Coarse summary for surfaces that need one word. Derived, never stored as the
 * source of truth — `assuranceLevel()` computes it from the facet record.
 */
export type AssuranceLevel = 'reported' | 'observed' | 'verified';

/** One measured unit of consumption, as written by a harness. */
export interface ConsumptionSample {
  /** ISO 8601 instant the harness recorded for this unit of work. */
  at: string;
  source: ConsumptionSourceId;
  /** null when the source does not record a model for this record. */
  model: string | null;
  /** Reasoning-effort setting when the source records one. */
  effort: string | null;
  /** The harness's own session identifier. */
  providerSessionId: string;
  /** Launch directory. null when the source does not record one. */
  cwd: string | null;
  gitBranch: string | null;
  usage: RawUsage;
  assurance: ConsumptionAssurance;
  /**
   * Stable, content-derived key. Two records with the same key describe the
   * same unit of work and MUST NOT both be counted. See `mergeSamples`.
   */
  idempotencyKey: string;
  /** Model context window when the source reports one. */
  contextWindow: number | null;
  /** Source file this sample came from, for evidence links. Never displayed raw. */
  sourceFile: string | null;
  /**
   * Set when this sample came from a DELEGATED run; null when the operator's own
   * Session turn produced it. Never null-as-unknown: for a source whose
   * `SOURCE_CAPABILITIES.delegation` is false, null means the source cannot say,
   * which is a different fact from "no delegation happened".
   */
  delegation: ConsumptionDelegation | null;
}

/**
 * Capacity truth as the harness observed it. This is the only honest answer to
 * "how much of my plan have I used" — it is Codex-native and has no Claude Code
 * equivalent on disk (see `docs/engineering/projects/consumption-spine.md`).
 */
export interface PlanWindow {
  source: ConsumptionSourceId;
  /** Provider's identifier for the limit bucket, e.g. `codex`. */
  limitId: string | null;
  limitName: string | null;
  /** Which of the provider's two reported windows this is. */
  scope: 'primary' | 'secondary';
  /** 0-100 as reported. Not clamped — an out-of-range value is a real signal. */
  usedPercent: number;
  windowMinutes: number;
  /** ISO 8601. null when the provider did not report a reset instant. */
  resetsAt: string | null;
  planType: string | null;
  /** ISO 8601 instant Exawatt observed this window state. */
  observedAt: string;
  providerSessionId: string;
}

export type ConsumptionScopeKind =
  | 'workspace'
  | 'project'
  | 'session'
  | 'roadmapItem'
  | 'day'
  | 'model'
  | 'source';

export interface ConsumptionScope {
  kind: ConsumptionScopeKind;
  id: string;
  label: string;
}

export interface ConsumptionWindow {
  /** ISO 8601, inclusive. */
  from: string;
  /** ISO 8601, inclusive. */
  to: string;
}

export interface ConsumptionRollup {
  scope: ConsumptionScope;
  window: ConsumptionWindow;
  totals: RawUsage;
  /**
   * Model-size-normalized compute proxy. See `./model-weights` for the basis.
   * This is NOT money and must never be labelled as money.
   */
  weightedTokens: number;
  /**
   * Share of `weightedTokens` computed with the fallback weight because the
   * model was unknown to the table. Surfaces should degrade the claim when this
   * is material rather than presenting a confident number.
   */
  weightedTokensFromFallback: number;
  /** Models encountered that had no explicit weight entry. */
  modelsWithoutWeight: string[];
  sessionCount: number;
  samples: number;
  sources: ConsumptionSourceId[];
  assurance: ConsumptionAssurance;
  /**
   * The DELEGATED portion of `totals` / `weightedTokens`. `totals` is always the
   * inclusive figure, so "Session including delegated" is `totals` and
   * "Session's own" is `totals - delegated.totals` (see `ownTotals`). Splitting
   * this way keeps the sample stream flat: no reshaping is needed for either
   * view.
   */
  delegated: {
    samples: number;
    totals: RawUsage;
    weightedTokens: number;
    /** Distinct delegated runs. */
    agents: number;
    /** Distinct agent types encountered. */
    agentTypes: string[];
  };
  /**
   * Sources in this rollup that cannot report delegation at all. A surface must
   * not present `delegated` as complete when this is non-empty.
   */
  delegationBlindSources: ConsumptionSourceId[];
}

/**
 * Everything the scan could not use, counted. The parsers never throw and never
 * silently drop: any line that does not become a sample lands in exactly one of
 * these counters.
 */
export interface ConsumptionDiagnostics {
  filesSeen: number;
  filesUnreadable: number;
  bytesRead: number;
  linesRead: number;
  /** Lines that were not valid JSON. */
  linesUnparsable: number;
  /** A final line with no trailing newline — a crash mid-write. Not an error. */
  truncatedFinalLines: number;
  /** Valid JSON that carries no usage record (user turns, tool results, meta). */
  linesWithoutUsage: number;
  /** Usage records with no resolvable provider session id. */
  recordsWithoutSessionId: number;
  /** Usage records with no cwd — these cannot be attributed to a Project. */
  recordsWithoutCwd: number;
  /** Usage records with no model — these fall back to the default weight. */
  recordsWithoutModel: number;
  /** Records collapsed into an existing sample by idempotency key. */
  duplicatesMerged: number;
  samplesEmitted: number;
  planWindowsEmitted: number;
  /** Usage records produced by a delegated run rather than the parent turn. */
  delegatedRecords: number;
  /** Delegated files whose spawn metadata was unavailable or unreadable. */
  delegationMetaMissing: number;
}

export function emptyDiagnostics(): ConsumptionDiagnostics {
  return {
    filesSeen: 0,
    filesUnreadable: 0,
    bytesRead: 0,
    linesRead: 0,
    linesUnparsable: 0,
    truncatedFinalLines: 0,
    linesWithoutUsage: 0,
    recordsWithoutSessionId: 0,
    recordsWithoutCwd: 0,
    recordsWithoutModel: 0,
    duplicatesMerged: 0,
    samplesEmitted: 0,
    planWindowsEmitted: 0,
    delegatedRecords: 0,
    delegationMetaMissing: 0,
  };
}

export function addDiagnostics(
  left: ConsumptionDiagnostics,
  right: ConsumptionDiagnostics
): ConsumptionDiagnostics {
  const out = {} as ConsumptionDiagnostics;
  for (const key of Object.keys(left) as Array<keyof ConsumptionDiagnostics>) {
    out[key] = left[key] + right[key];
  }
  return out;
}

export interface ConsumptionScanResult {
  samples: ConsumptionSample[];
  planWindows: PlanWindow[];
  diagnostics: ConsumptionDiagnostics;
}

export function emptyScanResult(): ConsumptionScanResult {
  return { samples: [], planWindows: [], diagnostics: emptyDiagnostics() };
}
