'use client';

import { formatKeyBinding } from '@/lib/shortcuts';
import type { KeyBinding } from '@/types/shortcuts';
import { NoticeLaneItem } from '@/components/ui/notice-lane';

interface ChordIndicatorProps {
  pending: KeyBinding | null;
}

export function ChordIndicator({ pending }: ChordIndicatorProps) {
  if (!pending) return null;

  return (
    <NoticeLaneItem lane="chord">
      <div
        className="exa-material-overlay flex items-center gap-2 rounded-lg border border-border px-3 py-2 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-150"
        role="status"
        aria-live="polite"
      >
        <kbd className="rounded border border-border bg-muted px-2 py-1 font-mono text-sm font-medium">
          {formatKeyBinding(pending)}
        </kbd>
        <span className="text-sm text-muted-foreground">
          waiting for next key...
        </span>
      </div>
    </NoticeLaneItem>
  );
}
