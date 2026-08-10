'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Session, UserIdentity } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import {
  AUTH_INTENT_PARAM,
  AUTH_LINK_PARAM,
  classifyLinkOutcome,
  GENERIC_LINK_FAILURE,
  isAuthLinkOutcome,
  isAuthLinkSuccess,
  linkOutcomeMessage,
  LINK_SUCCESS_MESSAGES,
} from '@/components/auth/callback-failures';
import { isOperatorAutoPublishEnabled } from '@/lib/hosted-features/contract';
import {
  OPERATOR_STATS_ENABLED_KEY,
  readOperatorStatsSyncState,
  runOperatorStatsSync,
  subscribeOperatorStatsSync,
  type OperatorStatsSyncState,
} from '@/lib/operator-stats/auto-sync';
import { formatAgentHoursLong, formatSyncedAt, formatTokens } from './format';
import styles from './operator-stats.module.css';

/**
 * ENG-035 — the publish panel as a status surface, not a ritual.
 *
 * Publishing is one durable preference (`operatorProfile.autoPublish`, the
 * Electron settings store; also on Settings → Privacy — same preference, same
 * bridge, so the two can never disagree). Turning it on is the decision `0029`
 * consent act and carries the disclosure inline; while it is on, syncs run
 * automatically (`src/lib/operator-stats/auto-sync.ts`). The old mandatory
 * preview-then-publish two-step is gone per the operator's 2026-08-10
 * direction. Pausing stops updates; **Remove public profile** takes the
 * profile down — deliberately distinct actions.
 */

const SERVER_SYNC_STATE: OperatorStatsSyncState = {
  phase: 'idle',
  lastOutcome: null,
  lastSyncedAt: null,
  lastSnapshot: null,
};

function findGithub(identities: UserIdentity[] | null | undefined) {
  return identities?.find(identity => identity.provider === 'github') ?? null;
}

