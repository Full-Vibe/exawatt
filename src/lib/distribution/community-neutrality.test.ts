import { describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_DISTRIBUTION,
  resolveDistributionIdentity,
} from '@exawatt/core/distribution';
import { distributionCapabilities } from './capabilities';
import { runConfiguredService } from './service-client';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolveHostedAuthTargets } from '@/components/auth/hosted-auth';
import { resolveDistributionAnalyticsDecision } from '@/lib/analytics/config';
import { handleElectronCallback } from '@/app/auth/electron-callback/route';
// The packaging projection is plain Node ESM shared with electron-builder, so
// this gate reads the same answer electron-builder is given.
import { electronBuilderDistributionConfig } from '../../../scripts/lib/distribution-build.mjs';

describe('community distribution neutrality', () => {
  it('projects no Exawatt service, account, update, or protocol capability', () => {
    expect(distributionCapabilities(COMMUNITY_DISTRIBUTION)).toEqual({
      analytics: false,
      account: false,
      hostedAuth: false,
      updates: false,
      protocolScheme: null,
      enrichment: {
        contextLabels: false,
        conversationSummaries: false,
        goalVisuals: false,
      },
      services: {
        productFeedback: false,
        operatorStats: false,
        projects: false,
        preferences: false,
        accountData: false,
      },
    });
    expect(resolveDistributionIdentity(COMMUNITY_DISTRIBUTION)).toMatchObject({
      productName: 'Exawatt Community',
      protocolScheme: null,
      updateChannel: null,
    });
    expect(resolveHostedAuthTargets(COMMUNITY_DISTRIBUTION)).toBeNull();
    expect(
      resolveDistributionAnalyticsDecision(
        COMMUNITY_DISTRIBUTION,
        { optedOut: false },
        'production'
      )
    ).toEqual({ enabled: false, reason: 'no_distribution_config' });
  });

  it('registers no exawatt:// protocol handler and emits no exawatt:// link', async () => {
    // Registration at package time. `protocols:` becomes Info.plist
    // CFBundleURLTypes, so an official builder template must not survive the
    // community projection: a community app that kept the scheme could be
    // launched by, or could intercept, the official app's deep links.
    expect(
      electronBuilderDistributionConfig(
        {
          appId: 'ai.exawatt.desktop',
          productName: 'Exawatt',
          protocols: [{ name: 'Exawatt', schemes: ['exawatt'] }],
        },
        COMMUNITY_DISTRIBUTION
      ).protocols
    ).toBeUndefined();

    // Registration at runtime reads the same null: Electron main calls
    // `setAsDefaultProtocolClient` and listens for `open-url` only when the
    // resolved contract owns a scheme.
    expect(
      resolveDistributionIdentity(COMMUNITY_DISTRIBUTION).protocolScheme
    ).toBeNull();

    // And the one web surface that could hand a community user an official
    // deep link refuses, whether or not an account service exists — the
    // protocol, not the account, is what a returning browser needs.
    for (const accountConfigured of [false, true]) {
      const response = handleElectronCallback(
        new Request('https://app.test/auth/electron-callback?code=community'),
        resolveDistributionIdentity(COMMUNITY_DISTRIBUTION),
        undefined,
        accountConfigured
      );
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('exawatt://');
    }
  });

  it('returns null from the new Supabase seam even when legacy env is poisoned', () => {
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-key';
    try {
      expect(createOptionalClient(COMMUNITY_DISTRIBUTION)).toBeNull();
    } finally {
      if (originalUrl === undefined)
        delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
      if (originalKey === undefined)
        delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalKey;
    }
  });

  it('short-circuits a null product service before auth or fetch', async () => {
    const invoke = vi.fn(async () => 'should-not-run');
    await expect(
      runConfiguredService(
        COMMUNITY_DISTRIBUTION.services.productFeedback,
        invoke
      )
    ).resolves.toEqual({ configured: false });
    expect(invoke).not.toHaveBeenCalled();
  });
});
