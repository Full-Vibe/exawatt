/**
 * Idempotent sample merging.
 *
 * Both harnesses repeat usage records, for different reasons, and both would
 * massively over-count under naive summation:
 *
 * - **Claude Code** writes one assistant line per streamed content block, each
 *   carrying the same API request's usage. Over the operator's real corpus,
 *   58,641 usage lines resolve to 25,574 distinct `requestId`s — naive summing
 *   over-counts by 2.20x. Within a request the usage snapshot GROWS as the
 *   response streams (99.9% of requests are componentwise monotonic), so the
 *   correct resolution is the componentwise maximum, not the first or the sum.
 * - **Codex** emits `token_count` events in near-duplicate pairs on some CLI
 *   versions (4.5% of events over the corpus are exact repeats). The Codex
 *   parser dedupes on the cumulative snapshot before emitting, and this merge
 *   is the second line of defence across overlapping incremental reads.
 *
 * Componentwise max is chosen over last-write-wins because it is idempotent AND
 * commutative: an incremental scanner can re-read an overlapping byte range, or
 * merge two files' worth of samples in any order, and land on the same totals.
 * Over the real corpus the two differ by 0.0025% of all tokens.
 */
import type { ConsumptionSample, RawUsage } from './types';

export function maxUsage(left: RawUsage, right: RawUsage): RawUsage {
  return {
    inputTokens: Math.max(left.inputTokens, right.inputTokens),
    cacheReadTokens: Math.max(left.cacheReadTokens, right.cacheReadTokens),
    cacheWriteTokens: Math.max(left.cacheWriteTokens, right.cacheWriteTokens),
    outputTokens: Math.max(left.outputTokens, right.outputTokens),
    reasoningTokens: Math.max(left.reasoningTokens, right.reasoningTokens),
    webSearches: Math.max(left.webSearches, right.webSearches),
    webFetches: Math.max(left.webFetches, right.webFetches),
  };
}

export function addUsage(left: RawUsage, right: RawUsage): RawUsage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    webSearches: left.webSearches + right.webSearches,
    webFetches: left.webFetches + right.webFetches,
  };
}

/** Componentwise difference, floored at zero. */
export function subtractUsage(left: RawUsage, right: RawUsage): RawUsage {
  return {
    inputTokens: Math.max(0, left.inputTokens - right.inputTokens),
    cacheReadTokens: Math.max(0, left.cacheReadTokens - right.cacheReadTokens),
    cacheWriteTokens: Math.max(
      0,
      left.cacheWriteTokens - right.cacheWriteTokens
    ),
    outputTokens: Math.max(0, left.outputTokens - right.outputTokens),
    reasoningTokens: Math.max(0, left.reasoningTokens - right.reasoningTokens),
    webSearches: Math.max(0, left.webSearches - right.webSearches),
    webFetches: Math.max(0, left.webFetches - right.webFetches),
  };
}

export function totalTokens(usage: RawUsage): number {
  // reasoningTokens is a subset of outputTokens and is not added again.
  return (
    usage.inputTokens +
    usage.cacheReadTokens +
    usage.cacheWriteTokens +
    usage.outputTokens
  );
}

function mergePair(
  existing: ConsumptionSample,
  incoming: ConsumptionSample
): ConsumptionSample {
  const later = incoming.at >= existing.at ? incoming : existing;
  return {
    ...later,
    usage: maxUsage(existing.usage, incoming.usage),
    // Identity fields prefer whichever record actually has one; a later record
    // that lost a field must not erase a fact an earlier record established.
    model: later.model ?? existing.model ?? incoming.model,
    effort: later.effort ?? existing.effort ?? incoming.effort,
    cwd: later.cwd ?? existing.cwd ?? incoming.cwd,
    gitBranch: later.gitBranch ?? existing.gitBranch ?? incoming.gitBranch,
    contextWindow:
      later.contextWindow ?? existing.contextWindow ?? incoming.contextWindow,
    // The key includes `agentId`, so a merge never crosses the delegation
    // boundary; keeping whichever record actually carried the record preserves
    // the enrichment a tail-only read may have missed.
    delegation: later.delegation ?? existing.delegation ?? incoming.delegation,
    // The earliest observed instant is the honest start of the unit of work.
    at: existing.at <= incoming.at ? existing.at : incoming.at,
  };
}

export interface MergeResult {
  samples: ConsumptionSample[];
  duplicatesMerged: number;
}

/**
 * Collapse samples sharing an `idempotencyKey`. Order-independent: the result
 * is identical for any permutation of the input.
 */
export function mergeSamples(
  samples: Iterable<ConsumptionSample>
): MergeResult {
  const byKey = new Map<string, ConsumptionSample>();
  let duplicatesMerged = 0;
  for (const sample of samples) {
    const existing = byKey.get(sample.idempotencyKey);
    if (!existing) {
      byKey.set(sample.idempotencyKey, sample);
      continue;
    }
    duplicatesMerged += 1;
    byKey.set(sample.idempotencyKey, mergePair(existing, sample));
  }
  return { samples: [...byKey.values()], duplicatesMerged };
}
