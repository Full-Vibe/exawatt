'use client';

/**
 * First-run account invitation (ENG-030 OS0.1).
 *
 * An invited operator ran 0.1.8 for two days with no account and silently lost
 * every hosted feature, because nothing on any surface named them. This card
 * names them once.
 *
 * It is an INVITATION, NEVER A GATE: no modal, no scrim, no interstitial, no
 * focus trap, and no second appearance. Local Agent operation and Demo Mode
 * stay fully usable without an account (ENG-030 OS0), so any interaction —
 * taking the invitation, declining it, or signing in by another route —
 * retires the card permanently.
 *
 * Design-system rungs (docs/engineering/design-system.md): `exa-material-
 * overlay` for the floating material, `rounded-lg` panel radius, `px-5 py-4`
 * reading-card padding, `text-chrome-title` panel title, `text-chrome-label`
 * list rows, one `text-chrome-meta` caption at the prose ceiling, and the
 * single shadcn button recipe (`default` for the one primary action,
 * `outline` neutral). No new color channel, no motion.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { isAppRoute } from '@/components/nav/surfaces';

export const ACCOUNT_FIRST_RUN_STORAGE_KEY = 'exawatt:account-first-run';

/** What an account turns on, in the order the product surfaces them. */
const ACCOUNT_FEATURES = [
  'Session context labels',
  'Conversation summaries',
  'Goal visuals',
  'Project sync across machines',
  'Sending feedback',
];

/** Auth surfaces already are the invitation; never stack the card on them. */
const SUPPRESSED_PREFIXES = ['/sign-in', '/sign-up', '/auth'];

type AuthState = 'unknown' | 'signed-out' | 'signed-in' | 'unavailable';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(ACCOUNT_FIRST_RUN_STORAGE_KEY) !== null;
  } catch {
    // storage denied — treat as dismissed rather than risk a card that
    // cannot be turned off
    return true;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(ACCOUNT_FIRST_RUN_STORAGE_KEY, 'dismissed');
  } catch {
    // best effort; the in-memory dismissal still holds for this run
  }
}

export function AccountFirstRunCard() {
  const pathname = usePathname() ?? '';
  const [auth, setAuth] = useState<AuthState>('unknown');
  // hidden until storage has been read, so a dismissed card never flashes
  const [dismissed, setDismissed] = useState(true);
  // the dev-evaluator preload marker: a floating invitation would sit on top
  // of the surfaces the deterministic Electron evals drive. Absent from the
  // production preload, so it can never hide the card from a real operator.
  const [underEvaluator, setUnderEvaluator] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed());
    setUnderEvaluator(!!window.electron?.feedback?.testMode);
  }, []);

  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      // a missing or misconfigured Supabase env means there is no account to
      // invite anyone to; stay silent
      setAuth('unavailable');
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAuth(data.session ? 'signed-in' : 'signed-out');
    });
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) =>
        setAuth(session ? 'signed-in' : 'signed-out')
    );
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  // signing in by any route settles the question for good
  useEffect(() => {
    if (auth === 'signed-in') {
      writeDismissed();
      setDismissed(true);
    }
  }, [auth]);

  const dismiss = useCallback(() => {
    writeDismissed();
    setDismissed(true);
  }, []);

  if (dismissed || underEvaluator || auth !== 'signed-out') return null;
  if (SUPPRESSED_PREFIXES.some(prefix => pathname.startsWith(prefix))) {
    return null;
  }
  // product surfaces only — home and the public Architecture map own their
  // whole presentation (design system, public exhibition boundary)
  if (!isAppRoute(pathname)) return null;

  return (
    <aside
      data-account-first-run
      aria-label="Account features"
      className="exa-material-overlay fixed top-14 right-4 z-[90] w-80 max-w-[calc(100%-2rem)] rounded-lg border border-[var(--exa-foundation-border-strong)] px-5 py-4 shadow-lg"
    >
      <h2 className="text-chrome-title font-semibold text-[var(--exa-foundation-text)]">
        Sign in to add hosted features
      </h2>
      <ul className="mt-3 list-disc space-y-1 ps-4 text-chrome-label text-[var(--exa-foundation-text)] marker:text-[var(--exa-foundation-text-muted)]">
        {ACCOUNT_FEATURES.map(feature => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <p className="mt-3 text-chrome-meta text-[var(--exa-foundation-text-muted)]">
        Agents, Projects, and Demo Mode work without an account.
      </p>
      <div className="mt-4 flex items-center gap-2">
        <Button size="sm" asChild onClick={dismiss}>
          <Link href="/sign-in" data-account-first-run-sign-in>
            Sign in
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          type="button"
          data-account-first-run-dismiss
          onClick={dismiss}
        >
          Not now
        </Button>
      </div>
    </aside>
  );
}
