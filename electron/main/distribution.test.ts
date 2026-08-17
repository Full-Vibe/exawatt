import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  COMMUNITY_DISTRIBUTION,
  serializeDistributionContract,
} from '@exawatt/core/distribution';
import {
  assertDistributionAgreement,
  assertRendererCompositionAgreement,
  distributionChildEnvironment,
  distributionDataPathOverrides,
  distributionIpcCapabilities,
  resolveDistribution,
} from './distribution';

const canonical = serializeDistributionContract(COMMUNITY_DISTRIBUTION);
const digest = createHash('sha256').update(canonical).digest('hex');

describe('Electron distribution mirror', () => {
  it('accepts one canonical contract shared by main and renderer', () => {
    expect(
      assertDistributionAgreement({
        contractJson: canonical,
        contractDigest: digest,
        rendererDigest: digest,
        buildInfoDigest: digest,
      })
    ).toEqual(COMMUNITY_DISTRIBUTION);
  });

  it.each([
    ['contract digest', 'f'.repeat(64), digest, digest],
    ['renderer digest', digest, 'e'.repeat(64), digest],
    ['build-info digest', digest, digest, 'd'.repeat(64)],
  ])(
    'rejects a mismatched %s',
    (_label, contractDigest, rendererDigest, buildInfoDigest) => {
      expect(() =>
        assertDistributionAgreement({
          contractJson: canonical,
          contractDigest,
          rendererDigest,
          buildInfoDigest,
        })
      ).toThrow(/distribution/i);
    }
  );

  it('plans no update IPC or deep-link registration for community', () => {
    expect(distributionIpcCapabilities(COMMUNITY_DISTRIBUTION)).toEqual({
      updates: false,
      updateIpcChannels: [],
      protocolScheme: null,
    });
  });

  it('strips poisoned legacy analytics variables from the renderer child', () => {
    const child = distributionChildEnvironment(
      resolveDistribution(COMMUNITY_DISTRIBUTION),
      {
        NEXT_PUBLIC_POSTHOG_KEY: 'poisoned-key',
        NEXT_PUBLIC_POSTHOG_HOST: 'https://www.exawatt.ai/ingest',
        NEXT_PUBLIC_ANALYTICS_DISABLED: 'false',
      }
    );
    expect(child.NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
    expect(child.NEXT_PUBLIC_POSTHOG_HOST).toBeUndefined();
    expect(child.NEXT_PUBLIC_ANALYTICS_DISABLED).toBeUndefined();
    expect(child.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON).toBe(canonical);
  });

  it('isolates community state/cache without relocating a branded install', () => {
    const defaults = {
      userData: '/Users/test/Library/Application Support/Exawatt Community',
      sessionData: '/Users/test/Library/Application Support/Exawatt Community',
    };
    expect(
      distributionDataPathOverrides(COMMUNITY_DISTRIBUTION, defaults)
    ).toEqual({
      userData:
        '/Users/test/Library/Application Support/ai.exawatt.community',
      sessionData:
        '/Users/test/Library/Application Support/ai.exawatt.community.cache',
    });
    expect(
      distributionDataPathOverrides(
        {
          ...COMMUNITY_DISTRIBUTION,
          brand: {
            appId: 'ai.example.agent-console',
            productName: 'Agent Console',
            protocolScheme: 'agent-console',
            iconPath: 'assets/agent-console.icns',
            updateChannel: 'stable',
          },
        },
        {
          userData: '/Users/test/Library/Application Support/Agent Console',
          sessionData:
            '/Users/test/Library/Application Support/Agent Console',
        }
      )
    ).toEqual({});
  });

  it('binds the renderer composition manifest to build-info', () => {
    const composition = '{"schemaVersion":1,"profile":"desktop-public"}\n';
    const compositionDigest = createHash('sha256')
      .update(composition)
      .digest('hex');
    expect(() =>
      assertRendererCompositionAgreement({
        compositionJson: composition,
        compositionDigest,
        buildInfoDigest: compositionDigest,
      })
    ).not.toThrow();
    expect(() =>
      assertRendererCompositionAgreement({
        compositionJson: `${composition}tampered`,
        compositionDigest,
        buildInfoDigest: compositionDigest,
      })
    ).toThrow(/composition/i);
  });
});
