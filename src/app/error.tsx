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
  }, [error]);

  return (
    <div className="flex h-[calc(100svh-3rem)] flex-col items-center justify-center gap-4 bg-[#04060b] px-6 text-center">
      <p className="font-mono text-xs text-zinc-500">
        This surface hit an error while rendering.
      </p>
      <p className="max-w-md text-sm text-zinc-300">
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
        <p className="font-mono text-[10px] text-zinc-600">
          digest {error.digest}
        </p>
      ) : null}
    </div>
  );
}
