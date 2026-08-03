import { MAX_PUBLIC_RUN_MS } from './derive';
import {
  OPERATOR_STATS_CONSENT_VERSION,
  OPERATOR_STATS_SCHEMA_VERSION,
  type OperatorStatsPublishPayload,
} from './types';

const MAX_DAYS = 400;
const MAX_RUNS = 500;
const MAX_TOKEN_VALUE = 1_000_000_000_000;
const MAX_FLEET = 10_000;
const HANDLE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_ID = /^[a-zA-Z0-9_-]{12,80}$/;
const HASH = /^[a-f0-9]{64}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
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
    throw new Error(`${label} contains unknown or missing fields`);
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
    throw new Error(`${label} is out of bounds`);
  }
  return value;
}

function boundedInteger(value: unknown, label: string, max: number): number {
  const parsed = boundedNumber(value, label, max);
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`);
  return parsed;
}

function shortString(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function stringArray(value: unknown, label: string, maxItems = 8): string[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} is invalid`);
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
    throw new Error(`${label} contains an unsupported value`);
  }
  return parsed as T[];
}

const SOURCES = ['claude-code', 'codex'] as const;
const ASSURANCE = ['reported', 'observed', 'derived', 'unavailable'] as const;

/** Strict allowlist validator. Unknown fields fail closed at every level. */
export function parseOperatorStatsPublishPayload(
  input: unknown
): OperatorStatsPublishPayload {
  const root = record(input, 'payload');
  exactKeys(
    root,
    [
      'schemaVersion',
      'consentVersion',
      'enabled',
      'timezone',
      'identity',
      'days',
      'runs',
    ],
    'payload'
  );
  if (root.schemaVersion !== OPERATOR_STATS_SCHEMA_VERSION)
    throw new Error('Unsupported schemaVersion');
  if (root.consentVersion !== OPERATOR_STATS_CONSENT_VERSION)
    throw new Error('Unsupported consentVersion');
  if (root.enabled !== true) throw new Error('enabled must be true');
  const timezone = shortString(root.timezone, 'timezone', 80);
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();

  const identity = record(root.identity, 'identity');
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
  const providerHandle = shortString(
    identity.providerHandle,
    'identity.providerHandle',
    80
  );
  if (!HANDLE.test(handle)) throw new Error('identity.handle is invalid');
  const avatarUrl =
    identity.avatarUrl === null
      ? null
      : shortString(identity.avatarUrl, 'identity.avatarUrl', 500);
  if (avatarUrl !== null && !avatarUrl.startsWith('https://'))
    throw new Error('identity.avatarUrl must use https');
  const links = stringArray(identity.links, 'identity.links', 4);
  if (links.some(link => !link.startsWith('https://')))
    throw new Error('identity.links must use https');

  if (!Array.isArray(root.days) || root.days.length > MAX_DAYS)
    throw new Error('days is invalid');
  const days = root.days.map((inputDay, index) => {
    const day = record(inputDay, `days[${index}]`);
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
      `days[${index}]`
    );
    const localDate = shortString(
      day.localDate,
      `days[${index}].localDate`,
      10
    );
    if (!DATE.test(localDate))
      throw new Error(`days[${index}].localDate is invalid`);
    return {
      localDate,
      agentMs: boundedNumber(
        day.agentMs,
        `days[${index}].agentMs`,
        MAX_PUBLIC_RUN_MS * MAX_FLEET
      ),
      runCount: boundedInteger(
        day.runCount,
        `days[${index}].runCount`,
        MAX_RUNS
      ),
      peakFleet: boundedInteger(
        day.peakFleet,
        `days[${index}].peakFleet`,
        MAX_FLEET
      ),
      longestHandsOffMs: boundedNumber(
        day.longestHandsOffMs,
        `days[${index}].longestHandsOffMs`,
        MAX_PUBLIC_RUN_MS
      ),
      rawTokens: boundedNumber(
        day.rawTokens,
        `days[${index}].rawTokens`,
        MAX_TOKEN_VALUE
      ),
      normalizedTokens: boundedNumber(
        day.normalizedTokens,
        `days[${index}].normalizedTokens`,
        MAX_TOKEN_VALUE
      ),
      sources: enumArray(day.sources, `days[${index}].sources`, SOURCES),
      assurance: enumArray(
        day.assurance,
        `days[${index}].assurance`,
        ASSURANCE
      ),
    };
  });

  if (!Array.isArray(root.runs) || root.runs.length > MAX_RUNS)
    throw new Error('runs is invalid');
  const runs = root.runs.map((inputRun, index) => {
    const run = record(inputRun, `runs[${index}]`);
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
      `runs[${index}]`
    );
    const publicId = shortString(run.publicId, `runs[${index}].publicId`, 80);
    const idempotencyKey = shortString(
      run.idempotencyKey,
      `runs[${index}].idempotencyKey`,
      64
    );
    const localDate = shortString(
      run.localDate,
      `runs[${index}].localDate`,
      10
    );
    if (
      !PUBLIC_ID.test(publicId) ||
      !HASH.test(idempotencyKey) ||
      !DATE.test(localDate)
    )
      throw new Error(`runs[${index}] identifier is invalid`);
    const outcome = shortString(run.outcome, `runs[${index}].outcome`, 16);
    if (!['settled', 'stopped', 'faulted', 'unknown'].includes(outcome))
      throw new Error(`runs[${index}].outcome is invalid`);
    return {
      publicId,
      localDate,
      idempotencyKey,
      elapsedMs: boundedNumber(
        run.elapsedMs,
        `runs[${index}].elapsedMs`,
        MAX_PUBLIC_RUN_MS
      ),
      activeMs: boundedNumber(
        run.activeMs,
        `runs[${index}].activeMs`,
        MAX_PUBLIC_RUN_MS
      ),
      longestHandsOffMs: boundedNumber(
        run.longestHandsOffMs,
        `runs[${index}].longestHandsOffMs`,
        MAX_PUBLIC_RUN_MS
      ),
      interventionCount:
        run.interventionCount === null
          ? null
          : boundedInteger(
              run.interventionCount,
              `runs[${index}].interventionCount`,
              100_000
            ),
      peakActiveMembers: boundedInteger(
        run.peakActiveMembers,
        `runs[${index}].peakActiveMembers`,
        MAX_FLEET
      ),
      agentMs: boundedNumber(
        run.agentMs,
        `runs[${index}].agentMs`,
        MAX_PUBLIC_RUN_MS * MAX_FLEET
      ),
      rawTokens: boundedNumber(
        run.rawTokens,
        `runs[${index}].rawTokens`,
        MAX_TOKEN_VALUE
      ),
      normalizedTokens: boundedNumber(
        run.normalizedTokens,
        `runs[${index}].normalizedTokens`,
        MAX_TOKEN_VALUE
      ),
      sources: enumArray(run.sources, `runs[${index}].sources`, SOURCES),
      assurance: enumArray(
        run.assurance,
        `runs[${index}].assurance`,
        ASSURANCE
      ),
      outcome:
        outcome as OperatorStatsPublishPayload['runs'][number]['outcome'],
    };
  });

  return {
    schemaVersion: OPERATOR_STATS_SCHEMA_VERSION,
    consentVersion: OPERATOR_STATS_CONSENT_VERSION,
    enabled: true,
    timezone,
    identity: {
      provider: shortString(identity.provider, 'identity.provider', 40),
      providerHandle,
      handle,
      displayName: shortString(
        identity.displayName,
        'identity.displayName',
        100
      ),
      avatarUrl,
      links,
    },
    days,
    runs,
  };
}
