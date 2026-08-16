import type { DistributionEndpointRefV1 } from '@exawatt/core/distribution';

export type ConfiguredServiceResult<T> =
  | { configured: false }
  | { configured: true; value: T };

/**
 * The null check intentionally owns the outer edge of the operation. Callers
 * put session lookup and fetch inside `invoke`, so neither can run for a
 * capability the distributor did not configure.
 */
export async function runConfiguredService<T>(
  endpoint: DistributionEndpointRefV1 | null,
  invoke: (endpoint: DistributionEndpointRefV1) => Promise<T>
): Promise<ConfiguredServiceResult<T>> {
  if (!endpoint) return { configured: false };
  return { configured: true, value: await invoke(endpoint) };
}
