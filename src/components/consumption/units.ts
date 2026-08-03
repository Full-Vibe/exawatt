/**
 * The unit ladder (ENG-008 E4) — the expository spine of the Consumption
 * surface.
 *
 * Four rungs, and the ladder's whole job is to make the reader see WHERE
 * MEASUREMENT STOPS AND MODELLING BEGINS:
 *
 *   1. tokens             MEASURED  — read from the harness's own local logs
 *   2. normalized compute MODELLED  — core's model-size weight basis
 *   3. dollars            MODELLED  — explicitly not billing truth
 *   4. watts              MODELLED  — an estimate, and the product's name
 *
 * Every coefficient below is a stated, arguable ratio, not a fact. Each carries
 * its own basis string, and the surface prints the basis beside the figure
 * rather than hiding it in a tooltip. `docs/product/concepts.md` requires that
 * Consumption preserve raw usage before converting it to money; this module is
 * the only place a conversion happens, and it never mutates a raw total.
 */
import {
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  DECODE_MULTIPLIER,
  TIER_INPUT_WEIGHT,
} from '@exawatt/core';

export type LadderRung = 'tokens' | 'normalized' | 'dollars' | 'watts';

/** Where a rung's number comes from. Rendered in place, on every rung. */
export type Epistemics = 'measured' | 'modelled';

export interface RungBasis {
  key: LadderRung;
  label: string;
  /** Short role label for the rung — a noun phrase, not a question. */
  question: string;
  epistemics: Epistemics;
  /** One sentence, printed beside the figure. Must be arguable, not reassuring. */
  basis: string;
  /** The honest caveat. Printed, never hidden. */
  caveat: string;
}

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

export const DOLLAR_BASIS_SENTENCE =
  'Modelled from published list prices for each model tier (frontier $15/$75, ' +
  'workhorse $3/$15, small $0.80/$4 per million in/out; cache reads ×0.1, cache ' +
  'writes ×1.25).';

/**
 * Watt-hours per normalized token.
 *
 * Anchored on the only public figures that exist: vendor per-prompt energy
 * disclosures in the region of a quarter of a watt-hour for a typical text
 * response, divided by the normalized size of such a response. That makes this
 * an ORDER-OF-MAGNITUDE coefficient, and it is the softest number on the whole
 * surface. It is stated so it can be argued with and replaced.
 */
export const WATT_HOURS_PER_NORMALIZED_KTOK = 0.3;

export const WATT_BASIS_SENTENCE =
  `Modelled at ${WATT_HOURS_PER_NORMALIZED_KTOK} Wh per 1,000 normalized tokens — ` +
  'public per-response energy disclosures divided by a typical response size. ' +
  'Serving hardware, batching, and datacentre efficiency each move this by more ' +
  'than a factor of two, so treat it as an order of magnitude.';

export const LADDER: RungBasis[] = [
  {
    key: 'tokens',
    label: 'tokens',
    question: 'The stored unit.',
    epistemics: 'measured',
    basis:
      'Read verbatim from the usage records Claude Code and Codex write to local disk. Summed, never estimated.',
    caveat:
      'Complete only for what the harnesses keep: both prune old sessions.',
  },
  {
    key: 'normalized',
    label: 'normalized compute',
    question: 'Cross-model comparison.',
    epistemics: 'modelled',
    basis: NORMALIZED_BASIS_SENTENCE,
    caveat:
      'A stated ratio table — a compute proxy, not a physical measurement.',
  },
  {
    key: 'dollars',
    label: 'dollars',
    question: 'List-price equivalent.',
    epistemics: 'modelled',
    basis: DOLLAR_BASIS_SENTENCE,
    caveat:
      'Not billing truth: subscription plans do not pay per token, and list prices change independently of this table.',
  },
  {
    key: 'watts',
    label: 'watts',
    question: 'Energy equivalent.',
    epistemics: 'modelled',
    basis: WATT_BASIS_SENTENCE,
    caveat: 'An order-of-magnitude estimate.',
  },
];

/** Modelled dollars for a weighted-token figure, at the stated list basis. */
export function modelledDollars(weightedTokens: number): number {
  // Weighted tokens are already expressed in workhorse-input-equivalents, so
  // one conversion rate applies to the whole figure. This is deliberately one
  // multiplication with one stated rate rather than a per-model reconstruction
  // that would imply more precision than the basis supports.
  return (weightedTokens / 1_000_000) * LIST_PRICE_PER_MTOK.workhorse.input;
}

/** Modelled watt-hours for a weighted-token figure, at the stated basis. */
export function modelledWattHours(weightedTokens: number): number {
  return (weightedTokens / 1000) * WATT_HOURS_PER_NORMALIZED_KTOK;
}

/** "412 Wh" / "3.1 kWh". Energy is read at a glance, never digit by digit. */
export function formatEnergy(wattHours: number): string {
  if (wattHours >= 1000) {
    return `${(wattHours / 1000).toFixed(wattHours >= 10_000 ? 0 : 1)} kWh`;
  }
  if (wattHours >= 10) return `${Math.round(wattHours)} Wh`;
  return `${wattHours.toFixed(1)} Wh`;
}

/**
 * A physical comparison for an energy figure, so a demo audience has somewhere
 * to stand. Deliberately household-scale and deliberately approximate.
 *
 * NOT a per-token multiple: an anchor that is a fixed multiple of the dollar
 * basis renders the same digits as the dollar figure and reads as a copy bug.
 * These anchors are non-linear on purpose.
 */
export function energyComparison(wattHours: number): string {
  const homeDays = wattHours / 29_000; // ~29 kWh/day, average detached home
  if (homeDays >= 0.75) {
    return `about ${homeDays.toFixed(1)} days of an average home`;
  }
  const evKm = wattHours / 180; // ~180 Wh/km for an electric car
  if (evKm >= 25) {
    return `about ${Math.round(evKm / 5) * 5} km in an electric car`;
  }
  const laptopHours = wattHours / 30; // ~30 W laptop under load
  return `about ${laptopHours.toFixed(1)} hours of a laptop`;
}
