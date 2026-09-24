import { calendarDaysBetween, isCalendarDate } from './calendar';
import {
  MAX_AGENT_MS,
  MAX_DAY_RUN_COUNT,
  MAX_FLEET,
  MAX_INTERVENTIONS,
  MAX_PUBLICATION_DAYS,
  MAX_PUBLICATION_RUNS,
  MAX_PUBLIC_RUN_MS,
  MAX_TOKEN_VALUE,
  OPERATOR_STATS_CONSENT_VERSION,
  OPERATOR_STATS_SCHEMA_VERSION,
} from './contract';
import type {
  OperatorDayAggregate,
  OperatorStatsCoverage,
  OperatorStatsPublication,
  OperatorStatsPublishPayload,
  PublicOperatorIdentity,
  PublicRunUpload,
} from './types';

const HANDLE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const PUBLIC_ID = /^[a-zA-Z0-9_-]{12,80}$/;
const HASH = /^[a-f0-9]{64}$/;

/**
 * A value that does not fit the publication contract. The message names the
 * exact field, is safe to log and to return to the client (it never carries a
 * value), and is what the hosted route answers as `detail`.
 */
export class OperatorStatsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorStatsContractError';
  }
}

function fail(message: string): never {
  throw new OperatorStatsContractError(message);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, i) => key !== actual[i])
  ) {
    fail(`${label} contains unknown or missing fields`);
  }
}

function boundedNumber(
  value: unknown,
  label: string,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  ) {
    fail(`${label} is out of bounds`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, max: number): number {
  const parsed = boundedNumber(value, label, max);
  if (!Number.isInteger(parsed)) fail(`${label} must be an integer`);
  return parsed;
}

function shortString(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    fail(`${label} is invalid`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maxItems = 8): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(`${label} is invalid`);
  }
  return value.map((item, index) =>
    shortString(item, `${label}[${index}]`, 80)
  );
}

function enumArray<T extends string>(
  value: unknown,
  label: string,
  allowed: readonly T[]
): T[] {
  const parsed = stringArray(value, label);
  if (parsed.some(item => !allowed.includes(item as T))) {
    fail(`${label} contains an unsupported value`);
  }
  return parsed as T[];
}

function calendarDate(value: unknown, label: string): string {
  if (!isCalendarDate(value)) fail(`${label} is invalid`);
  return value;
}

const SOURCES = ['claude-code', 'codex'] as const;
const ASSURANCE = ['reported', 'observed', 'derived', 'unavailable'] as const;
const OUTCOMES = ['settled', 'stopped', 'faulted', 'unknown'] as const;

/** One day aggregate, validated on its own so a planner can quarantine it. */
export function parseOperatorDayAggregate(
  input: unknown,
  label = 'day'
): OperatorDayAggregate {
  const day = record(input, label);
  exactKeys(
    day,
    [
      'localDate',
      'agentMs',
      'runCount',
      'peakFleet',
      'longestHandsOffMs',
      'rawTokens',
      'normalizedTokens',
      'sources',
      'assurance',
    ],
    label
  );
  return {
    localDate: calendarDate(day.localDate, `${label}.localDate`),
    agentMs: boundedNumber(day.agentMs, `${label}.agentMs`, MAX_AGENT_MS),
    runCount: boundedInteger(
      day.runCount,
      `${label}.runCount`,
      MAX_DAY_RUN_COUNT
    ),
    peakFleet: boundedInteger(day.peakFleet, `${label}.peakFleet`, MAX_FLEET),
    longestHandsOffMs: boundedNumber(
      day.longestHandsOffMs,
      `${label}.longestHandsOffMs`,
      MAX_PUBLIC_RUN_MS
    ),
    rawTokens: boundedNumber(
      day.rawTokens,
      `${label}.rawTokens`,
      MAX_TOKEN_VALUE
    ),
    normalizedTokens: boundedNumber(
      day.normalizedTokens,
      `${label}.normalizedTokens`,
      MAX_TOKEN_VALUE
    ),
    sources: enumArray(day.sources, `${label}.sources`, SOURCES),
    assurance: enumArray(day.assurance, `${label}.assurance`, ASSURANCE),
  };
}

