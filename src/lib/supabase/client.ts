import { createBrowserClient } from '@supabase/ssr';
import type { DistributionContractV1 } from '@exawatt/core/distribution';

/** New nullable seam for WP2b callers. Legacy env can never enable it. */
export function createOptionalClient(distribution: DistributionContractV1) {
  const account = distribution.account;
  if (!account) return null;
  return createBrowserClient(account.supabaseUrl, account.supabaseAnonKey);
}
