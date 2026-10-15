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

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { createOptionalClient } from '@/lib/supabase/client';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import { isAppRoute } from '@/components/nav/surfaces';
import { OUTBOUND_CONTROLS } from '@/lib/hosted-features/contract';

export const ACCOUNT_FIRST_RUN_STORAGE_KEY = 'exawatt:account-first-run';

/** What an account turns on, in the order the product surfaces them. */
const ACCOUNT_FEATURES = [
  // The first three are the hosted features; take their names from the one
  // contract that also names them on Settings → Privacy, so the invitation and
  // the switch cannot call the same thing different things.
  OUTBOUND_CONTROLS.contextLabels.label,
  OUTBOUND_CONTROLS.conversationSummaries.label,
  OUTBOUND_CONTROLS.goalVisuals.label,
  'Project sync across machines',
  'Sending feedback',
];

/**
 * Auth surfaces already are the invitation; never stack the card on them.
 *
 * `/settings` is here for a different reason, found in a visual pass: the card
 * is positioned top-right and floated over the Privacy section's switch
 * column, hiding the very controls it was describing. A surface that lets the
 * operator manage these features must not be covered by an ad for them.
 */
const SUPPRESSED_PREFIXES = ['/sign-in', '/sign-up', '/auth', '/settings'];

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

/**
 * One dismissal for every place the invitation renders: the floating card
 * and the Start screen's row read the same answer, so retiring one retires
 * both. Read from storage once, on the first client read.
 */
let dismissedState: boolean | null = null;
const dismissedListeners = new Set<() => void>();

function subscribeDismissed(listener: () => void): () => void {
  dismissedListeners.add(listener);
  return () => dismissedListeners.delete(listener);
}

function dismissedSnapshot(): boolean {
  if (dismissedState === null) dismissedState = readDismissed();
  return dismissedState;
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(ACCOUNT_FIRST_RUN_STORAGE_KEY, 'dismissed');
  } catch {
    // best effort; the in-memory dismissal still holds for this run
  }
  dismissedState = true;
  for (const listener of dismissedListeners) listener();
}

/** Test seam: forget the in-memory dismissal so storage is read again. */
export function resetAccountInvitationForTests(): void {
  dismissedState = null;
}

/**
 * Surfaces that carry the invitation in their own layout (the Start screen's
 * fourth row, ENG-046) register here while mounted; the floating card steps
 * aside for them, so the invitation never covers the cards it sits beside.
 */
let inlineHosts = 0;
const inlineHostListeners = new Set<() => void>();

function subscribeInlineHosts(listener: () => void): () => void {
  inlineHostListeners.add(listener);
  return () => inlineHostListeners.delete(listener);
}

function inlineHostPresent(): boolean {
  return inlineHosts > 0;
}

function useInlineHost(): void {
  useEffect(() => {
    inlineHosts += 1;
    for (const listener of inlineHostListeners) listener();
    return () => {
      inlineHosts -= 1;
      for (const listener of inlineHostListeners) listener();
    };
  }, []);
}

/** Whether the invitation should show, and the verb that retires it. */
function useAccountInvitation(): { visible: boolean; dismiss: () => void } {
  const [auth, setAuth] = useState<AuthState>('unknown');
  // hidden until storage has been read (the server snapshot is "dismissed"),
  // so a dismissed card never flashes
  const dismissed = useSyncExternalStore(
    subscribeDismissed,
    dismissedSnapshot,
    () => true
  );
  // the dev-evaluator preload marker: a floating invitation would sit on top
  // of the surfaces the deterministic Electron evals drive. Absent from the
  // production preload, so it can never hide the card from a real operator.
  const [underEvaluator, setUnderEvaluator] = useState(false);

  useEffect(() => {
    setUnderEvaluator(!!window.electron?.feedback?.testMode);
  }, []);

  useEffect(() => {
    const supabase = createOptionalClient(resolvedDistribution());
    if (!supabase) {
      setAuth('unavailable');
      return;
    }
    // INITIAL_SESSION and later auth changes share one ordered source. A
    // separate getSession read can settle after sign-out and retire this
    // invitation using an obsolete account (BUG-118).
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, session: Session | null) =>
        setAuth(session ? 'signed-in' : 'signed-out')
    );
    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);

  // signing in by any route settles the question for good
  useEffect(() => {
    if (auth === 'signed-in') writeDismissed();
  }, [auth]);

  const dismiss = useCallback(() => writeDismissed(), []);

  return {
    visible: !dismissed && !underEvaluator && auth === 'signed-out',
    dismiss,
  };
}

/**
 * The invitation as a row in a surface's own layout. The Start screen places
 * it under Try the Demo (operator, 2026-10-15), and while it is mounted the
 * floating card does not appear anywhere.
 */
export function AccountInvitationRow() {
  useInlineHost();
  const { visible, dismiss } = useAccountInvitation();
  if (!visible) return null;
  return (
    <section
      data-account-first-run
      data-account-invitation="row"
      aria-labelledby="account-invitation-heading"
      className="flex flex-col gap-3"
    >
      <div className="flex min-h-8 items-center">
        <h2
          id="account-invitation-heading"
          className="font-display text-base font-semibold text-[var(--exa-foundation-text)]"
        >
          Sign in to add hosted features
        </h2>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-[var(--exa-foundation-border)] px-3 py-2">
        <span className="flex min-w-0 flex-1 basis-64 flex-col">
          <span className="text-chrome-label text-[var(--exa-foundation-text)]">
            {ACCOUNT_FEATURES.join(' · ')}
          </span>
          <span className="text-chrome-meta text-[var(--exa-foundation-text-muted)]">
            Agents, Projects, and Demo Mode work without an account.
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" asChild onClick={dismiss}>
            <Link href="/sign-in" data-account-first-run-sign-in>
              Sign in
            </Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            data-account-first-run-dismiss
            onClick={dismiss}
          >
            Not now
          </Button>
        </span>
      </div>
    </section>
  );
}

export function AccountFirstRunCard() {
  const pathname = usePathname() ?? '';
  const { visible, dismiss } = useAccountInvitation();
  const hostedInline = useSyncExternalStore(
    subscribeInlineHosts,
    inlineHostPresent,
    () => false
  );

  if (!visible || hostedInline) return null;
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
