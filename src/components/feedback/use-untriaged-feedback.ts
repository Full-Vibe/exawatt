'use client';

import { useEffect, useState } from 'react';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { parseFeedbackTriageCapability } from '@/lib/feedback/capability-contract';
import { FEEDBACK_SUBMITTED_EVENT } from './quick-feedback-events';

/**
 * The operator's untriaged feedback rows (ENG-025 F2.1, scoped by F3.1).
 *
 * Triage is an operator-lane concept, so this counts for operator accounts
 * only and returns null for everyone else — a non-operator was previously
 * shown a "N filed thoughts awaiting triage" line about a queue they cannot
 * act on. The configured service derives capability server-side; no operator
 * identity allowlist enters the renderer bundle.
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
        const distribution = resolvedDistribution();
        const endpoint = distribution.services.productFeedback;
        if (!endpoint) {
          if (!cancelled) setCount(null);
          return;
        }
        const supabase = createOptionalClient(distribution);
        if (!supabase) {
          if (!cancelled) setCount(null);
          return;
        }
        // Signed out ⇒ no query: an unauthenticated REST call is a
        // guaranteed 401 the browser logs as a console error on every
        // surface that mounts this hook.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!cancelled) setCount(null);
          return;
        }
        const response = await fetch(endpoint.url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${sessionData.session.access_token}`,
          },
        });
        if (!response.ok) {
          if (!cancelled) setCount(null);
          return;
        }
        const capability = parseFeedbackTriageCapability(await response.json());
        if (!cancelled) {
          setCount(
            capability?.canTriage ? (capability.untriagedCount ?? null) : null
          );
        }
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
