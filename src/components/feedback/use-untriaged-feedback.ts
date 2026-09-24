'use client';

import { useEffect, useState } from 'react';
import {
  decodeCompatibleServiceJson,
  fetchCompatibleService,
} from '@exawatt/core/distribution';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { parseFeedbackTriageCapability } from '@/lib/feedback/capability-contract';
import { useLatestRequest } from '@/hooks/use-latest-request';
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
  // Mount and each accepted submission start a sample, and they overlap:
  // the count on screen is the NEWEST sample's, never whichever response
  // happened to land last.
  const samples = useLatestRequest();
  useEffect(() => {
    if (!enabled) return;
    const sample = async () => {
      const ticket = samples.begin();
      const stale = () => !ticket.current;
      try {
        const distribution = resolvedDistribution();
        const endpoint = distribution.services.productFeedback;
        if (!endpoint) {
          if (!stale()) setCount(null);
          return;
        }
        const supabase = createOptionalClient(distribution);
        if (!supabase) {
          if (!stale()) setCount(null);
          return;
        }
        // Signed out ⇒ no query: an unauthenticated REST call is a
        // guaranteed 401 the browser logs as a console error on every
        // surface that mounts this hook.
        const { data: sessionData } = await supabase.auth.getSession();
        if (!sessionData.session) {
          if (!stale()) setCount(null);
          return;
        }
        const response = await fetchCompatibleService(endpoint, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${sessionData.session.access_token}`,
          },
        });
        const capability = await decodeCompatibleServiceJson(
          endpoint,
          response,
          value => {
            const parsed = parseFeedbackTriageCapability(value);
            if (!parsed) throw new TypeError('feedback capability is invalid');
            return parsed;
          }
        );
        if (!stale()) {
          setCount(
            capability?.canTriage ? (capability.untriagedCount ?? null) : null
          );
        }
      } catch {
        if (!stale()) setCount(null);
      }
    };
    void sample();
    const onSubmitted = () => void sample();
    window.addEventListener(FEEDBACK_SUBMITTED_EVENT, onSubmitted);
    return () => {
      samples.invalidate();
      window.removeEventListener(FEEDBACK_SUBMITTED_EVENT, onSubmitted);
    };
  }, [enabled, samples]);
  return enabled ? count : null;
}
