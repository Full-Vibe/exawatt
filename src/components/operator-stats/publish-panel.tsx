'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { OperatorStatsPublishPayload } from '@exawatt/core';
import { createClient } from '@/lib/supabase/client';
import { useOptionalWorkspaceTenancy } from '@/lib/tenancy/tenancy-provider';
import { formatAgentHours, formatTokens } from './format';
import styles from './operator-stats.module.css';

const START_KEY = 'exawatt.operator-stats.started-at.v1';
const ENABLED_KEY = 'exawatt.operator-stats.enabled.v1';

type LocalPreview = Pick<
  OperatorStatsPublishPayload,
  'schemaVersion' | 'consentVersion' | 'enabled' | 'timezone' | 'days' | 'runs'
>;

function linkedGithub(session: Session | null) {
  return (
    session?.user.identities?.find(
      identity => identity.provider === 'github'
    ) ?? null
  );
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
  const [inElectron, setInElectron] = useState(false);
  const [preview, setPreview] = useState<LocalPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      void supabase.auth.getSession().then(({ data: next }) => {
        setSession(next.session);
        window.location.reload();
      });
    });
    return () => {
      data.subscription.unsubscribe();
      offElectron?.();
    };
  }, [supabase]);

  const github = linkedGithub(session);
  const totalAgentMs =
    preview?.days.reduce((sum, day) => sum + day.agentMs, 0) ?? 0;
  const totalTokens =
    preview?.days.reduce((sum, day) => sum + day.normalizedTokens, 0) ?? 0;

  async function linkGithub() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    try {
      if (window.electron?.auth) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!supabaseUrl || !supabaseAnonKey)
          throw new Error('Authentication is not configured.');
        await window.electron.auth.linkGithub({
          supabaseUrl,
          supabaseAnonKey,
          redirectTo: `${window.location.origin}/auth/electron-callback`,
        });
      } else {
        const { error: linkError } = await supabase.auth.linkIdentity({
          provider: 'github',
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=/agentmaxxing`,
          },
        });
        if (linkError) throw linkError;
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'GitHub could not be linked.'
      );
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
          {error && <p className={styles.error}>{error}</p>}
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
              {preview.runs.length} Runs · {formatAgentHours(totalAgentMs)}{' '}
              command · {formatTokens(totalTokens)} normalized tokens
            </p>
            <p className={styles.disclosure}>
              Uploads only your GitHub-seeded profile, timezone, daily totals,
              and aggregate Run records. Never prompts, responses, code,
              repositories, Projects, branches, paths, filenames, diffs, or
              local Session ids.
            </p>
          </>
        )}
        {message && <p className={styles.success}>{message}</p>}
        {error && <p className={styles.error}>{error}</p>}
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
