/**
 * ENG-047 F5 — a signed-in account's activity stream (decision `0053`,
 * amended 2026-10-15).
 *
 * For an account that has signed in to the desktop app, the activation
 * events and Session-level activity (`ACCOUNT_STREAM_EVENTS`: launched,
 * Project opened, Agent launched, directed and finished) are also captured
 * under a second distinct id: the account id. Nothing joins it to the
 * installation id: no `identify`, no alias, and no property of this stream
 * carries the installation id, the SDK's device or session ids, a path, or
 * any text. The installation person and the account person stay two people,
 * so the funnel's anonymous install is never tied to a name (decision
 * `0031`'s separation holds). Signed out, this stream sends nothing.
 *
 * `posthog-js` keeps one distinct id per instance, so this stream posts the
 * same allowlisted payload to the same ingest endpoint directly (`ingest.ts`)
 * with an explicit `distinct_id`.
 */

import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { createOptionalClient } from '@/lib/supabase/client';
import { isAccountStreamEvent, type AnalyticsEvent } from './events';
import {
  INGEST_LIBS,
  ingestRecordFor,
  sendToIngest,
  type IngestRecord,
  type IngestTarget,
} from './ingest';

export interface AccountStream {
  capture(event: AnalyticsEvent): void;
  stop(): void;
}

/** Calls `onAccount` with the signed-in account id, or null, now and on
 *  every change; returns the unsubscribe. */
export type AccountSubscription = (
  onAccount: (accountId: string | null) => void
) => () => void;

/** The account seam's own session, read locally: no request is made. */
const subscribeToSignedInAccount: AccountSubscription = onAccount => {
  const supabase = createOptionalClient(resolvedDistribution());
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    onAccount(session?.user?.id ?? null);
  });
  return () => data.subscription.unsubscribe();
};

export function startAccountStream(
  target: IngestTarget,
  deps: {
    subscribe?: AccountSubscription;
    send?: (
      target: IngestTarget,
      records: readonly IngestRecord[]
    ) => Promise<boolean>;
  } = {}
): AccountStream {
  const send = deps.send ?? sendToIngest;
  let accountId: string | null = null;
  /** Until the session's first answer, events wait (the launch event is
   *  captured before the local session read resolves). */
  let answered = false;
  let waiting: AnalyticsEvent[] = [];
  let queued: IngestRecord[] = [];
  let flushScheduled = false;
  let stopped = false;

  const flush = () => {
    flushScheduled = false;
    const batch = queued;
    queued = [];
    if (batch.length > 0 && !stopped) void send(target, batch);
  };

  const capture = (event: AnalyticsEvent) => {
    if (stopped || !isAccountStreamEvent(event.name)) return;
    if (!answered) {
      if (waiting.length < MAX_WAITING) waiting.push(event);
      return;
    }
    if (!accountId) return;
    const record = ingestRecordFor(event, accountId, {
      personless: false,
      lib: INGEST_LIBS.accountStream,
    });
    if (!record) return;
    queued.push(record);
    if (!flushScheduled) {
      flushScheduled = true;
      queueMicrotask(flush);
    }
  };

  const unsubscribe = (deps.subscribe ?? subscribeToSignedInAccount)(id => {
    accountId = isAnalyticsId(id) ? id : null;
    if (answered) return;
    answered = true;
    const held = waiting;
    waiting = [];
    for (const event of held) capture(event);
  });

  return {
    capture,
    stop() {
      stopped = true;
      waiting = [];
      queued = [];
      unsubscribe();
    },
  };
}

const MAX_WAITING = 20;
