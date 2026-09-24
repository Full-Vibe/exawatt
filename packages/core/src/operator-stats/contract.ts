/**
 * The hosted Operator-profile publication contract, defined once.
 *
 * Every consumer reads its limits from here: the local derivation that
 * produces Runs, the planner that cuts publications, the strict validator the
 * hosted route runs, the service client that decodes the response, and — by
 * parity test — the JSON Schema in `contracts/services/v1` and the CHECK
 * constraints in the Supabase migration. BUG-164 was a producer with no bound
 * (a Run was a whole provider Session, and one Session resumed across seven
 * weeks) feeding a validator with a 31-day bound; the payload that crossed it
 * was rejected whole, every six hours, for nine days, and nothing said so.
 * A limit that lives in one place cannot drift between the side that makes a
 * value and the side that refuses it.
 */

const DAY_MS = 86_400_000;

/**
 * Wire schema of one publication body. Version 2 (BUG-164) declares the local
 * dates it covers and replaces only those; version 1 replaced the operator's
 * whole public history on every sync and is no longer accepted.
 */
export const OPERATOR_STATS_SCHEMA_VERSION = 2 as const;
export const OPERATOR_STATS_CONSENT_VERSION = 1 as const;

/**
 * Version of the local Run derivation. A client whose published cursor names
 * an older derivation republishes everything it still holds since consent, so
 * a change to what a Run IS reaches the hosted history instead of only the
 * days after the upgrade. 1 = one Run per provider Session; 2 = Runs split on
 * idle gaps and capped at `MAX_PUBLIC_RUN_MS` (BUG-164).
 */
export const OPERATOR_STATS_DERIVATION_VERSION = 2 as const;

/** Longest span a single public Run may cover. */
export const MAX_PUBLIC_RUN_MS = 31 * DAY_MS;

/**
 * Calendar days one publication may cover. A sync with a longer backlog sends
 * several publications; the bound is per request, never per history.
 */
export const MAX_PUBLICATION_DAYS = 31;

/**
 * Run receipts one publication may carry. Day aggregates always carry the
 * true Run count; this bounds only how many shareable receipts ride along.
 */
export const MAX_PUBLICATION_RUNS = 500;

/** Runs one local day may count. Generous on purpose: fleets grow. */
export const MAX_DAY_RUN_COUNT = 100_000;
export const MAX_FLEET = 10_000;
export const MAX_TOKEN_VALUE = 1_000_000_000_000;
export const MAX_INTERVENTIONS = 100_000;
export const MAX_AGENT_MS = MAX_PUBLIC_RUN_MS * MAX_FLEET;

/**
 * A derived Run ends after this long with no activity from any of its
 * members. An hour is longer than an Agent's ordinary pauses and shorter than
 * an operator walking away; the rule is `derived` evidence, never a claim of
 * an exact turn boundary.
 */
export const RUN_IDLE_SPLIT_MS = 60 * 60_000;

/**
 * A routine sync republishes this many days behind its last published date,
 * so a Run still live at the previous sync, or samples a later pass read out
 * of order, reach the hosted day they belong to.
 */
export const PUBLICATION_TRAILING_DAYS = 7;
