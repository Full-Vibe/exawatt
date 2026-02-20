'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';

export function useElectronAuth(
  supabase: SupabaseClient,
  callbacks: {
    onError: (message: string) => void;
    onLoadingChange: (loading: boolean) => void;
  },
) {
  const router = useRouter();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Listen for auth code arriving via deep link from Electron main process.
  // The PKCE code verifier is in this renderer's storage, so we exchange here.
  useEffect(() => {
    if (!window.electron?.auth?.onDeepLinkCode) return;

    const cleanup = window.electron.auth.onDeepLinkCode(async (code) => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        callbacksRef.current.onError('Authentication failed. Please try again.');
        callbacksRef.current.onLoadingChange(false);
      } else {
        router.push('/projects');
        router.refresh();
      }
    });

    return cleanup;
  }, [supabase, router]);

  const signInWithGoogle = async () => {
    const isElectron = !!window.electron?.isElectron;

    if (isElectron && window.electron?.auth) {
      // Get the OAuth URL without navigating, then open in system browser
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          skipBrowserRedirect: true,
          redirectTo: `${window.location.origin}/auth/electron-callback`,
        },
      });

      if (error) throw error;
      if (data.url) {
        await window.electron.auth.openExternal(data.url);
      }
    } else {
      // Standard web flow — redirect in-page
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;
    }
  };

  return { signInWithGoogle };
}
