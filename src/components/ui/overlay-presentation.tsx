'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, CornerDownLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

/** ENG-036 comfortable overlay candidate: existing spacing/type/material rungs. */
export const COMFORTABLE_OVERLAY_CONTENT_CLASS =
  'flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl';

/** Presentation only. cmdk continues to own selection, filtering and activation. */
export const COMFORTABLE_COMMAND_CLASS =
  'min-h-0 [&_[cmdk-input-wrapper]]:px-5 [&_[cmdk-input]]:h-16 [&_[cmdk-input]]:text-base [&_[cmdk-list]]:max-h-[min(55dvh,28rem)] [&_[cmdk-list]]:p-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-chrome-label [&_[cmdk-item]]:min-h-12 [&_[cmdk-item]]:gap-3 [&_[cmdk-item]]:px-3 [&_[cmdk-item]]:py-3 [&_[cmdk-item]]:rounded-md';

/**
 * Reserve the same trailing footprint on every row. Disabled rows never promise
 * activation; enabled selection displays Return without replacing its shortcut.
 * The cmdk item's ancestor uses `group/command-row`.
 */
export function CommandActivationHint({
  disabled = false,
  className,
}: {
  disabled?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-command-activation-cue
      className={cn(
        'flex size-6 shrink-0 items-center justify-center',
        className
      )}
    >
      {!disabled && (
        <CornerDownLeft className="size-4 opacity-0 group-data-[selected=true]/command-row:opacity-100" />
      )}
    </span>
  );
}

function CommandKey({
  children,
  label,
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <kbd
      aria-label={label}
      className="inline-flex min-w-5 items-center justify-center rounded border border-border px-1 py-0.5 font-mono text-chrome-meta"
    >
      {children}
    </kbd>
  );
}

/** The palette's owned keys remain visible beside the list, not hidden in help. */
export function CommandKeyboardFooter({
  showClose = true,
}: {
  showClose?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3 text-chrome-label text-muted-foreground">
      <span className="flex items-center gap-1">
        <CommandKey label="Up arrow">
          <ArrowUp aria-hidden="true" className="size-3" />
        </CommandKey>
        <CommandKey label="Down arrow">
          <ArrowDown aria-hidden="true" className="size-3" />
        </CommandKey>{' '}
        Navigate
      </span>
      <span className="flex items-center gap-1">
        <CommandKey label="Return">
          <CornerDownLeft aria-hidden="true" className="size-3" />
        </CommandKey>{' '}
        Select
      </span>
      {showClose && (
        <span className="ml-auto flex items-center gap-1">
          <CommandKey label="Escape">esc</CommandKey> Close
        </span>
      )}
    </div>
  );
}
