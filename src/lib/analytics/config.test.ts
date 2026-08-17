import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import { resolveDistributionAnalyticsDecision } from './config';

const OFFICIAL = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  analytics: {
    ingestOrigin: 'https://www.exawatt.ai/ingest',
    projectKey: 'official-public-key',
  },
});

const CUSTOM = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  analytics: {
    ingestOrigin: 'https://telemetry.example.test/posthog/',
    projectKey: 'custom-public-key',
  },
});

describe('distribution analytics decision', () => {
  it('keeps community analytics off before considering runtime state', () => {
    for (const nodeEnv of ['production', 'development', 'test', undefined]) {
      expect(
        resolveDistributionAnalyticsDecision(
          COMMUNITY_DISTRIBUTION,
          { optedOut: false },
          nodeEnv
        )
      ).toEqual({ enabled: false, reason: 'no_distribution_config' });
    }
  });

  it('enables the exact official contract in production', () => {
    expect(
      resolveDistributionAnalyticsDecision(
        OFFICIAL,
        { optedOut: false },
        'production'
      )
    ).toEqual({
      enabled: true,
      key: 'official-public-key',
      apiHost: 'https://www.exawatt.ai/ingest',
    });
  });

  it('uses a downstream sink without an Exawatt fallback', () => {
    expect(
      resolveDistributionAnalyticsDecision(
        CUSTOM,
        { optedOut: false },
        'production'
      )
    ).toEqual({
      enabled: true,
      key: 'custom-public-key',
      apiHost: 'https://telemetry.example.test/posthog',
    });
  });

  it('never initializes a configured sink outside production', () => {
    for (const nodeEnv of ['development', 'test', undefined]) {
      expect(
        resolveDistributionAnalyticsDecision(
          OFFICIAL,
          { optedOut: false },
          nodeEnv
        )
      ).toEqual({ enabled: false, reason: 'not_production' });
    }
  });

  it('honors the persisted runtime opt-out for every distributor', () => {
    for (const distribution of [OFFICIAL, CUSTOM]) {
      expect(
        resolveDistributionAnalyticsDecision(
          distribution,
          { optedOut: true },
          'production'
        )
      ).toEqual({ enabled: false, reason: 'opted_out' });
    }
  });
});
