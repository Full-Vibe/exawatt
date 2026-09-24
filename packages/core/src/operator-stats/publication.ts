import {
  addCalendarDays,
  calendarDaysBetween,
  earlierCalendarDate,
  isCalendarDate,
  laterCalendarDate,
} from './calendar';
import {
  MAX_PUBLICATION_DAYS,
  MAX_PUBLICATION_RUNS,
  OPERATOR_STATS_CONSENT_VERSION,
  OPERATOR_STATS_DERIVATION_VERSION,
  OPERATOR_STATS_SCHEMA_VERSION,
  PUBLICATION_TRAILING_DAYS,
} from './contract';
import { operatorLocalDate } from './derive';
import {
  OperatorStatsContractError,
  parseOperatorDayAggregate,
  parseOperatorStatsPublication,
  parsePublicRunUpload,
} from './payload';
import type {
  OperatorDayAggregate,
  OperatorStatsCoverage,
  OperatorStatsPublication,
  PublicRunUpload,
} from './types';

/** How far the hosted history is known to reflect this derivation. */
export interface OperatorStatsPublicationCursor {
  /** The last local date a successful publication covered. */
  publishedThrough: string;
  /** The Run derivation that history was published with. */
  derivation: number;
}

export interface OperatorStatsPublicationPlanInput {
  timezone: string;
  /** The immutable first-consent instant. Nothing before it is published. */
  since: string;
  /**
   * The instant from which the local sample view is complete. Retention may
   * have pruned what is older, and a publication that covered those dates
   * would replace real hosted history with the absence of local data — the
   * BUG-141 loss. Negative infinity means nothing was ever pruned.
   */
  completeSinceMs: number;
  cursor: OperatorStatsPublicationCursor | null;
  now: number;
  days: readonly OperatorDayAggregate[];
  runs: readonly PublicRunUpload[];
}

/** A row the contract refuses, left out rather than allowed to block the
 *  rest. A refused day also leaves its date uncovered, so hosted history for
 *  it stands instead of being replaced by nothing. */
export interface OperatorStatsExclusion {
  localDate: string;
  kind: 'day' | 'run';
  reason: string;
}

export interface OperatorStatsPublicationPlan {
  derivation: typeof OPERATOR_STATS_DERIVATION_VERSION;
  /** Every date this plan replaces, or null when nothing is publishable. */
  coverage: OperatorStatsCoverage | null;
  /** Chronological; each one fits the contract on its own. */
  publications: OperatorStatsPublication[];
  excluded: OperatorStatsExclusion[];
  /** Receipts beyond one publication's cap on a single day. Day aggregates
   *  still count those Runs; only their shareable receipts stay local. */
  receiptsOmitted: number;
  /** Everything derived since consent, for the owner's status line. */
  totals: { runs: number; agentMs: number; normalizedTokens: number };
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'invalid';
}

/**
 * Cuts the derived history into the publications a sync sends.
 *
 * Every limit the hosted contract enforces is satisfied here by construction
 * rather than discovered by a rejection: a publication covers at most
 * `MAX_PUBLICATION_DAYS` contiguous dates and `MAX_PUBLICATION_RUNS`
 * receipts, a row that fails its bounds is quarantined with its reason, and
 * the finished publications pass the same strict parser the service runs.
 * A routine sync covers the trailing week after its cursor; a missing cursor
 * or an older derivation covers everything since consent.
 */
