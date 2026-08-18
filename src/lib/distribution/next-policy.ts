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
 * `/download` is answered by whichever tree owns it (ENG-030 WP3).
 *
 * The company overlay adds `src/app/download/page.tsx` in an `official-web`
 * composition: the official signed build, its live release metadata, and invite
 * attribution. Every other tree, including a public clone and a community
 * build, has no such file, and the marketing bands link `/download` through
 * `DOWNLOAD_HREF` regardless. This rewrite is what makes the public page the
 * answer in that case.
 *
 * It is deliberately UNCONDITIONAL, and that is the whole design. Next applies
 * an array of rewrites after checking the filesystem, so a composed tree wins
 * by having the page and the public tree wins by not having it. The switch is
 * therefore the composition itself rather than a second signal derived from the
 * contract, which cannot disagree with the tree the way an environment-derived
 * boolean can. Incident `0017` is what a silent disagreement between those two
 * costs.
 */
export const PUBLIC_DOWNLOAD_REWRITE: DistributionRewrite = Object.freeze({
  source: '/download',
  destination: '/download/community',
});

/**
 * Rewrites that follow the COMPOSITION rather than the distribution contract.
 * Kept separate from `distributionRewrites` so neither list can quietly acquire
 * the other's condition.
 */
export function compositionRewrites(): DistributionRewrite[] {
  // A COPY, not the frozen declaration: Next normalizes each rewrite in place
  // (basePath, locale), so handing it the frozen object fails the build with
  // `Cannot assign to read only property 'source'`.
  return [{ ...PUBLIC_DOWNLOAD_REWRITE }];
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
