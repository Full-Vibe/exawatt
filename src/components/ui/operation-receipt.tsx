'use client';

import type { ReactNode } from 'react';
import { AlertCircle, Check, Info, LoaderCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type OperationReceiptState =
  | 'pending'
  | 'success'
  | 'partial'
  | 'error'
  | 'neutral';

/**
 * One stable operation face. Callers own delivery truth, persistence, placement
 * and actions. State changes update immediately without animating geometry.
 */
export function OperationReceipt({
  state,
  title,
  description,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss notice',
  className,
}: {
  state: OperationReceiptState;
  title: string;
  description?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const Icon =
    state === 'pending'
      ? LoaderCircle
      : state === 'success'
        ? Check
        : state === 'error' || state === 'partial'
          ? AlertCircle
          : Info;
  return (
    <section
      data-operation-receipt={state}
      className={cn(
        'exa-material-overlay flex items-start gap-3 rounded-lg border border-border p-4 text-foreground shadow-lg',
        className
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          'mt-0.5 size-5 shrink-0 text-muted-foreground',
          state === 'pending' && 'motion-safe:animate-spin'
        )}
      />
      <div className="min-w-0 flex-1">
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="text-sm font-medium">{title}</p>
          {description && (
            <p className="mt-1 text-chrome-label text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      )}
    </section>
  );
}
