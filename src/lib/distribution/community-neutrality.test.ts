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
// The own-account boundary lives in Electron main, but it is a distribution
// property, so it is asserted here beside every other capability the
// community contract withholds.
import { isClaudePlanRemoteReadAllowed } from '../../../electron/main/consumption/claude-plan-account';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';
import { isOutboundControlConfigured } from '@/lib/hosted-features/distribution-availability';

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
      ownAccount: {
        claudePlanUsage: false,
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

  // BUG-060. This is the OTHER outbound family: not an Exawatt service, but a
  // credentialed read against the operator's own vendor account that leaves
  // through Exawatt's own network stack and therefore carries this build's
  // code signature. Incident `0011` is what that costs from an ad-hoc-signed
  // artifact, and `app.isPackaged` stops being the boundary the moment a
  // contributor packages the public repository: their build is packaged too.
  it('permits no automatic own-account read from a packaged community build', () => {
    expect(COMMUNITY_DISTRIBUTION.ownAccount).toBeNull();
    const stableSignedIdentity = distributionCapabilities(
      COMMUNITY_DISTRIBUTION
    ).ownAccount.claudePlanUsage;
    expect(stableSignedIdentity).toBe(false);

    // Packaged, not a test run, no developer opt-in: the exact shape of a
    // contributor's ad-hoc `pnpm electron:build` artifact on a real desktop.
    expect(
      isClaudePlanRemoteReadAllowed({
        stableSignedIdentity,
        packaged: true,
        testMode: false,
        developmentOptIn: undefined,
      })
    ).toBe(false);

    // And the grant is real in the other direction, so this asserts a
    // boundary rather than a disabled feature: a distribution that declares
    // the stable signed identity gets the read in its packaged build.
    expect(
      isClaudePlanRemoteReadAllowed({
        stableSignedIdentity: true,
        packaged: true,
        testMode: false,
        developmentOptIn: undefined,
      })
    ).toBe(true);
  });

  it('offers no dead Claude plan switch on a community Privacy surface', () => {
    const capabilities = distributionCapabilities(COMMUNITY_DISTRIBUTION);
    expect(
      isOutboundControlConfigured(
        OUTBOUND_CONTROLS.claudePlanWindows,
        capabilities
      )
    ).toBe(false);
    // The recap is the control on the same group that no distribution
    // capability gates: it runs the operator's own `claude` CLI, a separate
    // program with its own firewall identity, so it stays switchable here.
    expect(
      isOutboundControlConfigured(OUTBOUND_CONTROLS.reentryRecap, capabilities)
    ).toBe(true);
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
