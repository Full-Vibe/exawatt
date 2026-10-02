'use client';

import { useEffect } from 'react';
import type {
  FeedbackAttempt,
  FeedbackStore,
} from '@/lib/feedback/attempt-store';
import { Button } from '@/components/ui/button';
import { OperationReceipt } from '@/components/ui/operation-receipt';

/** Outside a modal: presentation can hide without discarding delivery evidence. */
export function FeedbackReceipt({
  attempt,
  store,
  onRetry,
  onEdit,
  onHide,
}: {
  attempt: FeedbackAttempt;
  store: FeedbackStore;
  onRetry: (id: string) => void;
  onEdit: (attempt: FeedbackAttempt) => void;
  onHide: (id: string) => void;
}) {
  useEffect(() => {
    if (attempt.status !== 'sent') return;
    const timer = setTimeout(() => store.dismissAttempt(attempt.id), 5000);
    return () => clearTimeout(timer);
  }, [attempt.id, attempt.status, store]);
  const draft = store.getSnapshot().drafts.composer;
  const ownsDraft =
    draft.id === attempt.draftId && draft.revision === attempt.draftRevision;
  const savedText = !!attempt.receipt;
  const needsRecovery =
    attempt.status === 'partial' || attempt.status === 'error';
  const canFinishWithoutImage =
    needsRecovery &&
    !!attempt.request.attachment &&
    attempt.receipt?.attachmentStored === false;
  const message = attempt.request.message ?? '';
  const excerpt = message.replace(/\s+/g, ' ').trim();

  return (
    <div
      data-feedback-attempt={attempt.id}
      data-feedback-state={attempt.status}
    >
      <OperationReceipt
        state={
          attempt.status === 'sending'
            ? 'pending'
            : attempt.status === 'sent'
              ? 'success'
              : attempt.status
        }
        title={
          attempt.status === 'sending'
            ? 'Sending feedback…'
            : attempt.status === 'partial' ||
                (attempt.status === 'error' && savedText)
              ? 'Feedback saved; image pending'
              : attempt.status === 'error'
                ? attempt.failureOutcome === 'not_accepted'
                  ? 'Feedback not sent'
                  : 'Delivery unconfirmed'
                : attempt.acceptedWithoutImage
                  ? 'Saved without image'
                  : 'Feedback sent'
        }
        description={
          attempt.status === 'partial'
            ? 'Retry the image, or finish without it.'
            : attempt.status === 'error'
              ? (attempt.error ?? undefined)
              : undefined
        }
        onDismiss={
          attempt.status === 'sent'
            ? () => store.dismissAttempt(attempt.id)
            : needsRecovery
              ? () => onHide(attempt.id)
              : undefined
        }
        dismissLabel={needsRecovery ? 'Hide feedback receipt' : 'Dismiss'}
        actions={
          needsRecovery ? (
            <>
              {excerpt && (
                <p className="w-full break-words text-chrome-label text-muted-foreground">
                  {excerpt.length > 120 ? `${excerpt.slice(0, 120)}…` : excerpt}
                </p>
              )}
              {attempt.retryable && (
                <Button size="sm" onClick={() => onRetry(attempt.id)}>
                  Retry
                </Button>
              )}
              {ownsDraft && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEdit(attempt)}
                >
                  Edit feedback
                </Button>
              )}
              {canFinishWithoutImage && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => store.finishWithoutImage(attempt.id)}
                >
                  Finish without image
                </Button>
              )}
              <details className="w-full text-chrome-label">
                <summary className="w-fit cursor-pointer rounded text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2">
                  Review report
                </summary>
                <div className="mt-2 max-h-52 space-y-3 overflow-y-auto rounded-md border border-border p-3">
                  <p className="select-text whitespace-pre-wrap break-words">
                    {message}
                  </p>
                  {attempt.request.attachment && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attempt.request.attachment.dataUrl}
                      alt="Report attachment"
                      className="max-h-40 w-full rounded object-contain"
                    />
                  )}
                </div>
              </details>
            </>
          ) : undefined
        }
      />
    </div>
  );
}
