import { accountServerClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  AUTH_INTENT_PARAM,
  AUTH_LINK_PARAM,
  authCallbackIntent,
  classifyLinkOutcome,
  isAuthLinkSuccess,
  LINK_RETURN_FALLBACK,
  type AuthCallbackFailure,
  type AuthLinkOutcome,
} from '@/components/auth/callback-failures';

/**
 * OAuth / email-link landing route (ENG-030 OS0.3, extended by the ENG-035 A2
 * link fix).
 *
 * A callback that does not produce a session must SAY SO. The earlier version
 * discarded the result of `exchangeCodeForSession` and redirected to
 * `/workspace` either way, so a failed exchange was indistinguishable from a
 * successful one: the operator arrived at a signed-out workspace with no
 * explanation and nothing to act on. Every sign-in failure path now lands on
 * `/sign-in` carrying a failure code, which that page turns into copy it owns.
 *
 * The code is a CLOSED SET, never prose. The first version put the provider's
 * own message into `?error=`, and `/sign-in` rendered it. React escaped it, so
 * it was never script injection — but anyone could send a link that printed
 * two hundred arbitrary characters inside the product's own sign-in card
 * ("Your account is suspended, call 555-…"), on the one page where a user is
 * most primed to believe what it says. A crafted URL can now only pick among
 * the four codes below, all of whose text this product wrote. The provider's
 * real words stay diagnosable in the server log.
 *
 * A callback with `intent=link` is a DIFFERENT EVENT and never touches
 * `/sign-in`. Linking GitHub starts from the publish panel with a session
 * already in hand; sending its verdict to a sign-in form asks a signed-in
 * operator to sign in again and strands him away from what he was doing. Link
 * outcomes — including the successes — ride back to `next` on `?link=`, and
 * "already linked" is one of the successes: the operator wanted that identity
 * on his account, and it is.
 */

interface ExchangeResult {
  error: { message?: string | null; code?: string | null } | null;
}

export interface AuthCallbackDependencies {
  /**
   * `null` when the distribution ships no account service (BUG-044). There is
   * no identity provider to have sent anyone here, so the route reports that
   * it does not exist rather than exchanging a code against nothing.
   */
  createSupabaseClient: () => Promise<{
    auth: { exchangeCodeForSession: (code: string) => Promise<ExchangeResult> };
  } | null>;
  /**
   * Where the provider's own words go. Keeping the cause out of the URL only
   * costs nothing if the cause is still readable somewhere; a failure nobody
   * can explain is the defect OS0.3 exists to prevent.
   */
  logFailure: (
    code: AuthCallbackFailure | AuthLinkOutcome,
    detail: string
  ) => void;
}

const defaultDependencies: AuthCallbackDependencies = {
  createSupabaseClient: () => accountServerClient(),
  logFailure: (code, detail) => {
    console.error(
      detail ? `[auth/callback] ${code}: ${detail}` : `[auth/callback] ${code}`
    );
  },
};

/** Server logs only — long enough to diagnose, short enough to stay one line. */
const MAX_DETAIL_CHARS = 400;

/**
 * Normalizes whatever a failure path caught into one bounded log line. This
 * text never reaches the browser.
 */
export function callbackFailureDetail(cause: unknown): string {
  const raw =
    typeof cause === 'string'
      ? cause
      : cause && typeof cause === 'object' && 'message' in cause
        ? String((cause as { message?: unknown }).message ?? '')
        : '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_DETAIL_CHARS
    ? `${collapsed.slice(0, MAX_DETAIL_CHARS - 1)}…`
    : collapsed;
}

/**
 * `next` decides where the browser goes, so it is an open-redirect surface.
 * A leading `/` alone is not enough: the URL parser folds a backslash into a
 * slash for special schemes, so `/\evil.test` and a tab-spliced `/<TAB>/evil.test`
 * both resolve to a foreign origin. Anything but a plain, single-slash,
 * whitespace-free path falls back.
 */
