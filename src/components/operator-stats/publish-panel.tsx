'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, UserIdentity } from '@supabase/supabase-js';
import type { OperatorStatsPublishPayload } from '@exawatt/core';
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
import { formatAgentHoursLong, formatTokens } from './format';
import styles from './operator-stats.module.css';

const START_KEY = 'exawatt.operator-stats.started-at.v1';
const ENABLED_KEY = 'exawatt.operator-stats.enabled.v1';

type LocalPreview = Pick<
  OperatorStatsPublishPayload,
  'schemaVersion' | 'consentVersion' | 'enabled' | 'timezone' | 'days' | 'runs'
>;

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
  const [preview, setPreview] = useState<LocalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The desktop error channel is shared with sign-in. Only a link this panel
  // started is this panel's to report.
  const linkInFlight = useRef(false);

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
    setEnabled(localStorage.getItem(ENABLED_KEY) === 'true');
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
  const totalAgentMs =
    preview?.days.reduce((sum, day) => sum + day.agentMs, 0) ?? 0;
  const totalTokens =
    preview?.days.reduce((sum, day) => sum + day.normalizedTokens, 0) ?? 0;

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

  async function scan() {
    const api = window.electron?.operatorStats;
    if (!api) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let since = localStorage.getItem(START_KEY);
      if (!since) {
        since = new Date().toISOString();
        localStorage.setItem(START_KEY, since);
      }
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      setPreview(await api.scan(since, timezone));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Local stats could not be read.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!supabase || !session || !preview || !github) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    const data = github.identity_data ?? {};
    const handle = String(data.user_name ?? data.preferred_username ?? '');
    try {
      const response = await fetch('/api/operator-stats', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${session.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          ...preview,
          identity: {
            provider: 'github',
            providerHandle: handle,
            handle: handle.toLowerCase(),
            displayName: String(data.full_name ?? data.name ?? handle),
            avatarUrl:
              typeof data.avatar_url === 'string' ? data.avatar_url : null,
            links: [`https://github.com/${handle}`],
          },
        }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? 'Profile could not be published.');
      localStorage.setItem(ENABLED_KEY, 'true');
      setEnabled(true);
      setMessage('Public profile synced. You are on the board.');
      window.setTimeout(() => window.location.reload(), 700);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Profile could not be published.'
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!session) return;
    setBusy(true);
    setError(null);
    const response = await fetch('/api/operator-stats', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    if (response.ok) {
      localStorage.removeItem(ENABLED_KEY);
      setEnabled(false);
      setPreview(null);
      setMessage('Public profile disabled. Local history was not changed.');
      window.setTimeout(() => window.location.reload(), 700);
    } else {
      setError('Profile could not be disabled.');
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
            personal harness data. Switch to the Personal Workspace to preview
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
            Public profiles are opt-in. Sign in, link GitHub, then choose
            exactly when recording begins.
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

  return (
    <aside className={styles.publishPanel}>
      <div>
        <h2>
          {enabled
            ? 'Your public operator profile'
            : 'Publish your operator profile'}
        </h2>
        {!preview ? (
          <p>
            No scan happens until you ask. Recording starts now—earlier local
            history is not backfilled.
          </p>
        ) : (
          <>
            <p>
              {preview.runs.length} Runs · {formatAgentHoursLong(totalAgentMs)}{' '}
              · {formatTokens(totalTokens)} tokens used
            </p>
            <p className={styles.disclosure}>
              Uploads only your GitHub-seeded profile, timezone, daily totals,
              and aggregate Run records. Never prompts, responses, code,
              repositories, Projects, branches, paths, filenames, diffs, or
              local Session ids.
            </p>
          </>
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
        {enabled && (
          <button
            type="button"
            className={styles.buttonQuiet}
            disabled={busy}
            onClick={disable}
          >
            Disable
          </button>
        )}
        <button
          type="button"
          className={styles.buttonQuiet}
          disabled={busy}
          onClick={scan}
        >
          {preview ? 'Refresh preview' : 'Preview local stats'}
        </button>
        {preview && (
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={publish}
          >
            {enabled ? 'Sync now' : 'Publish my profile'}
          </button>
        )}
      </div>
    </aside>
  );
}
