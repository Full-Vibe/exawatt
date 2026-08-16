import { createBrowserClient } from '@supabase/ssr';
import type { DistributionContractV1 } from '@exawatt/core/distribution';

/** New nullable seam for WP2b callers. Legacy env can never enable it. */
export function createOptionalClient(distribution: DistributionContractV1) {
  const account = distribution.account;
  if (!account) return null;
  return createBrowserClient(account.supabaseUrl, account.supabaseAnonKey);
}

/**
 * Temporary compatibility wrapper. WP2b migrates callers to the explicit
 * nullable factory, then deletes this ambient-env path.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Account service is not configured in this build.');
  }
  return createBrowserClient(url, key);
}