/** One Run receipt, validated on its own so a planner can quarantine it. */
export function parsePublicRunUpload(
  input: unknown,
  label = 'run'
): PublicRunUpload {
  const run = record(input, label);
  exactKeys(
    run,
    [
      'publicId',
      'localDate',
      'idempotencyKey',
      'elapsedMs',
      'activeMs',
      'longestHandsOffMs',
      'interventionCount',
      'peakActiveMembers',
      'agentMs',
      'rawTokens',
      'normalizedTokens',
      'sources',
      'assurance',
      'outcome',
    ],
    label
  );
  const publicId = shortString(run.publicId, `${label}.publicId`, 80);
  const idempotencyKey = shortString(
    run.idempotencyKey,
    `${label}.idempotencyKey`,
    64
  );
  if (!PUBLIC_ID.test(publicId) || !HASH.test(idempotencyKey)) {
    fail(`${label} identifier is invalid`);
  }
  const outcome = shortString(run.outcome, `${label}.outcome`, 16);
  if (!OUTCOMES.includes(outcome as (typeof OUTCOMES)[number])) {
    fail(`${label}.outcome is invalid`);
  }
  return {
    publicId,
    localDate: calendarDate(run.localDate, `${label}.localDate`),
    idempotencyKey,
    elapsedMs: boundedNumber(
      run.elapsedMs,
      `${label}.elapsedMs`,
      MAX_PUBLIC_RUN_MS
    ),
    activeMs: boundedNumber(
      run.activeMs,
      `${label}.activeMs`,
      MAX_PUBLIC_RUN_MS
    ),
    longestHandsOffMs: boundedNumber(
      run.longestHandsOffMs,
      `${label}.longestHandsOffMs`,
      MAX_PUBLIC_RUN_MS
    ),
    interventionCount:
      run.interventionCount === null
        ? null
        : boundedInteger(
            run.interventionCount,
            `${label}.interventionCount`,
            MAX_INTERVENTIONS
          ),
    peakActiveMembers: boundedInteger(
      run.peakActiveMembers,
      `${label}.peakActiveMembers`,
      MAX_FLEET
    ),
    agentMs: boundedNumber(run.agentMs, `${label}.agentMs`, MAX_AGENT_MS),
    rawTokens: boundedNumber(
      run.rawTokens,
      `${label}.rawTokens`,
      MAX_TOKEN_VALUE
    ),
    normalizedTokens: boundedNumber(
      run.normalizedTokens,
      `${label}.normalizedTokens`,
      MAX_TOKEN_VALUE
    ),
    sources: enumArray(run.sources, `${label}.sources`, SOURCES),
    assurance: enumArray(run.assurance, `${label}.assurance`, ASSURANCE),
    outcome: outcome as PublicRunUpload['outcome'],
  };
}

function parseCoverage(input: unknown): OperatorStatsCoverage {
  const coverage = record(input, 'coverage');
  exactKeys(coverage, ['from', 'through'], 'coverage');
  const from = calendarDate(coverage.from, 'coverage.from');
  const through = calendarDate(coverage.through, 'coverage.through');
  const span = calendarDaysBetween(from, through) + 1;
  if (span < 1) fail('coverage.through precedes coverage.from');
  if (span > MAX_PUBLICATION_DAYS) fail('coverage spans too many days');
  return { from, through };
}

