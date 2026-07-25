/**
 * Model-size-normalized token weights — the compute proxy behind
 * `ConsumptionRollup.weightedTokens`.
 *
 * ## Why not dollars
 *
 * `docs/product/concepts.md` says Consumption must preserve raw usage before
 * converting to money, and must not treat public per-token price as the only
 * source of truth. The operator is on subscription plans (Claude Max, Codex
 * Pro): per-token list price is not what is actually paid, so a dollar figure
 * derived from it would be a confident lie. Weighted tokens are deliberately
 * dimensionless.
 *
 * ## The basis, stated so it can be argued with
 *
 * One unit = one FRESH INPUT TOKEN on a mid-tier workhorse model. Everything
 * else is a ratio against that unit. Three ratios do the work, and each is
 * anchored on a serving-economics observable rather than a price list:
 *
 * 1. **Tier ladder (0.2 / 1.0 / 5.0).** Providers ship models in three broad
 *    serving classes — small/fast, workhorse, frontier — and the step between
 *    adjacent classes is roughly 5x in every published relative-cost signal
 *    across every vendor. A coarse geometric ladder is honest about being
 *    coarse; a two-decimal per-model number would not be.
 * 2. **Decode multiplier (5x output vs input).** Prefill is batched and
 *    compute-bound; decode is serial and memory-bandwidth-bound, roughly one
 *    forward pass per token. The prefill:decode throughput gap on the same
 *    weights is about an order of magnitude, and every major vendor's relative
 *    input/output ratio lands near 5x regardless of tier. We anchor on that
 *    cross-vendor convergence, not on any one vendor's dollar figure.
 * 3. **Cache ratios (0.1x read, 1.25x write).** A prefix-cache read skips
 *    prefill entirely and costs little more than moving KV state; a cache write
 *    pays prefill plus persistence. Again the RATIO is stable across vendors
 *    and tiers, which is what makes it usable as a compute proxy.
 *
 * ## Editing this table
 *
 * Add a row to `MODEL_WEIGHTS` keyed by the longest distinctive prefix of the
 * provider's model id. `resolveModelWeight` matches by longest prefix, so
 * `claude-opus-4` and `claude-opus-4-8` can coexist. Every row must carry a
 * `basis` string explaining why it sits where it does. When a model is unknown,
 * `FALLBACK_WEIGHT` applies and the rollup counts the affected weighted tokens
 * in `weightedTokensFromFallback` so a surface can weaken its claim instead of
 * quietly presenting a made-up number.
 */
import type { RawUsage } from './types';

export type ModelTier = 'small' | 'workhorse' | 'frontier' | 'unknown';

export interface ModelWeight {
  tier: ModelTier;
  /** Weight of one fresh input token. 1.0 = one workhorse input token. */
  input: number;
  /** Weight of one generated token, inclusive of reasoning tokens. */
  output: number;
  /** Weight of one cache-read prompt token. */
  cacheRead: number;
  /** Weight of one cache-write prompt token. */
  cacheWrite: number;
  /** Why this row sits where it does. Required. */
  basis: string;
}

/** Tier ladder. Change these three numbers to re-scale the whole table. */
export const TIER_INPUT_WEIGHT: Record<Exclude<ModelTier, 'unknown'>, number> = {
  small: 0.2,
  workhorse: 1,
  frontier: 5,
};

/** Ratio constants. See the header for the basis of each. */
export const DECODE_MULTIPLIER = 5;
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

function tierWeight(
  tier: Exclude<ModelTier, 'unknown'>,
  basis: string
): ModelWeight {
  const input = TIER_INPUT_WEIGHT[tier];
  return {
    tier,
    input,
    output: input * DECODE_MULTIPLIER,
    cacheRead: input * CACHE_READ_MULTIPLIER,
    cacheWrite: input * CACHE_WRITE_MULTIPLIER,
    basis,
  };
}

/**
 * Keyed by longest distinctive model-id prefix. Only families actually observed
 * in local harness logs are listed; anything else falls back and is counted.
 */
export const MODEL_WEIGHTS: Readonly<Record<string, ModelWeight>> = Object.freeze(
  {
    // Anthropic, as written by Claude Code into ~/.claude/projects/**.jsonl
    'claude-haiku': tierWeight(
      'small',
      'Small/fast tier: the vendor positions it as the cheapest, highest-throughput option in the line.'
    ),
    'claude-sonnet': tierWeight(
      'workhorse',
      'The reference workhorse. This row defines the 1.0 unit for the whole table.'
    ),
    'claude-opus': tierWeight(
      'frontier',
      'Frontier tier: the vendor positions it one serving class above Sonnet.'
    ),
    'claude-fable': tierWeight(
      'frontier',
      'Frontier tier: shipped as a peer of the Opus line in local transcripts.'
    ),

    // OpenAI, as written by Codex into ~/.codex/sessions/**/rollout-*.jsonl
    'gpt-5-mini': tierWeight('small', 'Small/fast tier of the GPT-5 line.'),
    'gpt-5-nano': tierWeight('small', 'Smallest tier of the GPT-5 line.'),
    'gpt-5': tierWeight(
      'workhorse',
      'Workhorse tier. Held equal to the Sonnet-class unit so cross-vendor rollups are comparable.'
    ),
  }
);

/**
 * Applied when a model id matches no row. Deliberately the workhorse weight:
 * an unknown model is more likely mid-tier than frontier, and over-weighting
 * unknowns would inflate every rollup that touched one. Rollups report the
 * share of weighted tokens that came from here.
 */
export const FALLBACK_WEIGHT: ModelWeight = {
  ...tierWeight('workhorse', 'Fallback for an unrecognized model id.'),
  tier: 'unknown',
};

export interface ResolvedModelWeight {
  weight: ModelWeight;
  /** false when `FALLBACK_WEIGHT` was applied. */
  explicit: boolean;
}

/** Longest-prefix match against `MODEL_WEIGHTS`. Null model ids fall back. */
export function resolveModelWeight(model: string | null): ResolvedModelWeight {
  if (!model) return { weight: FALLBACK_WEIGHT, explicit: false };
  const id = model.toLowerCase();
  let bestKey: string | null = null;
  for (const key of Object.keys(MODEL_WEIGHTS)) {
    if (id.startsWith(key) && (bestKey === null || key.length > bestKey.length)) {
      bestKey = key;
    }
  }
  if (!bestKey) return { weight: FALLBACK_WEIGHT, explicit: false };
  return { weight: MODEL_WEIGHTS[bestKey], explicit: true };
}

/**
 * Weighted tokens for one usage record under one model's weights.
 *
 * `reasoningTokens` is a subset of `outputTokens` and is intentionally NOT
 * added again — doing so would double-count every Codex turn.
 */
export function weightUsage(usage: RawUsage, weight: ModelWeight): number {
  return (
    usage.inputTokens * weight.input +
    usage.outputTokens * weight.output +
    usage.cacheReadTokens * weight.cacheRead +
    usage.cacheWriteTokens * weight.cacheWrite
  );
}
