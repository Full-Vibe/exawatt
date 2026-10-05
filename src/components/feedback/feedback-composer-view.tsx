'use client';

import { Check, AlertCircle, LoaderCircle } from 'lucide-react';
import motion from './feedback-motion.module.css';
import { Button } from '@/components/ui/button';
import type { FeedbackAttempt } from '@/lib/feedback/attempt-store';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import {
  QuickCaptureBar,
  type QuickCaptureBarProps,
} from './quick-capture-bar';

interface FeedbackComposerViewProps extends QuickCaptureBarProps {
  attempt: FeedbackAttempt | null;
  onRetry: (id: string) => void;
  onEdit: (attempt: FeedbackAttempt) => void;
  onFinishWithoutImage: (id: string) => void;
}

/** The real report, progress and outcome share one DialogContent subtree.
 * This face is also the workbench surface; the store remains delivery owner. */
export function FeedbackComposerView({
  attempt,
  onRetry,
  onEdit,
  onFinishWithoutImage,
  ...props
}: FeedbackComposerViewProps) {
  const savedText = !!attempt?.receipt;
  const partial =
    !!attempt &&
    (attempt.status === 'partial' || (attempt.status === 'error' && savedText));
  const title = !attempt
    ? ''
    : attempt.status === 'sending'
      ? 'Sending feedback…'
      : attempt.status === 'sent'
        ? 'Feedback sent'
        : partial
          ? 'Feedback saved'
          : attempt.failureOutcome === 'not_accepted'
            ? 'Feedback not sent'
            : 'Couldn’t confirm your feedback was sent.';
  const description = !attempt
    ? null
    : attempt.status === 'sent'
      ? attempt.acceptedWithoutImage
        ? 'Sent without the image.'
        : null
      : partial
        ? 'Your image wasn’t confirmed. Retry, or finish without it.'
        : attempt.status === 'error'
          ? attempt.failureOutcome === 'not_accepted'
            ? attempt.error
            : attempt.retryable
              ? 'Your text is kept here. Try again.'
              : 'Your text is kept here.'
          : null;
  const Icon =
    attempt?.status === 'sending'
      ? LoaderCircle
      : attempt?.status === 'sent'
        ? Check
        : AlertCircle;
  return (
    <QuickCaptureBar
      {...props}
      readOnly={!!attempt}
      busy={attempt ? false : props.busy}
      diagnosticsPreparing={attempt ? false : props.diagnosticsPreparing}
      kind={
        attempt && attempt.request.kind !== 'context_label'
          ? attempt.request.kind
          : props.kind
      }
      message={attempt?.request.message ?? props.message}
      screenshot={
        attempt
          ? (attempt.request.attachment?.dataUrl ?? null)
          : props.screenshot
      }
      attachScreenshot={
        attempt ? !!attempt.request.attachment : props.attachScreenshot
      }
      attachmentName={
        attempt
          ? (attempt.request.attachment?.name ?? undefined)
          : props.attachmentName
      }
      diagnostics={
        attempt
          ? ((attempt.request.context?.diagnostics as
              | DiagnosticsReport
              | undefined) ?? null)
          : props.diagnostics
      }
      attachDiagnostics={
        attempt
          ? !!attempt.request.context?.diagnostics
          : props.attachDiagnostics
      }
      error={attempt ? null : props.error}
      submission={
        attempt ? (
          <section
            data-feedback-attempt={attempt.id}
            data-feedback-state={attempt.status}
          >
            <div className="flex min-h-14 items-center gap-3 px-4 py-2">
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex min-w-0 flex-1 items-center gap-2 text-sm"
              >
                {attempt.status === 'sending' ? (
                  <span className="sr-only">{title}</span>
                ) : (
                  <>
                    <Icon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span>{title}</span>
                  </>
                )}
              </div>
              {attempt.status === 'sending' ? (
                <Button
                  type="button"
                  size="sm"
                  disabled
                  className="min-w-40 text-sm"
                >
                  <LoaderCircle
                    aria-hidden
                    className="motion-safe:animate-spin"
                  />
                  Sending…
                </Button>
              ) : attempt.status === 'sent' ? null : attempt.retryable ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onRetry(attempt.id)}
                  className="min-w-40 text-sm"
                >
                  Retry
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={props.onDismiss}
                  className="min-w-40 text-sm"
                >
                  Close
                </Button>
              )}
            </div>
            <div className={motion.expansion} data-expanded={!!description}>
              <div className="min-h-0 overflow-hidden">
                {description && (
                  <div className="px-4 pb-3">
                    <p className="text-sm text-muted-foreground">
                      {description}
                    </p>
                    {(attempt.status === 'error' &&
                      !savedText &&
                      attempt.failureOutcome === 'not_accepted') ||
                    (partial &&
                      attempt.request.attachment &&
                      attempt.receipt?.attachmentStored === false) ? (
                      <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                        {attempt.status === 'error' &&
                          !savedText &&
                          attempt.failureOutcome === 'not_accepted' && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onEdit(attempt)}
                              className="text-sm"
                            >
                              Edit feedback
                            </Button>
                          )}
                        {partial &&
                          attempt.request.attachment &&
                          attempt.receipt?.attachmentStored === false && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => onFinishWithoutImage(attempt.id)}
                              className="text-sm"
                            >
                              Finish without image
                            </Button>
                          )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : undefined
      }
    />
  );
}
