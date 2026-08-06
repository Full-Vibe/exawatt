import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

/**
 * OAuth / email-link landing route (ENG-030 OS0.3).
 *
 * A callback that does not produce a session must SAY SO. The earlier version
 * discarded the result of `exchangeCodeForSession` and redirected to
 * `/workspace` either way, so a failed exchange was indistinguishable from a
 * successful one: the operator arrived at a signed-out workspace with no
 * explanation and nothing to act on. Every failure path now lands on
 * `/sign-in` carrying the reason, which that page renders.
 */

interface ExchangeResult {
  error: { message?: string | null } | null;
}

export interface AuthCallbackDependencies {
  createSupabaseClient: () => Promise<{
    auth: { exchangeCodeForSession: (code: string) => Promise<ExchangeResult> };
  }>;
}

const defaultDependencies: AuthCallbackDependencies = {
  createSupabaseClient: () => createClient(),
};

/** The sign-in page renders this verbatim; keep it a single bounded line. */
const MAX_REASON_CHARS = 200;

const GENERIC_FAILURE = 'Sign-in did not complete. Try again.';

export function describeCallbackFailure(reason: unknown): string {
  const raw =
    typeof reason === 'string'
      ? reason
      : reason && typeof reason === 'object' && 'message' in reason
        ? String((reason as { message?: unknown }).message ?? '')
        : '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (!collapsed) return GENERIC_FAILURE;
  return collapsed.length > MAX_REASON_CHARS
    ? `${collapsed.slice(0, MAX_REASON_CHARS - 1)}…`
    : collapsed;
}

function signInWithReason(origin: string, reason: unknown): NextResponse {
  const target = new URL('/sign-in', origin);
  target.searchParams.set('error', describeCallbackFailure(reason));
  return NextResponse.redirect(target.toString());
}

export async function handleAuthCallback(
  request: Request,
  dependencies: AuthCallbackDependencies = defaultDependencies
): Promise<Response> {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const requestedNext = requestUrl.searchParams.get('next');
  const next =
    requestedNext?.startsWith('/') && !requestedNext.startsWith('//')
      ? requestedNext
      : '/workspace';

  // The identity provider reports its own refusals here, before any exchange.
  const providerError =
    requestUrl.searchParams.get('error_description') ||
    requestUrl.searchParams.get('error');
  if (providerError) return signInWithReason(origin, providerError);

  const code = requestUrl.searchParams.get('code');
  if (!code) {
    return signInWithReason(
      origin,
      'That sign-in link carried no authorization code. Request a new one.'
    );
  }

  let result: ExchangeResult;
  try {
    const supabase = await dependencies.createSupabaseClient();
    result = await supabase.auth.exchangeCodeForSession(code);
  } catch (thrown) {
    return signInWithReason(origin, thrown);
  }

  if (result.error) return signInWithReason(origin, result.error);

  return NextResponse.redirect(`${origin}${next}`);
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthCallback(request);
}
