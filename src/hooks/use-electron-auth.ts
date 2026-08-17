'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { SupabaseClient } from '@supabase/supabase-js';
import { analyticsSurface, captureAnalyticsEvent } from '@/lib/analytics';
import { resolvedDistribution } from '@/lib/distribution/resolved';

export function useElectronAuth(
  supabase: SupabaseClient | null,
  callbacks: {
    onError: (message: string) => void;
    onLoadingChange: (loading: boolean) => void;
  }
) {
  const router = useRouter();
  const account = resolvedDistribution().account;
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  // Electron main owns system-browser PKCE and persists the completed session
  // into this renderer's canonical Supabase cookie jar. No renderer auth fetch
  // is needed after the deep link returns.
  useEffect(() => {
    const auth = window.electron?.auth;
    if (!auth) return;

    const cleanupComplete = auth.onComplete(() => {
      // The only point where the desktop system-browser flow is observably
      // finished — the page that started it cannot await it (ENG-030 OS1.2).
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: analyticsSurface(),
        method: 'google',
        outcome: 'succeeded',
        failure: null,
      });
      router.push('/workspace');
      router.refresh();
    });
    const cleanupError = auth.onError(error => {
      console.error('[auth] Electron OAuth failed', error);
      captureAnalyticsEvent({
        name: 'sign_in_attempted',
        surface: analyticsSurface(),
        method: 'google',
        outcome: 'failed',
        failure:
          error.name === 'AuthRetryableFetchError'
            ? 'network'
            : 'provider_error',
      });
      callbacksRef.current.onError(authErrorMessage(error));
      callbacksRef.current.onLoadingChange(false);
    });

    return () => {
      cleanupComplete();
      cleanupError();
    };
  }, [router]);

  const signInWithGoogle = async () => {
    if (!supabase || !account) {
      throw new Error('Authentication is not configured in this build.');
    }
    const isElectron = !!window.electron?.isElectron;

    if (isElectron && window.electron?.auth) {
      await window.electron.auth.startGoogle({
        supabaseUrl: account.supabaseUrl,
        supabaseAnonKey: account.supabaseAnonKey,
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