export function PublishPanel() {
  const tenancy = useOptionalWorkspaceTenancy();
  const inDemoWorkspace = tenancy?.activeWorkspace.kind === 'demo';
  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  // Identities as the SERVER currently knows them. The session's own copy was
  // snapshotted when its token was issued, so it can be an hour behind a link
  // that already succeeded.
  const [identities, setIdentities] = useState<UserIdentity[] | null>(null);
  const [inElectron, setInElectron] = useState(false);
  const [autoPublish, setAutoPublish] = useState(false);
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The desktop error channel is shared with sign-in. Only a link this panel
  // started is this panel's to report.
  const linkInFlight = useRef(false);
  const sync = useSyncExternalStore(
    subscribeOperatorStatsSync,
    readOperatorStatsSyncState,
    () => SERVER_SYNC_STATE
  );

  const refreshIdentities = useCallback(async () => {
    if (!supabase) return null;
    const { data } = await supabase.auth.getUserIdentities();
    const list = data?.identities ?? null;
    if (list) setIdentities(list);
    return findGithub(list);
  }, [supabase]);

  /**
   * One entry point for every verdict on a link attempt, from the web return
   * URL, the desktop deep link, or a throw. Successes and failures both land
   * here because "already linked" is a SUCCESS: the operator asked for that
   * identity to be on his account, and it is. Whatever arrives, only copy this
   * product wrote is rendered.
   */
  const reportLinkOutcome = useCallback(
    async (raw: unknown) => {
      linkInFlight.current = false;
      setBusy(false);
      if (!isAuthLinkOutcome(raw)) {
        setMessage(null);
        setError(GENERIC_LINK_FAILURE);
        return;
      }
      if (isAuthLinkSuccess(raw)) {
        setError(null);
        setMessage(linkOutcomeMessage(raw));
        await refreshIdentities();
        return;
      }
      setMessage(null);
      setError(linkOutcomeMessage(raw));
    },
    [refreshIdentities]
  );

  useEffect(() => {
    setInElectron(Boolean(window.electron?.isElectron));
    setPublished(localStorage.getItem(OPERATOR_STATS_ENABLED_KEY) === 'true');
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) =>
      setSession(next)
    );
    const offElectron = window.electron?.auth?.onComplete(() => {
      linkInFlight.current = false;
      void supabase.auth.getSession().then(({ data: next }) => {
        setSession(next.session);
        window.location.reload();
      });
    });
    // A desktop link that Supabase answered without a code — including the
    // already-linked case that used to reach nobody at all.
    const offLinkOutcome = window.electron?.auth?.onLinkOutcome?.(outcome => {
      void reportLinkOutcome(outcome);
    });
    const offAuthError = window.electron?.auth?.onError(cause => {
      if (!linkInFlight.current) return;
      console.error('[operator-stats] GitHub link failed', cause);
      void reportLinkOutcome(classifyLinkOutcome(cause));
    });
    return () => {
      data.subscription.unsubscribe();
      offElectron?.();
      offLinkOutcome?.();
      offAuthError?.();
    };
  }, [supabase, reportLinkOutcome]);

  // The publishing preference, live. The settings store is the single source
  // of truth; Settings → Privacy writes through the same bridge.
  useEffect(() => {
    const bridge = window.electron?.settings;
    if (!bridge) return;
    let active = true;
    void bridge.get().then(
      settings => {
        if (active) setAutoPublish(isOperatorAutoPublishEnabled(settings));
      },
      () => undefined
    );
    const off = bridge.onChanged?.(settings => {
      if (active) setAutoPublish(isOperatorAutoPublishEnabled(settings));
    });
    return () => {
      active = false;
      off?.();
    };
  }, []);

  // A sync that succeeded (from any trigger) means the profile exists.
  useEffect(() => {
    if (sync.lastOutcome === 'synced') setPublished(true);
  }, [sync.lastOutcome]);

  // The web flow returns here, not to /sign-in, and says what happened on the
  // way in. Consumed once: a reload should not replay a stale verdict.
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get(AUTH_LINK_PARAM);
    if (!outcome) return;
    url.searchParams.delete(AUTH_LINK_PARAM);
    window.history.replaceState(
      null,
      '',
      `${url.pathname}${url.search}${url.hash}`
    );
    void reportLinkOutcome(outcome);
  }, [reportLinkOutcome]);

  const userId = session?.user.id ?? null;
  // Ask the server who this account is linked to, rather than trusting the
  // session's own snapshot. That snapshot is what made a completed link look
  // unfinished: the panel kept offering "Link GitHub" for an identity that was
  // already there, and signing out and back in did not shake it loose.
  useEffect(() => {
    if (!userId) return;
    void refreshIdentities();
  }, [userId, refreshIdentities]);

  const github = findGithub(identities ?? session?.user.identities);

  async function linkGithub() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      // Ask the server before starting a flow. A link that already succeeded
      // still renders as unlinked while the session's snapshot is stale, so
      // the button that looks like the fix is the one that fails — which is
      // exactly how an operator ended up reading `Identity is already linked`.
      if (await refreshIdentities()) {
        setMessage(LINK_SUCCESS_MESSAGES.already_linked);
        setBusy(false);
        return;
      }
      linkInFlight.current = true;
      if (window.electron?.auth) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey)
          throw new Error('Authentication is not configured.');
        // Main builds its own Supabase client and has no session of its own,
        // and `linkIdentity` refuses without one. Read it fresh rather than
        // from state so a token refreshed since mount is the one that travels.
        const { data: live } = await supabase.auth.getSession();
        if (!live.session) {
          throw new Error('Auth session missing. Sign in again.');
        }
        await window.electron.auth.linkGithub({
          supabaseUrl,
          supabaseAnonKey,
          redirectTo: `${window.location.origin}/auth/electron-callback`,
          session: {
            accessToken: live.session.access_token,
            refreshToken: live.session.refresh_token,
          },
        });
      } else {
        const callback = new URL('/auth/callback', window.location.origin);
        callback.searchParams.set(AUTH_INTENT_PARAM, 'link');
        // The attempt returns to the surface that started it. The route
        // validates this against open redirects and falls back on its own.
        callback.searchParams.set('next', window.location.pathname);
        const { error: linkError } = await supabase.auth.linkIdentity({
          provider: 'github',
          options: { redirectTo: callback.toString() },
        });
        if (linkError) throw linkError;
      }
    } catch (cause) {
      // The provider's own words stay diagnosable here and are never rendered.
      console.error('[operator-stats] GitHub link failed', cause);
      await reportLinkOutcome(classifyLinkOutcome(cause));
      return;
    }
    setBusy(false);
  }

  async function setPublishing(next: boolean) {
    const bridge = window.electron?.settings;
    if (!bridge?.setOperatorAutoPublish) return;
    setError(null);
    setMessage(null);
    try {
      await bridge.setOperatorAutoPublish(next);
      setAutoPublish(next);
      // Enabling is the moment the operator expects the profile to appear or
      // refresh. The executor re-checks the preference and coalesces with any
      // scheduled trigger, so this can never double-post.
      if (next) void runOperatorStatsSync();
    } catch {
      // A refused write leaves the switch showing the state that is real.
    }
  }

  async function removeProfile() {
    if (!session) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const response = await fetch('/api/operator-stats', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    if (response.ok) {
      localStorage.removeItem(OPERATOR_STATS_ENABLED_KEY);
      setPublished(false);
      // Removal pauses publishing too — a scheduled sync must never
      // resurrect a profile the operator just took down. Re-enabling the
      // switch is the explicit republish path.
      try {
        await window.electron?.settings?.setOperatorAutoPublish?.(false);
        setAutoPublish(false);
      } catch {
        // The preference write failing leaves the switch honest on refresh.
      }
      setMessage('Public profile removed. Local history was not changed.');
      window.setTimeout(() => window.location.reload(), 700);
    } else {
      setError('Profile could not be removed.');
    }
    setBusy(false);
  }

  if (inDemoWorkspace) {
    return (
      <aside className={styles.publishPanel}>
        <div>
          <h2>Demo operator profile</h2>
          <p>
            Demo Mode exercises this public arena without scanning or publishing
            personal harness data. Switch to the Personal Workspace to publish
            your real aggregate.
          </p>
        </div>
        <button type="button" className={styles.buttonQuiet} disabled>
          Publishing disabled in Demo
        </button>
      </aside>
    );
  }

  if (!session) {
    return (
      <aside className={styles.publishPanel}>
        <div>
          <h2>Put your fleet on the board</h2>
          <p>
            Public profiles are opt-in. Sign in, link GitHub, and turn on
            publishing when you are ready.
          </p>
        </div>
        <a className={styles.button} href="/sign-in">
          Sign in
        </a>
      </aside>
    );
  }

  if (!github) {
    return (
      <aside className={styles.publishPanel}>
        <div>
          <h2>Claim your operator identity</h2>
          <p>
            GitHub seeds your public handle and avatar. The profile model is
            provider-neutral.
          </p>
          {autoPublish && (
            <p className={styles.syncStatus} data-sync-state="waiting-for-link">
              Publishing is on and waiting for GitHub. Syncing resumes once
              your account is linked.
            </p>
          )}
          {message && (
            <p className={styles.success} role="status" data-panel-status="success">
              {message}
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert" data-panel-status="error">
              {error}
            </p>
          )}
        </div>
        <button
          type="button"
          className={styles.button}
          disabled={busy}
          onClick={linkGithub}
        >
          Link GitHub
        </button>
      </aside>
    );
  }

  if (!inElectron) {
    return (
      <aside className={styles.publishPanel}>
        <div>
          <h2>Publish from Exawatt desktop</h2>
          <p>
            The local app derives aggregates on your machine. Harness logs never
            pass through this website.
          </p>
          {message && (
            <p className={styles.success} role="status" data-panel-status="success">
              {message}
            </p>
          )}
          {error && (
            <p className={styles.error} role="alert" data-panel-status="error">
              {error}
            </p>
          )}
        </div>
      </aside>
    );
  }

  const syncing = sync.phase === 'syncing';
  const statusLine = !autoPublish
    ? published
      ? 'Paused — your profile stays visible and stops updating.'
      : null
    : syncing
      ? 'Syncing…'
      : sync.lastOutcome === 'failed'
        ? 'Sync failed — retries automatically.'
        : sync.lastSyncedAt
          ? `Up to date · synced ${formatSyncedAt(sync.lastSyncedAt)}`
          : 'Publishing on — first sync runs shortly.';
  const syncState = !autoPublish
    ? 'paused'
    : syncing
      ? 'syncing'
      : sync.lastOutcome === 'failed'
        ? 'failed'
        : sync.lastSyncedAt
          ? 'synced'
          : 'waiting';

  return (
    <aside className={styles.publishPanel}>
      <div>
        <h2>
          {published
            ? 'Your public operator profile'
            : 'Publish your operator profile'}
        </h2>
        {statusLine && (
          <p className={styles.syncStatus} data-sync-state={syncState}>
            {statusLine}
          </p>
        )}
        {autoPublish && sync.lastSnapshot && (
          <p>
            {sync.lastSnapshot.runs} Runs ·{' '}
            {formatAgentHoursLong(sync.lastSnapshot.agentMs)} ·{' '}
            {formatTokens(sync.lastSnapshot.normalizedTokens)} tokens used
          </p>
        )}
        {/* The first-consent disclosure. Only before the first publish: a
            paused owner already consented, and for him "recording starts when
            you turn it on" would be false — resuming uploads from the
            original consent anchor. */}
        {!autoPublish && !published && (
          <p className={styles.disclosure}>
            Turning publishing on shares aggregate daily totals and Run records
            — agent hours, fleet size, durations, and token counts — under your
            GitHub handle, name, and avatar. Prompts, responses, code, Project
            names, and file paths never leave this machine. Recording starts
            when you turn it on; earlier local history is not uploaded.
          </p>
        )}
        {message && (
          <p className={styles.success} role="status" data-panel-status="success">
            {message}
          </p>
        )}
        {error && (
          <p className={styles.error} role="alert" data-panel-status="error">
            {error}
          </p>
        )}
      </div>
      <div className={styles.publishActions}>
        {published && (
          <button
            type="button"
            className={styles.buttonQuiet}
            disabled={busy}
            onClick={removeProfile}
          >
            Remove public profile
          </button>
        )}
        {autoPublish && (
          <button
            type="button"
            className={styles.buttonQuiet}
            disabled={syncing}
            onClick={() => void runOperatorStatsSync()}
          >
            Sync now
          </button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={autoPublish}
          className={styles.publishSwitch}
          data-publishing={autoPublish ? 'on' : 'paused'}
          onClick={() => void setPublishing(!autoPublish)}
        >
          <span className={styles.switchTrack} aria-hidden="true">
            <span className={styles.switchThumb} />
          </span>
          {autoPublish ? 'Publishing on' : 'Publishing paused'}
        </button>
      </div>
    </aside>
  );
}
