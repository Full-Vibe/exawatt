'use client';

/**
 * DEV/TEST ONLY (ENG-015 S5 test infra): lets the automated Electron eval sign
 * the renderer in without Google OAuth. Playwright sets
 * `window.__EXAWATT_TEST_SESSION` (a minted access/refresh token pair) before
 * the page loads; here we hand it to Supabase via `setSession` so registry
 * accessors (openRepositoryProject) run under the operator's RLS. Guarded by
 * NODE_ENV so it is inert in production builds; renders nothing.
 */
import { useEffect } from 'react';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';

interface TestSession {
  access_token: string;
  refresh_token: string;
}

export function TestAuthBridge() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const session = (
      window as unknown as { __EXAWATT_TEST_SESSION?: TestSession }
    ).__EXAWATT_TEST_SESSION;
    if (!session?.access_token) return;
    const supabase = createOptionalClient(resolvedDistribution());
    if (supabase) void supabase.auth.setSession(session);
  }, []);
  return null;
}
