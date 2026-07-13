'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';

export function useElectronAuth(
  supabase: SupabaseClient,
  callbacks: {
    onError: (message: string) => void;
    onLoadingChange: (loading: boolean) => void;
  }
) {
  const router = useRouter();
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Electron main owns system-browser PKCE and persists the completed session
  // into this renderer's canonical Supabase cookie jar. No renderer auth fetch
  // is needed after the deep link returns.
  useEffect(() => {
    const auth = window.electron?.auth;
    if (!auth) return;

    const cleanupComplete = auth.onComplete(() => {
      router.push('/workspace');
      router.refresh();
    });
    const cleanupError = auth.onError(error => {
      console.error('[auth] Electron OAuth failed', error);
      callbacksRef.current.onError(authErrorMessage(error));
      callbacksRef.current.onLoadingChange(false);
    });

    return () => {
      cleanupComplete();
      cleanupError();
    };
  }, [router]);

  const signInWithGoogle = async () => {
    const isElectron = !!window.electron?.isElectron;

    if (isElectron && window.electron?.auth) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Authentication is not configured.');
      }
      await window.electron.auth.startGoogle({
        supabaseUrl,
        supabaseAnonKey,
        redirectTo: `${window.location.origin}/auth/electron-callback`,
      });
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

function authErrorMessage(error: { name?: string; message: string }): string {
  if (error.name === 'AuthRetryableFetchError') {
    return "Couldn't reach the authentication service. Check your connection and try again.";
  }
  return error.message || 'Authentication failed. Please try again.';
}
