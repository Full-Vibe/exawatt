import {
  COMMUNITY_DISTRIBUTION,
  parseDistributionContractJson,
  type DistributionContractV2,
} from '@exawatt/core/distribution';

let cached: DistributionContractV2 | null = null;

/**
 * Next replaces this literal member expression at build time. Ambient legacy
 * service variables are intentionally not consulted: only the one resolved,
 * validated contract can enable a distribution capability.
 */
export function resolvedDistribution(): DistributionContractV2 {
  if (cached) return cached;
  const serialized = process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_JSON;
  cached = serialized
    ? parseDistributionContractJson(serialized)
    : COMMUNITY_DISTRIBUTION;
  return cached;
}

export function resolvedDistributionDigest(): string | null {
  return process.env.NEXT_PUBLIC_EXAWATT_DISTRIBUTION_SHA256 ?? null;
}

/** Test-only reset for env-projection tests. */
export function resetResolvedDistributionForTest(): void {
  cached = null;
}