export function planOperatorStatsPublication(
  input: OperatorStatsPublicationPlanInput
): OperatorStatsPublicationPlan {
  const sinceMs = Date.parse(input.since);
  if (!Number.isFinite(sinceMs)) throw new Error('Invalid publication start');
  const anchorDate = operatorLocalDate(sinceMs, input.timezone);
  const today = operatorLocalDate(input.now, input.timezone);

  const excluded: OperatorStatsExclusion[] = [];
  const excludedDates = new Set<string>();
  const days = new Map<string, OperatorDayAggregate>();
  input.days.forEach((candidate, index) => {
    try {
      const day = parseOperatorDayAggregate(candidate, `days[${index}]`);
      days.set(day.localDate, day);
    } catch (cause) {
      const localDate = isCalendarDate(candidate?.localDate)
        ? candidate.localDate
        : null;
      if (!localDate) throw cause;
      excluded.push({ localDate, kind: 'day', reason: reasonOf(cause) });
      excludedDates.add(localDate);
    }
  });
  const runsByDate = new Map<string, PublicRunUpload[]>();
  input.runs.forEach((candidate, index) => {
    try {
      const run = parsePublicRunUpload(candidate, `runs[${index}]`);
      const bucket = runsByDate.get(run.localDate);
      if (bucket) bucket.push(run);
      else runsByDate.set(run.localDate, [run]);
    } catch (cause) {
      const localDate = isCalendarDate(candidate?.localDate)
        ? candidate.localDate
        : null;
      if (!localDate) throw cause;
      excluded.push({ localDate, kind: 'run', reason: reasonOf(cause) });
    }
  });

  const totals = { runs: 0, agentMs: 0, normalizedTokens: 0 };
  for (const day of days.values()) {
    if (day.localDate < anchorDate) continue;
    totals.runs += day.runCount;
    totals.agentMs += day.agentMs;
    totals.normalizedTokens += day.normalizedTokens;
  }

  const completeDate =
    input.completeSinceMs <= sinceMs
      ? anchorDate
      : addCalendarDays(
          operatorLocalDate(input.completeSinceMs, input.timezone),
          1
        );
  const cursor =
    input.cursor &&
    input.cursor.derivation === OPERATOR_STATS_DERIVATION_VERSION &&
    isCalendarDate(input.cursor.publishedThrough)
      ? input.cursor
      : null;
  let from = cursor
    ? addCalendarDays(
        earlierCalendarDate(cursor.publishedThrough, today),
        -PUBLICATION_TRAILING_DAYS
      )
    : anchorDate;
  from = laterCalendarDate(laterCalendarDate(from, anchorDate), completeDate);
  let through = today;
  for (const date of [...days.keys(), ...runsByDate.keys()]) {
    through = laterCalendarDate(through, date);
  }

  const plan: OperatorStatsPublicationPlan = {
    derivation: OPERATOR_STATS_DERIVATION_VERSION,
    coverage: null,
    publications: [],
    // Only what this plan would have carried; older refusals were reported
    // by the sync that covered them.
    excluded: excluded.filter(
      exclusion => exclusion.localDate >= from && exclusion.localDate <= through
    ),
    receiptsOmitted: 0,
    totals,
  };
  if (from > through) return plan;
  plan.coverage = { from, through };

  let chunk: {
    from: string;
    through: string;
    days: OperatorDayAggregate[];
    runs: PublicRunUpload[];
  } | null = null;
  const close = () => {
    if (chunk) plan.publications.push(publicationOf(chunk, input.timezone));
    chunk = null;
  };

  const span = calendarDaysBetween(from, through);
  for (let offset = 0; offset <= span; offset += 1) {
    const date = addCalendarDays(from, offset);
    if (excludedDates.has(date)) {
      close();
      continue;
    }
    let dayRuns = runsByDate.get(date) ?? [];
    if (dayRuns.length > MAX_PUBLICATION_RUNS) {
      // The biggest Runs are the receipts worth sharing.
      dayRuns = [...dayRuns]
        .sort(
          (left, right) =>
            right.agentMs - left.agentMs ||
            left.publicId.localeCompare(right.publicId)
        )
        .slice(0, MAX_PUBLICATION_RUNS);
      plan.receiptsOmitted +=
        (runsByDate.get(date)?.length ?? 0) - MAX_PUBLICATION_RUNS;
    }
    const current: typeof chunk = chunk;
    if (
      current &&
      (calendarDaysBetween(current.from, date) + 1 > MAX_PUBLICATION_DAYS ||
        current.runs.length + dayRuns.length > MAX_PUBLICATION_RUNS)
    ) {
      close();
    }
    chunk ??= { from: date, through: date, days: [], runs: [] };
    chunk.through = date;
    const day = days.get(date);
    if (day) chunk.days.push(day);
    chunk.runs.push(...dayRuns);
  }
  close();
  return plan;
}

function publicationOf(
  chunk: {
    from: string;
    through: string;
    days: OperatorDayAggregate[];
    runs: PublicRunUpload[];
  },
  timezone: string
): OperatorStatsPublication {
  const publication: OperatorStatsPublication = {
    schemaVersion: OPERATOR_STATS_SCHEMA_VERSION,
    consentVersion: OPERATOR_STATS_CONSENT_VERSION,
    enabled: true,
    timezone,
    coverage: { from: chunk.from, through: chunk.through },
    days: chunk.days,
    runs: [...chunk.runs].sort(
      (left, right) =>
        left.localDate.localeCompare(right.localDate) ||
        left.publicId.localeCompare(right.publicId)
    ),
  };
  // Tripwire, not a filter: everything above already fits the contract. A
  // failure here is a planner defect and must be loud, never a partial send.
  try {
    return parseOperatorStatsPublication(publication);
  } catch (cause) {
    throw new OperatorStatsContractError(
      `planned publication ${chunk.from}..${chunk.through} violates the contract: ${reasonOf(cause)}`
    );
  }
}
