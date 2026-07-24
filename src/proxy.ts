import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

// Surfaces that render without a signed-in user. Everything the Electron
// shell navigates (workspace, fleet, settings, architecture) must be here:
// the local renderer has to work with the network down (ENG-016 D18), so
// public paths skip auth entirely instead of blocking on a Supabase
// round-trip whose result is discarded.
const PUBLIC_PREFIXES = [
  '/api/dev-identity',
  // Electron authenticates this bounded metadata endpoint with a bearer
  // token. The route validates it directly; cookie middleware would reject
  // the desktop request before that validation can happen.
  '/api/conversations',
  '/api/context-labels',
  '/api/feedback',
  '/api/oc',
  '/sign-in',
  '/sign-up',
  '/auth',
  '/architecture',
  '/fleet',
  '/hud-gallery',
  '/workspace',
  '/settings',
  '/eval',
  '/privacy',
  '/terms',
];

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/' ||
    PUBLIC_PREFIXES.some(prefix => pathname.startsWith(prefix))
  );
}

function hasAuthCookie(request: NextRequest): boolean {
  // Supabase stores the session in `sb-<ref>-auth-token` (possibly chunked).
  return request.cookies
    .getAll()
    .some(cookie => cookie.name.startsWith('sb-') && cookie.value !== '');
}

export async function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) {
    return NextResponse.next({ request });
  }

  // Signed out is decidable from cookies alone — no network.
  if (!hasAuthCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        // Bound the validation round-trip so a dead network degrades to
        // fail-open instead of hanging the navigation.
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(4000) }),
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    // Network failure with a session cookie present: fail open. The page's
    // own data loads surface the offline state; a redirect to sign-in here
    // would strand a signed-in user who is merely offline. (supabase-js
    // reports network failures as a retryable error, it does not throw.)
    if (!user && !isAuthRetryableFetchError(error)) {
      const url = request.nextUrl.clone();
      url.pathname = '/sign-in';
      return NextResponse.redirect(url);
    }
  } catch {
    // Unexpected throw (e.g. abort surfacing directly): same fail-open rule.
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ttf|woff|woff2|otf)$).*)',
  ],
};
