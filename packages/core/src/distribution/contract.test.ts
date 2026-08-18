import { describe, expect, it } from 'vitest';
import {
  AGENT_SOURCE_CONNECT_SOURCES,
  COMMUNITY_DISTRIBUTION,
  COMMUNITY_IDENTITY,
  distributionConnectSources,
  parseDistributionContract,
  resolveDistributionIdentity,
  serializeDistributionContract,
} from './contract';

const OFFICIAL = {
  schemaVersion: 2,
  brand: {
    appId: 'ai.exawatt.desktop',
    productName: 'Exawatt',
    protocolScheme: 'exawatt',
    iconPath: 'electron/resources/icon.icns',
    updateChannel: 'stable',
  },
  account: {
    supabaseUrl: 'https://project.supabase.co',
    supabaseAnonKey: 'public-anon-key',
    recoveryOrigin: 'https://www.exawatt.ai',
  },
  services: {
    productFeedback: {
      url: 'https://www.exawatt.ai/api/feedback',
      protocolVersion: 1,
    },
    operatorStats: {
      url: 'https://www.exawatt.ai/api/operator-stats',
      protocolVersion: 1,
    },
    projects: {
      url: 'https://www.exawatt.ai/api/projects',
      protocolVersion: 1,
    },
    preferences: {
      url: 'https://www.exawatt.ai/api/preferences',
      protocolVersion: 1,
    },
    accountData: null,
  },
  enrichment: {
    contextLabels: {
      url: 'https://www.exawatt.ai/api/context-labels',
      protocolVersion: 1,
    },
    conversationSummaries: {
      url: 'https://www.exawatt.ai/api/conversations/summarize',
      protocolVersion: 1,
    },
    goalVisuals: {
      url: 'https://www.exawatt.ai/api/goal-visuals',
      protocolVersion: 1,
    },
  },
  analytics: {
    ingestOrigin: 'https://www.exawatt.ai/ingest',
    projectKey: 'public-project-key',
  },
  updates: {
    feedUrl: 'https://updates.exawatt.ai/macos/arm64',
  },
  ownAccount: {
    claudePlanUsage: 'stable-signed',
  },
} as const;

/** The same distribution as a schema-1 document: every stored copy of the
 *  official contract is one of these until its operator-custody owner
 *  rewrites it, so this shape has to keep parsing (BUG-060). */
const OFFICIAL_V1 = (() => {
  const { ownAccount: _dropped, ...rest } = OFFICIAL;
  return { ...rest, schemaVersion: 1 } as const;
})();

/** V1's exact key set claiming to be V2. Exact-key strictness is per version,
 *  so this is as invalid as a V1 document carrying `ownAccount`. */
const OFFICIAL_V1_KEYS_AT_V2 = { ...OFFICIAL_V1, schemaVersion: 2 } as const;

