import type { DistributionContractV2 } from '@exawatt/core/distribution';

export const DISTRIBUTION_WEB_ICON_URL = '/exawatt-distribution/icon.png';

/**
 * Browser chrome has a different asset contract from the macOS bundle.
 *
 * `brand.iconPath` is a repository-relative electron-builder input, not a URL.
 * Build preparation extracts its largest PNG representation (or the community
 * identity's own ICNS when brand is null) into a digest-bound build artifact,
 * and the distribution icon route serves it at one stable URL. Browser code
 * never guesses at product names or asks a downstream distributor to maintain
 * a second out-of-contract `/icon.png` file.
 */
export function resolveDistributionWebIcon(
  _contract: DistributionContractV2
): string {
  return DISTRIBUTION_WEB_ICON_URL;
}
