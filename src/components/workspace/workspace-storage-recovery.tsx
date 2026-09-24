'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

export interface WorkspaceLoadFailure {
  required: boolean;
  recoveryFile?: string;
  originalFile?: string;
}

/** The workspace stays unready, including persistence, until a read succeeds. */
export function WorkspaceStorageRecovery({
  failure,
  onRetry,
  onReveal,
}: {
  failure: WorkspaceLoadFailure;
  onRetry: () => Promise<void>;
  onReveal: () => Promise<void>;
}) {
  const operation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>, error: string) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError(error);
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };

  // Design system: body/title type, reading-card spacing, semantic chrome,
  // and the shared primary/outline action recipe. No new status vocabulary.
  return (
    <div
      data-workspace-load-failure
      className="flex h-full items-center justify-center bg-background p-8 font-ui text-foreground"
    >
      <section
        aria-labelledby="workspace-recovery-title"
        className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card px-5 py-4"
      >
        <h1 id="workspace-recovery-title" className="text-lg font-semibold">
          Your workspace couldn’t be loaded
        </h1>
        <p role="alert" className="text-sm text-muted-foreground">
          {failure.required
            ? 'Saved workspace data needs repair. The original data has been preserved, and saving is blocked to protect it.'
            : 'Exawatt could not read your workspace. Saving is paused until it loads successfully.'}{' '}
          Running Agents have not been stopped.
        </p>
        {failure.recoveryFile && (
          <p className="break-all font-mono text-chrome-label text-muted-foreground">
            {failure.recoveryFile}
          </p>
        )}
        {failure.required && (
          <p className="text-sm text-muted-foreground">
            Restore a repaired copy to{' '}
            <span className="break-all font-mono text-chrome-label">
              {failure.originalFile ?? 'the original workspace file'}
            </span>
            , then retry. Keep the preserved file until recovery is complete.
          </p>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        )}
        <div className="flex gap-2" aria-busy={busy}>
          <Button
            disabled={busy}
            onClick={() =>
              void run(
                onRetry,
                failure.required
                  ? 'The workspace still needs repair. Your preserved data has not been replaced.'
                  : 'The workspace could not be loaded. Please try again.'
              )
            }
          >
            Retry
          </Button>
          {(failure.required || failure.originalFile) && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  onReveal,
                  'The saved data could not be revealed. Please try again.'
                )
              }
            >
              Reveal saved data
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