describe('distribution contract', () => {
  it('defaults to a deeply immutable service-neutral community contract', () => {
    expect(COMMUNITY_DISTRIBUTION).toEqual({
      schemaVersion: 2,
      brand: null,
      account: null,
      services: {
        productFeedback: null,
        operatorStats: null,
        projects: null,
        preferences: null,
        accountData: null,
      },
      enrichment: {
        contextLabels: null,
        conversationSummaries: null,
        goalVisuals: null,
      },
      analytics: null,
      updates: null,
      ownAccount: null,
    });
    expect(Object.isFrozen(COMMUNITY_DISTRIBUTION)).toBe(true);
    expect(Object.isFrozen(COMMUNITY_DISTRIBUTION.services)).toBe(true);
    expect(Object.isFrozen(COMMUNITY_DISTRIBUTION.enrichment)).toBe(true);
  });

  it('resolves the stable community identity without a protocol or updater', () => {
    expect(resolveDistributionIdentity(COMMUNITY_DISTRIBUTION)).toEqual(
      COMMUNITY_IDENTITY
    );
    expect(COMMUNITY_IDENTITY).toMatchObject({
      productName: 'Exawatt Community',
      appId: 'ai.exawatt.community',
      protocolScheme: null,
      updateChannel: null,
      stateNamespace: 'ai.exawatt.community',
      cacheNamespace: 'ai.exawatt.community',
    });
  });

  it('upgrades a schema-1 document fail-safe instead of rejecting it', () => {
    // The stored copies of the official contract (Vercel Production and
    // Preview, the release workflow's repository secret, operator custody)
    // are all schema 1 and are rewritten by their owner, not by this commit.
    // Rejecting them here is how incident `0017` happened; loosening V2's
    // strictness to swallow them is how a half-configured official build
    // happens. Upgrading in memory is neither.
    const upgraded = parseDistributionContract(OFFICIAL_V1);
    expect(upgraded.schemaVersion).toBe(2);
    // The direction matters: a contract written before the declaration
    // existed does NOT acquire the capability it never declared.
    expect(upgraded.ownAccount).toBeNull();
    expect(upgraded.brand).toEqual(OFFICIAL.brand);
    expect(upgraded.services).toEqual(OFFICIAL.services);
    // And a community document from the same era resolves to exactly the
    // community contract this build ships.
    const { ownAccount: _dropped, ...communityV1 } = COMMUNITY_DISTRIBUTION;
    expect(
      parseDistributionContract({ ...communityV1, schemaVersion: 1 })
    ).toEqual(COMMUNITY_DISTRIBUTION);
  });

  it('validates and canonically serializes an official overlay', () => {
    const parsed = parseDistributionContract(OFFICIAL);
    expect(parsed).toEqual(OFFICIAL);
    expect(resolveDistributionIdentity(parsed)).toMatchObject({
      productName: 'Exawatt',
      appId: 'ai.exawatt.desktop',
      protocolScheme: 'exawatt',
      updateChannel: 'stable',
      stateNamespace: 'ai.exawatt.desktop',
      cacheNamespace: 'ai.exawatt.desktop',
    });
    expect(parsed.ownAccount).toEqual({ claudePlanUsage: 'stable-signed' });
    expect(serializeDistributionContract(parsed)).toBe(
      serializeDistributionContract(JSON.parse(JSON.stringify(OFFICIAL)))
    );
    // A V2 document survives a full serialize/parse cycle unchanged, so the
    // cross-process digest agreement holds on the declaration too.
    expect(
      parseDistributionContract(
        JSON.parse(serializeDistributionContract(parsed))
      )
    ).toEqual(parsed);
  });

  it.each([
    ['unknown root field', { ...OFFICIAL, surprise: true }],
    [
      'unknown nested field',
      { ...OFFICIAL, analytics: { ...OFFICIAL.analytics, secret: 'nope' } },
    ],
    ['unsupported future version', { ...OFFICIAL, schemaVersion: 3 }],
    ['unsupported version zero', { ...OFFICIAL, schemaVersion: 0 }],
    ['schema-2 document missing ownAccount', OFFICIAL_V1_KEYS_AT_V2],
    [
      'schema-1 document carrying ownAccount',
      { ...OFFICIAL, schemaVersion: 1 },
    ],
    [
      'own-account declaration that is not stable-signed',
      { ...OFFICIAL, ownAccount: { claudePlanUsage: 'ad-hoc' } },
    ],
    [
      'own-account declaration with an unknown field',
      {
        ...OFFICIAL,
        ownAccount: { claudePlanUsage: 'stable-signed', teamId: '5G5A77XLHZ' },
      },
    ],
    [
      'own-account declaration that is not an object',
      { ...OFFICIAL, ownAccount: true },
    ],
    [
      'unsafe product filename',
      {
        ...OFFICIAL,
        brand: { ...OFFICIAL.brand, productName: '../Exawatt' },
      },
    ],
    [
      'partial account',
      { ...OFFICIAL, account: { supabaseUrl: 'https://x.test' } },
    ],
    [
      'unsafe remote endpoint',
      {
        ...OFFICIAL,
        services: {
          ...OFFICIAL.services,
          productFeedback: {
            url: 'http://api.example.com/feedback',
            protocolVersion: 1,
          },
        },
      },
    ],
    [
      'credential-bearing URL',
      {
        ...OFFICIAL,
        services: {
          ...OFFICIAL.services,
          productFeedback: {
            url: 'https://user:pass@example.com/feedback',
            protocolVersion: 1,
          },
        },
      },
    ],
    [
      'unsupported endpoint protocol',
      {
        ...OFFICIAL,
        services: {
          ...OFFICIAL.services,
          productFeedback: {
            url: 'https://www.exawatt.ai/api/feedback',
            protocolVersion: 2,
          },
        },
      },
    ],
    ['authenticated endpoint without account', { ...OFFICIAL, account: null }],
    [
      'reserved account-data endpoint',
      {
        ...OFFICIAL,
        services: {
          ...OFFICIAL.services,
          accountData: {
            url: 'https://www.exawatt.ai/api/account',
            protocolVersion: 1,
          },
        },
      },
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseDistributionContract(value)).toThrow();
  });

  it.each([
    ['services', 'productFeedback'],
    ['services', 'operatorStats'],
    ['services', 'projects'],
    ['services', 'preferences'],
    ['enrichment', 'contextLabels'],
    ['enrichment', 'conversationSummaries'],
    ['enrichment', 'goalVisuals'],
  ] as const)('requires account transport for %s.%s', (family, capability) => {
    const candidate = JSON.parse(
      JSON.stringify(COMMUNITY_DISTRIBUTION)
    ) as Record<string, unknown>;
    const values = candidate[family] as Record<string, unknown>;
    values[capability] = {
      url: `https://services.example.test/${capability}`,
      protocolVersion: 1,
    };
    expect(() => parseDistributionContract(candidate)).toThrow(
      /account is required/
    );
  });

  it('allows loopback HTTP for a downstream local service', () => {
    const parsed = parseDistributionContract({
      ...OFFICIAL,
      services: {
        ...OFFICIAL.services,
        projects: {
          url: 'http://127.0.0.1:8787/v1/projects',
          protocolVersion: 1,
        },
      },
    });
    expect(parsed.services.projects).toEqual({
      url: 'http://127.0.0.1:8787/v1/projects',
      protocolVersion: 1,
    });
  });

  it('keeps arbitrary user-configured OpenClaw ws separate from services', () => {
    expect(AGENT_SOURCE_CONNECT_SOURCES).toEqual(['ws:']);
    expect(distributionConnectSources(COMMUNITY_DISTRIBUTION)).toEqual([
      "'self'",
      'ws:',
    ]);
    const officialSources = distributionConnectSources(
      parseDistributionContract(OFFICIAL)
    );
    expect(officialSources).toContain('ws:');
    expect(officialSources).toContain('https://www.exawatt.ai');
    expect(officialSources).toContain('https://project.supabase.co');
    expect(officialSources).toContain('wss://project.supabase.co');
    expect(officialSources).not.toContain('https:');
    expect(officialSources).not.toContain('wss:');
  });
});
