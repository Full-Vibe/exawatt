/**
 * Consumption unit conversions (ENG-008 E4).
 *
 * The Consumption surface's job is to make the reader see WHERE MEASUREMENT
 * STOPS AND MODELLING BEGINS: tokens are MEASURED (read from the harness's own
 * local logs), and everything derived from them — normalized compute, dollars,
 * plan credits — is MODELLED. Every coefficient below is a stated, arguable
 * ratio, not a fact, and each carries its own basis string that the surface
 * prints beside the figure rather than hiding in a tooltip.
 *
 * `docs/product/concepts.md` requires that Consumption preserve raw usage
 * before converting it to money; this module is the only place a conversion
 * happens, and it never mutates a raw total.
 */
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  DECODE_MULTIPLIER,
  TIER_INPUT_WEIGHT,
} from '@exawatt/core';

/**
 * Stated from core's own constants rather than retyped, so the sentence cannot
 * drift away from the arithmetic that produced the number beside it.
 */
export const NORMALIZED_BASIS_SENTENCE =
  `One unit = one fresh input token on a workhorse-class model. ` +
  `Generated tokens count ${DECODE_MULTIPLIER}×, cache reads ${CACHE_READ_MULTIPLIER}×, ` +
  `cache writes ${CACHE_WRITE_MULTIPLIER}×, and the model tier scales the whole record ` +
  `(small ${TIER_INPUT_WEIGHT.small}× · workhorse ${TIER_INPUT_WEIGHT.workhorse}× · frontier ${TIER_INPUT_WEIGHT.frontier}×).`;

/**
 * Public list price per million tokens, used ONLY to model a dollar figure that
 * is labelled a model. The operator is on subscription plans, so the per-token
 * price is not what is actually paid; provider pricing also moves independently
 * of this table.
 */
export const LIST_PRICE_PER_MTOK: Record<
  'frontier' | 'workhorse' | 'small',
  { input: number; output: number }
> = {
  frontier: { input: 15, output: 75 },
  workhorse: { input: 3, output: 15 },
  small: { input: 0.8, output: 4 },
};

/** Modelled dollars for a weighted-token figure, at the stated list basis. */
export function modelledDollars(weightedTokens: number): number {
  // Weighted tokens are already expressed in workhorse-input-equivalents, so
  // one conversion rate applies to the whole figure. This is deliberately one
  // multiplication with one stated rate rather than a per-model reconstruction
  // that would imply more precision than the basis supports.
  return (weightedTokens / 1_000_000) * LIST_PRICE_PER_MTOK.workhorse.input;
}

/**
 * A vendor's own plan-credit figure, in its own currency (ENG-038).
 *
 * MEASURED, not modelled — the vendor reported it — which is exactly why it
 * may never be added to `modelledDollars`: plan credits, overage, and metered
 * API keys are disjoint ledgers, and one total across them would be a number
 * the operator is not charged. Formatting stays exact to the minor unit
 * because this figure IS money, unlike the rounded modelled estimate.
 */
export function planCredits(amountMinor: number, spend: {
  currency: string;
  exponent: number;
}): string {
  const value = amountMinor / 10 ** spend.exponent;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: spend.currency,
      minimumFractionDigits: spend.exponent,
      maximumFractionDigits: spend.exponent,
    }).format(value);
  } catch {
    // An unrecognized currency code must still render its number honestly.
    return `${value.toFixed(spend.exponent)} ${spend.currency}`;
  }
}
