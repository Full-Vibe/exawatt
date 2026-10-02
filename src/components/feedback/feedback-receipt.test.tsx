import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFeedbackStore } from '@/lib/feedback/attempt-store';
import type { ProductFeedbackServiceResponseV1 } from '@/lib/feedback/contract';
import { FeedbackReceipt } from './feedback-receipt';

const payload = {
  kind: 'bug' as const,
  message: 'A report that belongs to the earlier draft.',
  surface: 'feedback-composer',
  attachment: { dataUrl: 'data:image/png;base64,cG5n', name: 'evidence.png' },
};
const receipt: ProductFeedbackServiceResponseV1 = {
  id: '223e4567-e89b-42d3-a456-426614174000',
  duplicate: false,
  attachmentStored: false,
};

describe('feedback receipt recovery', () => {
  it('can review and hide an older nonretryable report without losing evidence', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', payload)!;
    store.fail(first.id, 'The service refused this report.', false);
    store.newDraft('composer');
    store.updateDraft('composer', { message: 'Newer work' });
    const attempt = store.getSnapshot().attempts[0];
    const onHide = vi.fn();
    const onRetry = vi.fn();
    const onEdit = vi.fn();
    render(
      <FeedbackReceipt
        attempt={attempt}
        store={store}
        onHide={onHide}
        onRetry={onRetry}
        onEdit={onEdit}
      />
    );
    const review = screen.getByText('Review report');
    expect(review.tagName).toBe('SUMMARY');
    expect(
      screen.getByText(payload.message, { selector: 'details p' })
    ).toBeInTheDocument();
    expect(screen.getByAltText('Report attachment')).toHaveAttribute(
      'src',
      payload.attachment.dataUrl
    );
    expect(
      screen.queryByRole('button', { name: 'Retry' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit feedback' })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Finish without image' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide feedback receipt' })
    );
    expect(onHide).toHaveBeenCalledWith(first.id);
    expect(store.getSnapshot().attempts[0].request).toBe(first.request);
    expect(store.getSnapshot().attempts[0].request.idempotencyKey).toBe(
      first.id
    );
    expect(store.getSnapshot().drafts.composer.message).toBe('Newer work');
    expect(onRetry).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('keeps work focus and same-attempt retry after a partial retry fails', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', payload)!;
    store.complete(first.id, receipt);
    const retry = store.retry(first.id)!;
    store.fail(retry.id, 'Image delivery could not be confirmed.');
    const attempt = store.getSnapshot().attempts[0];
    const onRetry = vi.fn();
    const view = (visible: boolean) => (
      <>
        <textarea aria-label="Work" />
        {visible && (
          <FeedbackReceipt
            attempt={attempt}
            store={store}
            onHide={vi.fn()}
            onRetry={onRetry}
            onEdit={vi.fn()}
          />
        )}
      </>
    );
    const { rerender } = render(view(false));
    screen.getByRole('textbox').focus();
    rerender(view(true));
    expect(screen.getByRole('status')).toHaveTextContent(
      /saved.*image pending/i
    );
    expect(screen.getByRole('textbox')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith(first.id);
    expect(attempt.request).toBe(first.request);
  });

  it('dismisses a completed report through its operation owner', () => {
    const store = createFeedbackStore();
    const first = store.start('composer', payload)!;
    store.complete(first.id, { ...receipt, attachmentStored: true });
    const onHide = vi.fn();
    render(
      <FeedbackReceipt
        attempt={store.getSnapshot().attempts[0]}
        store={store}
        onHide={onHide}
        onRetry={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(store.getSnapshot().attempts).toEqual([]);
    expect(onHide).not.toHaveBeenCalled();
  });
});
