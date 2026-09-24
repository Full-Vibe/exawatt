import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
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
} from '../operator-stats';

/**
 * BUG-164 was two definitions of one limit disagreeing: the side that made a
 * value had none, the side that refused it had 31 days. The public contract
 * (`contracts/services/v1`) is a third copy a distributor implements; it must
 * say what the validator enforces, derived from the same constants, so a
 * change to either fails here instead of in production.
 */

type Schema = {
  $defs: Record<string, { properties: Record<string, unknown> }>;
};

const schema = JSON.parse(
  readFileSync(
    new URL(
      '../../../../contracts/services/v1/schemas/operator-stats.schema.json',
      import.meta.url
    ),
    'utf8'
  )
) as Schema;

function property(def: string, name: string) {
  return schema.$defs[def].properties[name] as Record<string, unknown>;
}

function maximum(def: string, name: string): unknown {
  const value = property(def, name);
  if ('maximum' in value) return value.maximum;
  if ('maxItems' in value) return value.maxItems;
  const branches = (value.oneOf ?? []) as Array<Record<string, unknown>>;
  return branches.find(branch => 'maximum' in branch)?.maximum;
}

describe('operator-stats public contract parity', () => {
  it('declares the body versions the validator accepts', () => {
    expect(property('publishRequest', 'schemaVersion').const).toBe(
      OPERATOR_STATS_SCHEMA_VERSION
    );
    expect(property('publishRequest', 'consentVersion').const).toBe(
      OPERATOR_STATS_CONSENT_VERSION
    );
  });

  it('declares the bounds the validator enforces', () => {
    expect(maximum('publishRequest', 'days')).toBe(MAX_PUBLICATION_DAYS);
    expect(maximum('publishRequest', 'runs')).toBe(MAX_PUBLICATION_RUNS);
    expect(maximum('publishResponse', 'days')).toBe(MAX_PUBLICATION_DAYS);
    expect(maximum('publishResponse', 'runs')).toBe(MAX_PUBLICATION_RUNS);
    expect(maximum('day', 'runCount')).toBe(MAX_DAY_RUN_COUNT);
    expect(maximum('day', 'peakFleet')).toBe(MAX_FLEET);
    expect(maximum('day', 'agentMs')).toBe(MAX_AGENT_MS);
    expect(maximum('day', 'longestHandsOffMs')).toBe(MAX_PUBLIC_RUN_MS);
    expect(maximum('day', 'rawTokens')).toBe(MAX_TOKEN_VALUE);
    expect(maximum('day', 'normalizedTokens')).toBe(MAX_TOKEN_VALUE);
    for (const field of ['elapsedMs', 'activeMs', 'longestHandsOffMs']) {
      expect(maximum('run', field)).toBe(MAX_PUBLIC_RUN_MS);
    }
    expect(maximum('run', 'agentMs')).toBe(MAX_AGENT_MS);
    expect(maximum('run', 'peakActiveMembers')).toBe(MAX_FLEET);
    expect(maximum('run', 'interventionCount')).toBe(MAX_INTERVENTIONS);
    expect(maximum('run', 'rawTokens')).toBe(MAX_TOKEN_VALUE);
    expect(maximum('run', 'normalizedTokens')).toBe(MAX_TOKEN_VALUE);
  });
});
