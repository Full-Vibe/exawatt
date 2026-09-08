'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

// Route-level error boundary. Before this existed, any unhandled render or
// navigation error unmounted the React root over the window's near-black
// background — an unrecoverable black screen (ENG-016 D18).
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[exawatt] route error boundary:', error);
    // Fire-and-forget: this must never be the reason the fallback itself
    // fails to render. Absent (web, no bridge) is a no-op, not a throw.
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
    <div className="flex h-[calc(100svh-3rem)] flex-col items-center justify-center gap-4 bg-[var(--exa-foundation-canvas)] px-6 text-center">
      <p className="font-mono text-xs text-[var(--exa-foundation-text-muted)]">
        This surface hit an error while rendering.
      </p>
      <p className="max-w-md text-sm text-[var(--exa-foundation-text)]">
        Your agent sessions are unaffected — this is a display error, not a
        session failure.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            window.location.href = '/workspace';
          }}
        >
          Back to Agent
        </Button>
      </div>
      {error.digest ? (
        <p className="font-mono text-chrome-micro text-[var(--exa-foundation-text-faint)]">
          digest {error.digest}
        </p>
      ) : null}
      {error.message || error.stack ? (
        <details className="mt-2 max-w-lg text-left">
          <summary className="cursor-pointer font-mono text-chrome-micro text-[var(--exa-foundation-text-faint)]">
            what broke
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--exa-foundation-border)] bg-[var(--exa-foundation-surface-raised)] p-2 font-mono text-chrome-micro text-[var(--exa-foundation-text-muted)]">
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ''}
          </pre>
        </details>
      ) : null}
    </div>
  );
}
