'use client';

import { formatKeyBinding } from '@/lib/shortcuts';
import type { KeyBinding } from '@/types/shortcuts';

interface ChordIndicatorProps {
  pending: KeyBinding | null;
}

export function ChordIndicator({ pending }: ChordIndicatorProps) {
  if (!pending) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-bottom-2 duration-150"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-lg">
        <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-sm font-medium">
          {formatKeyBinding(pending)}
        </kbd>
        <span className="text-sm text-muted-foreground">
          waiting for next key...
        </span>
      </div>
    </div>
  );
}
