/**
 * ENG-030 OS0.3 — the closed failure channel between `/auth/callback` and
 * `/sign-in`.
 *
 * The callback reports a failed landing as one of these codes, and this module
 * owns every word the sign-in page then shows. A crafted `/sign-in?error=…`
 * can therefore only select among sentences written here; it can never print
 * attacker text inside the product's own sign-in card.
 *
 * This lives outside both files on purpose. Next.js restricts what a `page.tsx`
 * or a `route.ts` may export — arbitrary values there fail the production build
 * (error 71002) even though `tsc` accepts them. Shared contracts between an
 * entry pair belong in a module like this one.
 */

export const AUTH_CALLBACK_FAILURES = [
  /** The identity provider itself refused, before any code exchange. */
  'provider_refused',
  /** The callback carried no authorization code at all. */
  'missing_code',
  /** The exchange threw — typically the network or the auth host. */
  'exchange_failed',
  /** The exchange completed and returned an error: stale or reused link. */
  'exchange_rejected',
] as const;

export type AuthCallbackFailure = (typeof AUTH_CALLBACK_FAILURES)[number];

export function isAuthCallbackFailure(
  value: unknown
): value is AuthCallbackFailure {
  return (AUTH_CALLBACK_FAILURES as readonly unknown[]).includes(value);
}

export const CALLBACK_FAILURE_MESSAGES: Record<AuthCallbackFailure, string> = {
  provider_refused:
    'Sign-in was declined. Try again, or use your email and password.',
  missing_code: 'This sign-in link is incomplete. Request a new one.',
  exchange_failed: 'Sign-in couldn’t reach the server. Try again.',
  exchange_rejected: 'This sign-in link is no longer valid. Request a new one.',
};

/** Shown for any code this page does not recognize, including a forged one. */
export const GENERIC_CALLBACK_FAILURE = 'Sign-in didn’t complete. Try again.';

/* -------------------------------------------------------------------------
 * Identity linking (ENG-035 A2 review fix)
 *
 * Linking GitHub to an account you are ALREADY SIGNED IN TO is not a sign-in
 * attempt, and it broke twice in one click for a real operator: the callback
 * dropped him on `/sign-in` — a signed-in user asked to sign in again — and
 * printed Supabase's own words, `Identity is already linked`, as a red error
 * under the password field. Neither half was true. The attempt started on the
 * publish panel, so its verdict belongs there; and "already linked" is the
 * state he wanted, so it is a SUCCESS, not a failure.
 *
 * The callback therefore carries an intent, and a link attempt reports a
 * closed OUTCOME — successes included — back to the surface that started it.
 * ------------------------------------------------------------------------- */

/** What a callback was for. Decides which surface hears its verdict. */
export type AuthCallbackIntent = 'sign-in' | 'link';

/** Query parameter carrying the intent into `/auth/callback`. */
export const AUTH_INTENT_PARAM = 'intent';

/** Query parameter carrying a link outcome back to the publish surface. */
export const AUTH_LINK_PARAM = 'link';

/** Where a link attempt lands when `next` is missing or unsafe. */
export const LINK_RETURN_FALLBACK = '/leaderboard';

export function authCallbackIntent(value: unknown): AuthCallbackIntent {
  return value === 'link' ? 'link' : 'sign-in';
}

/** Ends with the identity on this account. Never rendered as an error. */
export const AUTH_LINK_SUCCESSES = [
  /** The identity was linked by this attempt. */
  'linked',
  /** It was already linked — the attempt was redundant, not failed. */
  'already_linked',
] as const;

export const AUTH_LINK_FAILURES = [
  /** The provider declined, or the operator cancelled at the provider. */
  'provider_refused',
  /** The provider account belongs to a different Exawatt account. */
  'link_claimed',
  /** The callback came back without anything to exchange. */
  'link_incomplete',
  /**
   * Linking needs a live session and there wasn't one. Distinct from
   * `link_failed` because "try again" is the wrong instruction for it — the
   * loop only breaks by signing in.
   */
  'link_signed_out',
  /** Everything else: the exchange threw, or was rejected. */
  'link_failed',
] as const;

