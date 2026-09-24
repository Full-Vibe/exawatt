import { isCalendarDate } from './calendar';
import type { OperatorStatsCoverage } from './types';

/**
 * Why a sync stopped, by the layer that stopped it. One vocabulary for the
 * renderer that performs the sync, the Electron settings store that
 * remembers the last one, the diagnostics log, and the owner's status line.
 */
export const OPERATOR_STATS_SYNC_FAILURES = [
  /** The local Consumption view could not be read. */
  'local-scan',
  /** Publication state could not be read or written locally. */
  'local-state',
  /** The planner produced something the contract refuses: a defect, loud. */
  'local-contract',
  'network',
  'unauthorized',
  'identity',
  /** The service refused the request as invalid. Retrying cannot help. */
  'rejected',
  'service',
] as const;

export type OperatorStatsSyncFailure =
  (typeof OPERATOR_STATS_SYNC_FAILURES)[number];

/** Failures that repeat identically until the software changes. A status
 *  line must say publishing stopped, never that it will retry (BUG-164). */
export function isTerminalSyncFailure(
  failure: OperatorStatsSyncFailure | null
): boolean {
  return failure === 'rejected' || failure === 'local-contract';
}

/** The durable record of the last failed sync; cleared by the next success. */
export interface OperatorStatsSyncFailureRecord {
  at: string;
  failure: OperatorStatsSyncFailure;
  /** Whether trying again unchanged can succeed. */
  retryable: boolean;
  /** The service's problem code, when the service answered. */
  code: string | null;
}

/** What one sync step tells the local publication record. */
export type OperatorStatsSyncEvent =
  | {
      kind: 'published';
      at: string;
      coverage: OperatorStatsCoverage;
      /** Present on the plan's last publication: the hosted history now
       *  reflects this derivation from consent onward. */
      derivation?: number;
    }
  | ({
      kind: 'failed';
      status: number | null;
      /** Field-level reason from the local planner or the service. Logged,
       *  never stored in settings and never rendered. */
      detail: string | null;
    } & OperatorStatsSyncFailureRecord);

const CODE = /^[a-z0-9_]{1,64}$/;

function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function parseOperatorStatsSyncFailureRecord(
  value: unknown
): OperatorStatsSyncFailureRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const at = instant(raw.at);
  if (
    !at ||
    !OPERATOR_STATS_SYNC_FAILURES.includes(
      raw.failure as OperatorStatsSyncFailure
    ) ||
    typeof raw.retryable !== 'boolean' ||
    !(
      raw.code === null ||
      (typeof raw.code === 'string' && CODE.test(raw.code))
    )
  ) {
    return null;
  }
  return {
    at,
    failure: raw.failure as OperatorStatsSyncFailure,
    retryable: raw.retryable,
    code: raw.code,
  };
}

/** Validates an event crossing the renderer→main boundary. */
export function parseOperatorStatsSyncEvent(
  value: unknown
): OperatorStatsSyncEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.kind === 'published') {
    const at = instant(raw.at);
    const coverage = raw.coverage as Record<string, unknown> | null;
    if (
      !at ||
      !coverage ||
      typeof coverage !== 'object' ||
      !isCalendarDate(coverage.from) ||
      !isCalendarDate(coverage.through) ||
      coverage.from > coverage.through ||
      (raw.derivation !== undefined &&
        !(Number.isInteger(raw.derivation) && Number(raw.derivation) > 0))
    ) {
      return null;
    }
    return {
      kind: 'published',
      at,
      coverage: { from: coverage.from, through: coverage.through },
      ...(raw.derivation === undefined
        ? {}
        : { derivation: Number(raw.derivation) }),
    };
  }
  if (raw.kind === 'failed') {
    const record = parseOperatorStatsSyncFailureRecord(raw);
    const status = raw.status;
    const detail = raw.detail;
    if (
      !record ||
      !(
        status === null ||
        (Number.isInteger(status) &&
          Number(status) >= 100 &&
          Number(status) <= 599)
      ) ||
      !(detail === null || (typeof detail === 'string' && detail.length <= 300))
    ) {
      return null;
    }
    return {
      kind: 'failed',
      ...record,
      status: status as number | null,
      detail: detail as string | null,
    };
  }
  return null;
}
