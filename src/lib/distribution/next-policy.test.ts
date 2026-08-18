import { describe, expect, it } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContract,
} from '@exawatt/core/distribution';
import {
  compositionRewrites,
  distributionContentSecurityPolicy,
  distributionRewrites,
} from './next-policy';

function directive(policy: string, name: string): string {
  const value = policy
    .split('; ')
    .find(candidate => candidate.startsWith(`${name} `));
  if (!value) throw new Error(`Missing ${name} directive`);
  return value;
}

const CUSTOM_ANALYTICS = parseDistributionContract({
  ...COMMUNITY_DISTRIBUTION,
  analytics: {
    ingestOrigin: 'https://telemetry.example.test/collect',
    projectKey: 'public-project-key',
  },
});

describe('distribution Next policy', () => {
  it('removes the ingest proxy entirely from community builds', () => {
    expect(distributionRewrites(COMMUNITY_DISTRIBUTION)).toEqual([]);
  });

  it('routes /download to the public page in every distribution', () => {
    // The composition owns this, not the contract: an `official-web` tree has
    // its own `/download` page and wins on the filesystem, because Next applies
    // an array of rewrites AFTER filesystem routes. So the same unconditional
    // entry is correct for a community build, a public clone, and the hosted
    // site, and no environment-derived boolean can disagree with the tree.
    expect(compositionRewrites()).toEqual([
      { source: '/download', destination: '/download/community' },
    ]);
    expect(compositionRewrites()).toEqual(compositionRewrites());
  });

  it('keeps the composition rewrite out of the contract-driven list', () => {
    for (const contract of [COMMUNITY_DISTRIBUTION, CUSTOM_ANALYTICS]) {
      expect(
        distributionRewrites(contract).some(rewrite =>
          rewrite.source.startsWith('/download')
        )
      ).toBe(false);
    }
  });

  it('adds both trailing-slash-sensitive PostHog rewrites only when configured', () => {
    expect(distributionRewrites(CUSTOM_ANALYTICS)).toEqual([
      {
        source: '/ingest/static/:path*',
        destination: 'https://us-assets.i.posthog.com/static/:path*',
      },
      {
        source: '/ingest/:path*',
        destination: 'https://us.i.posthog.com/:path*',
      },
    ]);
  });

  it('keeps community connect-src service-neutral while preserving Agent Sources', () => {
    const policy = distributionContentSecurityPolicy(COMMUNITY_DISTRIBUTION, {
      development: false,
    });
    const connect = directive(policy, 'connect-src');
    expect(connect).toBe("connect-src 'self' ws:");
    expect(connect).not.toContain('exawatt');
    expect(connect).not.toContain('posthog');
    expect(connect).not.toContain('https:');
    expect(connect).not.toContain('wss:');
  });

  it('adds only the configured analytics origin, never its key or PostHog upstreams', () => {
    const policy = distributionContentSecurityPolicy(CUSTOM_ANALYTICS, {
      development: false,
    });
    const connect = directive(policy, 'connect-src');
    expect(connect).toBe(
      "connect-src 'self' ws: https://telemetry.example.test"
    );
    expect(policy).not.toContain('public-project-key');
    expect(connect).not.toContain('posthog.com');
    expect(connect).not.toContain('exawatt');
  });

  it('allows React debugging eval only in development', () => {
    const development = distributionContentSecurityPolicy(
      COMMUNITY_DISTRIBUTION,
      { development: true }
    );
    const production = distributionContentSecurityPolicy(
      COMMUNITY_DISTRIBUTION,
      { development: false }
    );
    expect(directive(development, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(production, 'script-src')).not.toContain("'unsafe-eval'");
  });
});
