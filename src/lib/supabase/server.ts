import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { DistributionContractV1 } from '@exawatt/core/distribution';
import { resolvedDistribution } from '@/lib/distribution/resolved';

export async function createOptionalServerClient(
  distribution: DistributionContractV1
) {
  const account = distribution.account;
  if (!account) return null;
  const cookieStore = await cookies();

  return createServerClient(account.supabaseUrl, account.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Server Components cannot write cookies; middleware refreshes them.
        }
      },
    },
  });
}

/**
 * The one account seam a request-time path may use (BUG-044).
 *
 * `null` is the ordinary answer, not an error: a community distribution ships
 * no account service, so every server action and route handler that reaches
 * for one must state what it does WITHOUT it. The nullable return makes that a
 * type obligation instead of a thing to remember — the throwing wrapper this
 * replaced turned the same absence into a 500 on the operator's workspace,
 * twice per launch, and silently dropped his saved keyboard overrides.
 *
 * Ambient `NEXT_PUBLIC_SUPABASE_*` is deliberately not consulted. Only the one
 * resolved, validated contract can enable the capability, which is what stops a
 * stray `.env.local` from putting account credentials back into a community
 * build.
 */
export async function accountServerClient() {
  return createOptionalServerClient(resolvedDistribution());
}
