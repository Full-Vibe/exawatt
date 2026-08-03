'use client';

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
          background: '#04060b',
          color: '#d4d4d8',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <p style={{ fontSize: 13, color: '#71717a', margin: 0 }}>
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
              color: '#d4d4d8',
              border: '1px solid #3f3f46',
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
              color: '#a1a1aa',
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
          <p style={{ fontSize: 10, color: '#52525b', fontFamily: 'monospace' }}>
            digest {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
