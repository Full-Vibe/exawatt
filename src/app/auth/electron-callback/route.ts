import { NextResponse } from 'next/server';
import { distributionCapabilities } from '@/lib/distribution/capabilities';
import { resolvedDistribution } from '@/lib/distribution/resolved';
import {
  AUTH_INTENT_PARAM,
  AUTH_LINK_PARAM,
  authCallbackIntent,
  classifyLinkOutcome,
  isAuthLinkSuccess,
  type AuthLinkOutcome,
} from '@/components/auth/callback-failures';

/**
 * Desktop landing route: the system browser ends here, and the desktop app
 * gets the result over the `exawatt://` deep link.
 *
 * A GitHub link attempt that Supabase refuses comes back with NO CODE — only
 * `?error=…&error_description=…`. The first version answered that with a 400
 * page in a browser tab the operator had already stopped looking at, and told
 * the app nothing at all, so the publish panel sat there as if nothing had
 * happened. A link callback now relays a closed OUTCOME instead, successes
 * included: `already linked` is the state the operator wanted, and the panel
 * is the surface that says so.
 *
 * The provider's own words never ride the deep link — any local process can
 * see it — only one token from the closed set.
 */

export function handleElectronCallback(
  request: Request,
  logFailure: (outcome: AuthLinkOutcome, detail: string) => void = (
    outcome,
    detail
  ) => {
    console.error(
      detail
        ? `[auth/electron-callback] ${outcome}: ${detail}`
        : `[auth/electron-callback] ${outcome}`
    );
  },
  accountConfigured: boolean = distributionCapabilities(resolvedDistribution())
    .account
): Response {
  // No account service means no identity provider sent anyone here, and no
  // `exawatt://` handler is registered to receive the relay either (BUG-044).
  // A page that says "returning to Exawatt" would be describing a journey that
  // cannot complete.
  if (!accountConfigured) return new NextResponse(null, { status: 404 });

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    // Don't exchange the code here — the PKCE code verifier lives in the
    // Electron main process.  Relay the code back via deep link so the app
    // can exchange it itself.
    return relay(`exawatt://auth/callback?code=${encodeURIComponent(code)}`);
  }

  const linking =
    authCallbackIntent(requestUrl.searchParams.get(AUTH_INTENT_PARAM)) ===
    'link';
  if (!linking) {
    return new NextResponse(errorHTML('Missing authorization code.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  const providerError =
    requestUrl.searchParams.get('error_description') ||
    requestUrl.searchParams.get('error');
  const outcome: AuthLinkOutcome = providerError
    ? classifyLinkOutcome({
        message: providerError,
        code: requestUrl.searchParams.get('error_code'),
      })
    : 'link_incomplete';
  if (!isAuthLinkSuccess(outcome)) {
    logFailure(outcome, providerError ?? 'callback carried no result');
  }

  return relay(`exawatt://auth/callback?${AUTH_LINK_PARAM}=${outcome}`);
}

export async function GET(request: Request): Promise<Response> {
  return handleElectronCallback(request);
}

function relay(deepLinkUrl: string): NextResponse {
  return new NextResponse(redirectHTML(deepLinkUrl), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function redirectHTML(deepLinkUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Returning to Exawatt...</title>
  <meta http-equiv="refresh" content="0;url=${deepLinkUrl}">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #09090b;
      color: #fafafa;
    }
    .container { text-align: center; }
    a { color: #3b82f6; }
    .muted { color: #71717a; font-size: 14px; margin-top: 24px; }
  </style>
</head>
<body>
  <div class="container">
    <h2>Returning to Exawatt...</h2>
    <p>If the app doesn&rsquo;t open automatically, <a href="${deepLinkUrl}">click here</a>.</p>
    <p class="muted">You can close this tab.</p>
  </div>
  <script>window.location.href = ${JSON.stringify(deepLinkUrl)};</script>
</body>
</html>`;
}

function errorHTML(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication Error</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #09090b;
      color: #fafafa;
    }
  </style>
</head>
<body>
  <div style="text-align: center;">
    <h2>Authentication Error</h2>
    <p>${message}</p>
  </div>
</body>
</html>`;
}
