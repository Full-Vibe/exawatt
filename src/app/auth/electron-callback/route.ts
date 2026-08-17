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
import { resolveDistributionIdentity } from '@exawatt/core/distribution';

interface ElectronCallbackIdentity {
  productName: string;
  protocolScheme: string | null;
}

/**
 * Desktop landing route: the system browser ends here, and the desktop app
 * gets the result over the protocol owned by this distribution. Community
 * builds own no protocol and therefore expose no desktop callback relay.
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
  identity: ElectronCallbackIdentity = resolveDistributionIdentity(
    resolvedDistribution()
  ),
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
  // Without both an account service and a protocol handler, no identity
  // provider can complete a desktop round trip. Never manufacture the
  // official protocol for Community or a partially configured downstream.
  if (!accountConfigured || !identity.protocolScheme) {
    return new NextResponse(
      errorHTML(
        'Desktop authentication is not configured in this build.',
        identity.productName
      ),
      {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      }
    );
  }
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (code) {
    // Don't exchange the code here — the PKCE code verifier lives in the
    // Electron main process.  Relay the code back via deep link so the app
    // can exchange it itself.
    return relay(
      `${identity.protocolScheme}://auth/callback?code=${encodeURIComponent(code)}`,
      identity.productName
    );
  }

  const linking =
    authCallbackIntent(requestUrl.searchParams.get(AUTH_INTENT_PARAM)) ===
    'link';
  if (!linking) {
    return new NextResponse(
      errorHTML('Missing authorization code.', identity.productName),
      {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      }
    );
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

  return relay(
    `${identity.protocolScheme}://auth/callback?${AUTH_LINK_PARAM}=${outcome}`,
    identity.productName
  );
}

export async function GET(request: Request): Promise<Response> {
  return handleElectronCallback(request);
}

function relay(deepLinkUrl: string, productName: string): NextResponse {
  return new NextResponse(redirectHTML(deepLinkUrl, productName), {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    character =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!
  );
}

function redirectHTML(deepLinkUrl: string, productName: string): string {
  const escapedProductName = escapeHTML(productName);
  const escapedDeepLinkUrl = escapeHTML(deepLinkUrl);
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Returning to ${escapedProductName}...</title>
  <meta http-equiv="refresh" content="0;url=${escapedDeepLinkUrl}">
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
    <h2>Returning to ${escapedProductName}...</h2>
    <p>If the app doesn&rsquo;t open automatically, <a href="${escapedDeepLinkUrl}">click here</a>.</p>
    <p class="muted">You can close this tab.</p>
  </div>
  <script>window.location.href = ${JSON.stringify(deepLinkUrl)};</script>
</body>
</html>`;
}

function errorHTML(message: string, productName: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHTML(productName)} — Authentication Error</title>
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
