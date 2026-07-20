'use client';

import { useEffect, useState } from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { SiteHeaderNav } from './site-header-nav';

interface HeaderAuthState {
  isAuthenticated: boolean;
  userName?: string;
  userEmail?: string;
}

/**
 * Client-side auth presentation for the chrome. The header deliberately does
 * NOT read auth on the server: the root layout renders on every navigation,
 * and a server-side `getUser()` blocks each one on a Supabase round-trip —
 * with the network down the whole app hangs behind it (ENG-016 D18 offline
 * authority). The browser client reports the cached session locally and
 * updates on real auth events.
 */
export function SiteHeader() {
  const [auth, setAuth] = useState<HeaderAuthState>({
    isAuthenticated: false,
  });

  useEffect(() => {
    // A missing/misconfigured Supabase env must degrade to signed-out chrome,
    // never crash the root layout.
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch (error) {
      console.warn('[exawatt] auth unavailable for header:', error);
      return;
    }
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) => {
        const user = session?.user;
        setAuth({
          isAuthenticated: !!user,
          userName: user?.user_metadata?.full_name ?? undefined,
          userEmail: user?.email ?? undefined,
        });
      }
    );
    return () => subscription.subscription.unsubscribe();
  }, []);

  return (
    <SiteHeaderNav
      isAuthenticated={auth.isAuthenticated}
      userName={auth.userName}
      userEmail={auth.userEmail}
    />
  );
}
