import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');

  if (!code) {
    return new NextResponse(errorHTML('Missing authorization code.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // Don't exchange the code here — the PKCE code verifier lives in the
  // Electron renderer's storage.  Relay the code back via deep link so
  // the renderer can exchange it itself.
  const deepLinkUrl = `exawatt://auth/callback?code=${encodeURIComponent(code)}`;

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
