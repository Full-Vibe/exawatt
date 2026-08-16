import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  COMMUNITY_DISTRIBUTION,
  serializeDistributionContract,
} from '@exawatt/core/distribution';
import {
  assertDistributionAgreement,
  assertRendererCompositionAgreement,
  distributionIpcCapabilities,
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
