import {
  distributionConnectSources,
  type DistributionContractV2,
} from '@exawatt/core/distribution';

export interface DistributionRewrite {
  source: string;
  destination: string;
}

const POSTHOG_EVENT_INGEST = 'https://us.i.posthog.com/:path*';
const POSTHOG_STATIC_INGEST = 'https://us-assets.i.posthog.com/static/:path*';

/**
 * The PostHog proxy exists only in a distribution that declares analytics.
 * Community builds therefore cannot be repurposed as an ambient ingest proxy,
 * even when a stale PostHog key or host remains in the launching shell.
 */
export function distributionRewrites(
  contract: DistributionContractV2
): DistributionRewrite[] {
  if (!contract.analytics) return [];
  return [
    {
      source: '/ingest/static/:path*',
      destination: POSTHOG_STATIC_INGEST,
    },
    {
      source: '/ingest/:path*',
      destination: POSTHOG_EVENT_INGEST,
    },
  ];
}

/**
 * Build one deterministic CSP from the resolved contract. Distribution
 * service origins are exact; the separate `ws:` lane is intentionally broad
 * because an operator-owned Agent Source Gateway may be loopback, LAN, or
 * remote and is selected at runtime rather than by the distributor.
 */
export function distributionContentSecurityPolicy(
  contract: DistributionContractV2,
  options: { development: boolean }
): string {
  const connectSources = distributionConnectSources(contract).join(' ');
  return [
    "default-src 'self'",
    options.development
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "worker-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https:",
  ].join('; ');
}
