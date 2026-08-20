import { createServerClient } from '@supabase/ssr';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { resolvedDistribution } from '@/lib/distribution/resolved';

// Surfaces that render without a signed-in user. Everything the Electron
// shell navigates (workspace, fleet, settings, architecture) must be here:
// the local renderer has to work with the network down (ENG-016 D18), so
// public paths skip auth entirely instead of blocking on a Supabase
// round-trip whose result is discarded.
const PUBLIC_PREFIXES = [
  // ENG-030 OS1.1 / decision `0034`: the analytics reverse proxy. It is a
  // rewrite in `next.config.ts`, not a route, so without this entry the auth
  // gate answers every ingest request with a 307 to /sign-in and analytics
  // collect exactly nothing — silently, because emission is fire-and-forget
  // by design. Caught in production verification 2026-08-06; the whole point
  // of the proxy is that the desktop client can reach it while signed out.
  '/ingest',
  '/api/dev-identity',
  // Electron authenticates these bounded endpoints with a bearer token. Each
  // route validates it directly; cookie middleware would reject the desktop
  // request before that validation can happen.
  //
  // These prefixes, and `/download` below, name routes the COMPANY OVERLAY
  // supplies (ENG-030 WP3): a public checkout has no implementation behind
  // them and Next answers 404, while an `official-web` composition serves
  // them. The exemption is stated here rather than derived from the resolved
  // contract on purpose — a prefix that goes missing puts the auth gate in
  // front of a bearer-authenticated hosted route, which is an outage; a prefix
  // with no route behind it costs nothing.
  '/api/conversations',
  '/api/context-labels',
  '/api/feedback',
  '/api/goal-visuals',
  // Bearer-authenticated aggregate sync. The route owns auth and its strict
  // payload boundary; public leaderboard reads use Supabase's allowlisted RPCs.
  '/api/operator-stats',
  '/api/oc',
  '/sign-in',
  '/sign-up',
  '/auth',
  '/architecture',
  '/leaderboard',
  // Hackathon toy (temporary): simulates a small X/Twitter population from a
  // public profile. No user data involved; the API route it depends on must
  // stay public too or client-side fetches 307 to /sign-in.
  '/world',
  '/api/world',
  // Retired route: keep it outside the auth gate so Next returns the intended
  // 404 instead of redirecting signed-out visitors to /sign-in.
  '/agentmaxxing',
  '/operator',
  '/run',
  // only /fleet/spatial exists — the broader /fleet prefix died with the
  // legacy trio (decision 0023); keep the public surface exactly as wide as
  // the routes it serves
  '/fleet/spatial',
  '/hud-gallery',
  // ENG-031 W5. The next homepage, at an address the operator can send someone
  // while it is under review. Signed-out by definition: it is a marketing
  // surface, and bouncing a reviewer to /sign-in is both the bug that produced
  // this route and a thing public surfaces must never do. Noindexed in its own
  // segment metadata; retires when the bands flip to `shipped` and `/` renders
  // them.
  '/v2',
  '/workspace',
  '/settings',
  // ENG-008. Electron-navigable and demo-sourced: it reads nothing but its
  // own in-process demo corpus, so gating it would only break the offline
  // renderer and the demos this surface exists for. Renamed from
  // /consumption 2026-08-03 (operator: hard cut, the old path 404s).
  '/usage',
  // ENG-026 N1 preview surfaces: Electron-navigable shells that read no user
  // data at all — same offline argument as /usage.
  '/organization',
  '/cloud',
  '/coordination',
  '/agent-types',
  '/eval',
  '/privacy',
  '/terms',
  // Crawler-facing metadata routes (`src/app/robots.ts`, `src/app/sitemap.ts`).
  // A robots.txt behind an auth redirect is a robots.txt no crawler ever
  // reads, and the noindex directives it coordinates with are what keep app
  // chrome out of search results. Neither route reads user data.
  '/robots.txt',
  '/sitemap.xml',
  // Public desktop download (decision 0021, 2026-08-14 amendment). Reachable
  // signed out by design: someone taking the app has no account yet, and
  // bouncing them to /sign-in would both break the flow and contradict the
  // marketing canon that public surfaces never promote sign-in.
  '/download',
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

  // A stale cookie can survive a switch from the official distribution to a
  // Community build. It is not authority to reconstruct account transport
  // from ambient env: the resolved contract is the only capability switch.
  const account = resolvedDistribution().account;
  if (!account) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    return NextResponse.redirect(url);
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    account.supabaseUrl,
    account.supabaseAnonKey,
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
