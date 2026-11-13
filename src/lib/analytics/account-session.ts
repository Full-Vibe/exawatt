/**
 * The signed-in Exawatt account, as analytics may see it: its id, for the
 * account stream (ENG-047 F5), and whether it is the team's, for `internal`
 * (ENG-047 F6). Read from the account client's own session, so no request is
 * made, and shared: every listener in this load rides one subscription.
 */

import { isAnalyticsId } from '@exawatt/core/desktop-bridge';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { createOptionalClient } from '@/lib/supabase/client';

export interface SignedInAccount {
  id: string;
  /** `app_metadata.exawatt_team`, which only the service role can set. */
  team: boolean;
}

/** Calls `onAccount` with the signed-in account, or null, now (once the
 *  session answers) and on every change; returns the unsubscribe. */
export type AccountSubscription = (
  onAccount: (account: SignedInAccount | null) => void
) => () => void;

/** The `app_metadata` key that marks a team account. */
const TEAM_APP_METADATA_KEY = 'exawatt_team';

/** A session's user as an analytics account; anything malformed is none. */
export function accountOf(user: unknown): SignedInAccount | null {
  if (!user || typeof user !== 'object') return null;
  const candidate = user as { id?: unknown; app_metadata?: unknown };
  if (!isAnalyticsId(candidate.id)) return null;
  const metadata =
    candidate.app_metadata && typeof candidate.app_metadata === 'object'
      ? (candidate.app_metadata as Record<string, unknown>)
      : {};
  return { id: candidate.id, team: metadata[TEAM_APP_METADATA_KEY] === true };
}

type Listener = (account: SignedInAccount | null) => void;

let listeners: Set<Listener> | null = null;
let latest: { account: SignedInAccount | null } | null = null;
let unsubscribeSession: (() => void) | null = null;

export const subscribeToSignedInAccount: AccountSubscription = onAccount => {
  if (!listeners) {
    listeners = new Set();
    const supabase = createOptionalClient(resolvedDistribution());
    if (supabase) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        latest = { account: accountOf(session?.user) };
        for (const listener of [...(listeners ?? [])]) {
          listener(latest.account);
        }
      });
      unsubscribeSession = () => data.subscription.unsubscribe();
    }
  }
  const own = listeners;
  own.add(onAccount);
  if (latest) onAccount(latest.account);
  return () => {
    own.delete(onAccount);
    if (own.size > 0 || listeners !== own) return;
    unsubscribeSession?.();
    unsubscribeSession = null;
    listeners = null;
    latest = null;
  };
};

/**
 * Calls `onTeam` once, the first time a team account is signed in, then
 * stops listening. Returns the stop for a launch that ends first.
 */
export function watchForTeamAccount(
  onTeam: () => void,
  subscribe: AccountSubscription = subscribeToSignedInAccount
): () => void {
  let fired = false;
  let unsubscribe: (() => void) | null = null;
  const stop = () => {
    unsubscribe?.();
    unsubscribe = null;
  };
  unsubscribe = subscribe(account => {
    if (fired || !account?.team) return;
    fired = true;
    onTeam();
    stop(); // A synchronous answer has no unsubscribe yet; see below.
  });
  if (fired) stop();
  return stop;
}