export const AUTH_LINK_OUTCOMES = [
  ...AUTH_LINK_SUCCESSES,
  ...AUTH_LINK_FAILURES,
] as const;

export type AuthLinkSuccess = (typeof AUTH_LINK_SUCCESSES)[number];
export type AuthLinkFailure = (typeof AUTH_LINK_FAILURES)[number];
export type AuthLinkOutcome = AuthLinkSuccess | AuthLinkFailure;

export function isAuthLinkOutcome(value: unknown): value is AuthLinkOutcome {
  return (AUTH_LINK_OUTCOMES as readonly unknown[]).includes(value);
}

export function isAuthLinkSuccess(value: unknown): value is AuthLinkSuccess {
  return (AUTH_LINK_SUCCESSES as readonly unknown[]).includes(value);
}

export const LINK_SUCCESS_MESSAGES: Record<AuthLinkSuccess, string> = {
  linked: 'GitHub linked.',
  already_linked: 'GitHub is already linked.',
};

export const LINK_FAILURE_MESSAGES: Record<AuthLinkFailure, string> = {
  provider_refused: 'GitHub declined the connection. Try again.',
  link_claimed: 'That GitHub account is linked to another Exawatt account.',
  link_incomplete: 'GitHub returned an incomplete response. Try again.',
  link_signed_out: 'Your session expired. Sign in again to link GitHub.',
  link_failed: 'GitHub couldn’t be linked. Try again.',
};

/** Shown for any outcome the panel does not recognize, including a forged one. */
export const GENERIC_LINK_FAILURE = 'GitHub couldn’t be linked. Try again.';

export function linkOutcomeMessage(outcome: AuthLinkOutcome): string {
  return isAuthLinkSuccess(outcome)
    ? LINK_SUCCESS_MESSAGES[outcome]
    : LINK_FAILURE_MESSAGES[outcome];
}

/**
 * Reads whatever the provider said about a link attempt and returns one of our
 * own outcomes. The provider's text is INPUT here and never output: callers
 * render `linkOutcomeMessage`, and log the raw words server-side only.
 *
 * The one distinction worth the regex: Supabase answers `identity_already_exists`
 * both when the identity is already on YOUR account ("Identity is already
 * linked") and when it sits on someone else's ("Identity is already linked to
 * another user"). The first is the operator's goal; the second is a real dead
 * end that needs a different GitHub account. Only the message separates them.
 */
export function classifyLinkOutcome(cause: unknown): AuthLinkOutcome {
  const text = [readName(cause), readCode(cause), readMessage(cause)]
    .join(' ')
    .toLowerCase();

  if (/already\s+(been\s+)?linked\s+to\s+(another|a\s+different)/.test(text)) {
    return 'link_claimed';
  }
  if (
    /already\s+(been\s+)?linked/.test(text) ||
    /identity_already_exists|identity_already_linked/.test(text)
  ) {
    return 'already_linked';
  }
  // `linkIdentity` needs a live session. Without one, supabase-js answers
  // `AuthSessionMissingError`, and GoTrue answers 401 `no_authorization` —
  // both mean the same thing to the operator, and neither means "try again".
  if (
    /authsessionmissing|session\s+missing|session\s+expired|session_not_found|no_authorization|bearer\s+token|not\s+authenticated|sign\s+in\s+again/.test(
      text
    )
  ) {
    return 'link_signed_out';
  }
  if (/access_denied|denied|refused|declin|cancel|abort/.test(text)) {
    return 'provider_refused';
  }
  return 'link_failed';
}

function readName(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const record = cause as { name?: unknown };
    if (typeof record.name === 'string') return record.name;
  }
  return '';
}

function readMessage(cause: unknown): string {
  if (typeof cause === 'string') return cause;
  if (cause && typeof cause === 'object') {
    const record = cause as { message?: unknown };
    if (typeof record.message === 'string') return record.message;
  }
  return '';
}

function readCode(cause: unknown): string {
  if (cause && typeof cause === 'object') {
    const record = cause as { code?: unknown; error_code?: unknown };
    if (typeof record.code === 'string') return record.code;
    if (typeof record.error_code === 'string') return record.error_code;
  }
  return '';
}
