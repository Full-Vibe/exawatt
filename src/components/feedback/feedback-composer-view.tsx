'use client';

import { Check, AlertCircle, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { FeedbackAttempt } from '@/lib/feedback/attempt-store';
import type { DiagnosticsReport } from '@exawatt/core/desktop-bridge';
import {
  QuickCaptureBar,
  type QuickCaptureBarProps,
} from './quick-capture-bar';

export interface FeedbackComposerViewProps extends QuickCaptureBarProps {
  attempt: FeedbackAttempt | null;
  onRetry: (id: string) => void;
  onEdit: (attempt: FeedbackAttempt) => void;
  onFinishWithoutImage: (id: string) => void;
  onDone: () => void;
  onNewFeedback: () => void;
}

/** The real report, progress and outcome share one DialogContent subtree.
 * This face is also the workbench surface; the store remains delivery owner. */
export function FeedbackComposerView({
  attempt,
  onRetry,
  onEdit,
  onFinishWithoutImage,
  onDone,
  onNewFeedback,
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
            : 'We couldn’t confirm it was saved';
  const description = !attempt
    ? null
    : attempt.status === 'sent'
      ? attempt.acceptedWithoutImage
        ? 'Sent without the image.'
        : null
      : partial
        ? 'The image hasn’t been confirmed. Try again, or finish without it.'
        : attempt.status === 'error'
          ? attempt.failureOutcome === 'not_accepted'
            ? attempt.error
            : attempt.retryable
              ? 'Your feedback is kept here. Try again to send it safely without creating a duplicate.'
              : 'Your feedback is kept here. We can’t safely send it again right now.'
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
            className="px-5 py-4"
          >
            <div className="flex items-start gap-3">
              <Icon
                aria-hidden
                className={`mt-0.5 size-5 shrink-0 text-muted-foreground ${attempt.status === 'sending' ? 'motion-safe:animate-spin' : ''}`}
              />
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="min-w-0 flex-1"
              >
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 min-h-10 text-sm text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {attempt.status === 'sent' ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onNewFeedback}
                  >
                    New feedback
                  </Button>
                  <Button type="button" size="sm" onClick={onDone}>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={props.onDismiss}
                  >
                    Close
                  </Button>
                  {attempt.status === 'error' &&
                    !savedText &&
                    attempt.failureOutcome === 'not_accepted' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onEdit(attempt)}
                      >
                        Edit feedback
                      </Button>
                    )}
                  {partial &&
                    attempt.request.attachment &&
                    attempt.receipt?.attachmentStored === false && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onFinishWithoutImage(attempt.id)}
                      >
                        Finish without image
                      </Button>
                    )}
                  {attempt.status !== 'sending' && attempt.retryable && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => onRetry(attempt.id)}
                    >
                      Try again
                    </Button>
                  )}
                </>
              )}
            </div>
          </section>
        ) : undefined
      }
    />
  );
}
