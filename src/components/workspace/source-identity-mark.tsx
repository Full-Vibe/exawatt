import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Agent Source colors are stable brand/data identity, not readable text paint.
 * A fixed dark instrument plate preserves the authored mark across every app
 * theme while surrounding labels continue to use semantic foreground roles.
 */
export const SOURCE_IDENTITY_BACKPLATE = '#111820';
export const SOURCE_IDENTITY_BORDER = '#566A76';

export function SourceIdentityMark({
  color,
  children,
  className,
}: {
  color: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-source-identity-mark
      className={cn(
        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border',
        className
      )}
      style={{
        color,
        background: SOURCE_IDENTITY_BACKPLATE,
        borderColor: SOURCE_IDENTITY_BORDER,
      }}
    >
      {children}
    </span>
  );
}
