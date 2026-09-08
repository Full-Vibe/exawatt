'use client';

import { useEffect } from 'react';

// Last-resort boundary: replaces the root layout when even it fails to
// render. Must own its own <html>/<body>. Styles are inline because
// globals.css may not have loaded in this state.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[exawatt] global error boundary:', error);
    void window.electron?.app
      ?.reportRenderError?.({
        message: error.message,
        stack: error.stack ?? null,
        digest: error.digest ?? null,
        pathname: window.location.pathname,
      })
      .catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'var(--exa-foundation-canvas, #04060b)',
          color: 'var(--exa-foundation-text, #d4d4d8)',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <p
          style={{
            fontSize: 13,
            color: 'var(--exa-foundation-text-muted, #71717a)',
            margin: 0,
          }}
        >
          Exawatt hit an error while rendering.
        </p>
        <p style={{ fontSize: 14, maxWidth: 420, margin: 0 }}>
          Your agent sessions are unaffected. Reload to continue.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={reset}
            style={{
              background: 'transparent',
              color: 'var(--exa-foundation-text, #d4d4d8)',
              border: '1px solid var(--exa-foundation-border-strong, #3f3f46)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <button
            onClick={() => {
              window.location.href = '/workspace';
            }}
            style={{
              background: 'transparent',
              color: 'var(--exa-foundation-text-muted, #a1a1aa)',
              border: '1px solid transparent',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Back to Agent
          </button>
        </div>
        {error.digest ? (
          <p
            style={{
              fontSize: 10,
              color: 'var(--exa-foundation-text-faint, #52525b)',
              fontFamily: 'monospace',
            }}
          >
            digest {error.digest}
          </p>
        ) : null}
        {error.message || error.stack ? (
          <pre
            style={{
              fontSize: 10,
              color: 'var(--exa-foundation-text-faint, #52525b)',
              fontFamily: 'monospace',
              maxWidth: 480,
              maxHeight: 200,
              overflow: 'auto',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid var(--exa-foundation-border-strong, #3f3f46)',
              borderRadius: 6,
              padding: 8,
              margin: 0,
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        ) : null}
      </body>
    </html>
  );
}