export function safeNextPath(requested: string | null, fallback: string) {
  if (!requested) return fallback;
  if (!requested.startsWith('/') || requested.startsWith('//')) return fallback;
  if (/[\\\s]/.test(requested)) return fallback;
  for (const character of requested) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x20 || point === 0x7f) return fallback;
  }
  return requested;
}

function signInWithFailure(
  origin: string,
  code: AuthCallbackFailure,
  cause: unknown,
  logFailure: AuthCallbackDependencies['logFailure']
): NextResponse {
  logFailure(code, callbackFailureDetail(cause));
  const target = new URL('/sign-in', origin);
  target.searchParams.set('error', code);
  return NextResponse.redirect(target.toString());
}

/**
 * A link attempt reports where it started. `next` is already validated, so the
 * only thing added to it is one closed outcome token.
 */
function returnFromLink(
  origin: string,
  next: string,
  outcome: AuthLinkOutcome,
  cause: unknown,
  logFailure: AuthCallbackDependencies['logFailure']
): NextResponse {
  // Successes are the expected shape of this flow — nothing to diagnose.
  if (!isAuthLinkSuccess(outcome)) {
    logFailure(outcome, callbackFailureDetail(cause));
  }
  const target = new URL(next, origin);
  target.searchParams.set(AUTH_LINK_PARAM, outcome);
  return NextResponse.redirect(target.toString());
}

export async function handleAuthCallback(
  request: Request,
  dependencies: Partial<AuthCallbackDependencies> = {}
): Promise<Response> {
  const { createSupabaseClient, logFailure } = {
    ...defaultDependencies,
    ...dependencies,
  };

  // Resolved before anything is interpreted: without an account service this
  // landing route has no reason to exist, and every branch below — including
  // the ones that only redirect — describes an event that cannot have
  // happened. Reporting 404 is the honest answer; inventing a sign-in failure
  // would send the operator to a page this distribution does not ship.
  const supabase = await createSupabaseClient();
  if (!supabase) {
    return new NextResponse(null, { status: 404 });
  }

  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const intent = authCallbackIntent(
    requestUrl.searchParams.get(AUTH_INTENT_PARAM)
  );
  const linking = intent === 'link';
  const next = safeNextPath(
    requestUrl.searchParams.get('next'),
    linking ? LINK_RETURN_FALLBACK : '/workspace'
  );

  // The identity provider reports its own refusals here, before any exchange.
  const providerError =
    requestUrl.searchParams.get('error_description') ||
    requestUrl.searchParams.get('error');
  if (providerError) {
    if (linking) {
      const cause = {
        message: providerError,
        code: requestUrl.searchParams.get('error_code'),
      };
      return returnFromLink(
        origin,
        next,
        classifyLinkOutcome(cause),
        providerError,
        logFailure
      );
    }
    return signInWithFailure(
      origin,
      'provider_refused',
      providerError,
      logFailure
    );
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    if (linking) {
      return returnFromLink(
        origin,
        next,
        'link_incomplete',
        'callback carried no authorization code',
        logFailure
      );
    }
    return signInWithFailure(
      origin,
      'missing_code',
      'callback carried no authorization code',
      logFailure
    );
  }

  let result: ExchangeResult;
  try {
    result = await supabase.auth.exchangeCodeForSession(code);
  } catch (thrown) {
    if (linking) {
      return returnFromLink(
        origin,
        next,
        classifyLinkOutcome(thrown),
        thrown,
        logFailure
      );
    }
    return signInWithFailure(origin, 'exchange_failed', thrown, logFailure);
  }

  if (result.error) {
    if (linking) {
      return returnFromLink(
        origin,
        next,
        classifyLinkOutcome(result.error),
        result.error,
        logFailure
      );
    }
    return signInWithFailure(
      origin,
      'exchange_rejected',
      result.error,
      logFailure
    );
  }

  if (linking) {
    return returnFromLink(origin, next, 'linked', null, logFailure);
  }
  return NextResponse.redirect(`${origin}${next}`);
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthCallback(request);
}
