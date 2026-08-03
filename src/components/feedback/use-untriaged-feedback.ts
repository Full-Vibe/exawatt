'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { FEEDBACK_SUBMITTED_EVENT } from './quick-feedback-events';

/**
 * The operator's untriaged feedback rows (ENG-025 F2.1). RLS scopes the
 * count to the signed-in user's own rows, so this is a personal inbox, not
 * a global one. Returns null while unknown (signed out, offline, query
 * failure) — surfaces render nothing rather than a wrong zero. Refreshes
 * when any submission is accepted.
 */
export function useUntriagedFeedbackCount(enabled = true): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const sample = async () => {
      try {
        const supabase = createClient();
        // Signed out ⇒ no query: an unauthenticated REST call is a
        // guaranteed 401 the browser logs as a console error on every
        // surface that mounts this hook.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!cancelled) setCount(null);
          return;
        }
        const { count: value, error } = await supabase
          .from('product_feedback')
          .select('*', { count: 'exact', head: true })
          .is('triaged_at', null);
        if (!cancelled) setCount(error ? null : (value ?? null));
      } catch {
        if (!cancelled) setCount(null);
      }
    };
    void sample();
    const onSubmitted = () => void sample();
    window.addEventListener(FEEDBACK_SUBMITTED_EVENT, onSubmitted);
    return () => {
      cancelled = true;
      window.removeEventListener(FEEDBACK_SUBMITTED_EVENT, onSubmitted);
    };
  }, [enabled]);
  return enabled ? count : null;
}
