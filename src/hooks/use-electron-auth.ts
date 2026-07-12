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

  // Electron main owns the system-browser PKCE flow and gives the sandboxed
  // renderer only the completed session pair through the trusted preload API.
  useEffect(() => {
    const auth = window.electron?.auth;
    if (!auth) return;

    const cleanupSession = auth.onSession(async session => {
      const { error } = await supabase.auth.setSession({
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
      });
      if (error) {
        console.error('[auth] Electron OAuth session install failed', {
          name: error.name,
          message: error.message,
          status: error.status,
          code: error.code,
        });
        callbacksRef.current.onError(authErrorMessage(error));
        callbacksRef.current.onLoadingChange(false);
      } else {
        router.push('/workspace');
        router.refresh();
      }
    });
    const cleanupError = auth.onError(error => {
      console.error('[auth] Electron OAuth failed', error);
      callbacksRef.current.onError(authErrorMessage(error));
      callbacksRef.current.onLoadingChange(false);
    });

    return () => {
      cleanupSession();
      cleanupError();
    };
  }, [supabase, router]);

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
