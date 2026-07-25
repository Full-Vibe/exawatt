import type {
  AssuranceLevel,
  ConsumptionAssurance,
  ConsumptionSourceId,
} from './types';

const UNAVAILABLE = (note: string) => ({ held: false, by: null, note });

/**
 * Assurance for a sample produced by reading a harness's own local log.
 *
 * What is honestly claimable, and nothing more:
 *
 * - **reported** — yes. The harness wrote the number; it is the harness's
 *   claim about its own usage.
 * - **observed** — yes, by Exawatt, but observed means "Exawatt read the file
 *   the harness wrote", not "Exawatt watched the tokens leave". It is a second
 *   fact only because Exawatt can attest that this byte range existed on disk
 *   at a given time; it is not independent measurement of the provider.
 * - **authorized** — unavailable. No local record ties a unit of usage to a
 *   person's or Policy's approval.
 * - **enforced** — unavailable. Nothing local proves a ceiling was applied.
 *   Codex `PlanWindow` records are the closest thing and are modelled
 *   separately; they are reported capacity, not proof of enforcement.
 * - **verified** — unavailable. Verification would require a provider receipt
 *   or invoice. Public per-token prices are not receipts.
 */
export function localLogAssurance(
  source: ConsumptionSourceId
): ConsumptionAssurance {
  return {
    reported: { held: true, by: source },
    observed: {
      held: true,
      by: 'exawatt:local-log-read',
      note: 'Exawatt read the harness log; it did not independently meter the provider.',
    },
    authorized: UNAVAILABLE('No local record links usage to a person or Policy.'),
    enforced: UNAVAILABLE('No local record proves a ceiling was applied.'),
    verified: UNAVAILABLE('No provider receipt or invoice is available locally.'),
  };
}

/**
 * Assurance for a Codex `rate_limits` record. Capacity is still only *reported*
 * by the provider through the harness, but it is the provider's own accounting
 * of a limit it does enforce, so `enforced` is held by the provider — Exawatt
 * still cannot claim to enforce anything.
 */
export function planWindowAssurance(
  source: ConsumptionSourceId
): ConsumptionAssurance {
  return {
    reported: { held: true, by: source },
    observed: { held: true, by: 'exawatt:local-log-read' },
    authorized: UNAVAILABLE('Plan entitlement is not recorded locally.'),
    enforced: {
      held: true,
      by: `${source}:provider`,
      note: 'The provider reports its own limit state; Exawatt enforces nothing.',
    },
    verified: UNAVAILABLE('No provider receipt or invoice is available locally.'),
  };
}

/** The weakest facet set across a group, so a rollup never over-claims. */
export function intersectAssurance(
  values: readonly ConsumptionAssurance[]
): ConsumptionAssurance {
  if (values.length === 0) return localLogAssurance('claude-code');
  const [first, ...rest] = values;
  const out: ConsumptionAssurance = {
    reported: { ...first.reported },
    observed: { ...first.observed },
    authorized: { ...first.authorized },
    enforced: { ...first.enforced },
    verified: { ...first.verified },
  };
  for (const value of rest) {
    for (const key of Object.keys(out) as Array<keyof ConsumptionAssurance>) {
      const held = out[key].held && value[key].held;
      const by = out[key].by === value[key].by ? out[key].by : 'mixed';
      out[key] = held
        ? { held: true, by }
        : {
            held: false,
            by: null,
            note:
              out[key].note ?? value[key].note ?? 'Not held for every sample.',
          };
    }
  }
  return out;
}

/**
 * Coarse one-word summary for surfaces that cannot show five facets. Derived on
 * demand so the composable record stays the source of truth.
 */
export function assuranceLevel(value: ConsumptionAssurance): AssuranceLevel {
  if (value.verified.held) return 'verified';
  if (value.observed.held) return 'observed';
  return 'reported';
}