function parseIdentity(input: unknown): PublicOperatorIdentity {
  const identity = record(input, 'identity');
  exactKeys(
    identity,
    [
      'provider',
      'providerHandle',
      'handle',
      'displayName',
      'avatarUrl',
      'links',
    ],
    'identity'
  );
  const handle = shortString(identity.handle, 'identity.handle', 39);
  if (!HANDLE.test(handle)) fail('identity.handle is invalid');
  const avatarUrl =
    identity.avatarUrl === null
      ? null
      : shortString(identity.avatarUrl, 'identity.avatarUrl', 500);
  if (avatarUrl !== null && !avatarUrl.startsWith('https://'))
    fail('identity.avatarUrl must use https');
  const links = stringArray(identity.links, 'identity.links', 4);
  if (links.some(link => !link.startsWith('https://')))
    fail('identity.links must use https');
  return {
    provider: shortString(identity.provider, 'identity.provider', 40),
    providerHandle: shortString(
      identity.providerHandle,
      'identity.providerHandle',
      80
    ),
    handle,
    displayName: shortString(identity.displayName, 'identity.displayName', 100),
    avatarUrl,
    links,
  };
}

const PUBLICATION_KEYS = [
  'schemaVersion',
  'consentVersion',
  'enabled',
  'timezone',
  'coverage',
  'days',
  'runs',
] as const;

function parsePublicationFields(
  root: Record<string, unknown>
): OperatorStatsPublication {
  if (root.schemaVersion !== OPERATOR_STATS_SCHEMA_VERSION)
    fail('Unsupported schemaVersion');
  if (root.consentVersion !== OPERATOR_STATS_CONSENT_VERSION)
    fail('Unsupported consentVersion');
  if (root.enabled !== true) fail('enabled must be true');
  const timezone = shortString(root.timezone, 'timezone', 80);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  } catch {
    fail('timezone is invalid');
  }
  const coverage = parseCoverage(root.coverage);
  const inCoverage = (date: string) =>
    date >= coverage.from && date <= coverage.through;

  if (
    !Array.isArray(root.days) ||
    root.days.length > calendarDaysBetween(coverage.from, coverage.through) + 1
  )
    fail('days is invalid');
  const seenDates = new Set<string>();
  const days = root.days.map((input, index) => {
    const day = parseOperatorDayAggregate(input, `days[${index}]`);
    if (!inCoverage(day.localDate)) fail(`days[${index}] is outside coverage`);
    if (seenDates.has(day.localDate)) fail(`days[${index}] repeats a date`);
    seenDates.add(day.localDate);
    return day;
  });

  if (!Array.isArray(root.runs) || root.runs.length > MAX_PUBLICATION_RUNS)
    fail('runs is invalid');
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const runs = root.runs.map((input, index) => {
    const run = parsePublicRunUpload(input, `runs[${index}]`);
    if (!inCoverage(run.localDate)) fail(`runs[${index}] is outside coverage`);
    if (seenIds.has(run.publicId) || seenKeys.has(run.idempotencyKey))
      fail(`runs[${index}] repeats an identifier`);
    seenIds.add(run.publicId);
    seenKeys.add(run.idempotencyKey);
    return run;
  });

  return {
    schemaVersion: OPERATOR_STATS_SCHEMA_VERSION,
    consentVersion: OPERATOR_STATS_CONSENT_VERSION,
    enabled: true,
    timezone,
    coverage,
    days,
    runs,
  };
}

/** A local publication before the account identity is attached. The planner
 *  runs every publication it emits through this, as a tripwire. */
export function parseOperatorStatsPublication(
  input: unknown
): OperatorStatsPublication {
  const root = record(input, 'publication');
  exactKeys(root, PUBLICATION_KEYS, 'publication');
  return parsePublicationFields(root);
}

/** Strict allowlist validator. Unknown fields fail closed at every level. */
export function parseOperatorStatsPublishPayload(
  input: unknown
): OperatorStatsPublishPayload {
  const root = record(input, 'payload');
  exactKeys(root, [...PUBLICATION_KEYS, 'identity'], 'payload');
  const publication = parsePublicationFields(root);
  return { ...publication, identity: parseIdentity(root.identity) };
}
