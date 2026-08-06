'use client';

import { useEffect, useState } from 'react';
import { isAdminEmail } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/client';
import { FEEDBACK_SUBMITTED_EVENT } from './quick-feedback-events';

/**
 * The operator's untriaged feedback rows (ENG-025 F2.1, scoped by F3.1).
 *
 * Triage is an operator-lane concept, so this counts for operator accounts
 * only and returns null for everyone else — a non-operator was previously
 * shown a "N filed thoughts awaiting triage" line about a queue they cannot
 * act on. RLS scopes the query to the signed-in user's own rows, and for the
 * operator those rows ARE the operator lane, so the count stays exact.
 *
 * Returns null while unknown (signed out, not the operator, offline, query
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
        // Non-operator ⇒ no count and no line. The suggestions lane
        // (ENG-025 F3) is never drained to canon, so its filer has nothing
        // to act on and is owed no triage vocabulary.
        if (!isAdminEmail(sessionData.session.user?.email)) {
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
