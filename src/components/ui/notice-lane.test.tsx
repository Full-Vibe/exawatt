import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoticeLaneItem, NoticeLaneProvider } from './notice-lane';
import { OperationReceipt } from './operation-receipt';

describe('notice lane presentation', () => {
  it('retains caller actions and focused work while notices change', () => {
    const dismiss = vi.fn();
    const view = (title: string) => (
      <NoticeLaneProvider>
        <textarea aria-label="Work" />
        <NoticeLaneItem lane="update">
          <OperationReceipt state="neutral" title={title} onDismiss={dismiss} />
        </NoticeLaneItem>
        <NoticeLaneItem lane="hint">
          <OperationReceipt state="neutral" title="Session closed" />
        </NoticeLaneItem>
      </NoticeLaneProvider>
    );
    const { rerender } = render(view('Checking update'));
    screen.getByRole('textbox').focus();
    rerender(view('Update ready'));
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(screen.getAllByRole('status')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it('removes only the caller that leaves the lane', () => {
    const view = (hint: boolean) => (
      <NoticeLaneProvider>
        <NoticeLaneItem lane="update">
          <button>Restart</button>
        </NoticeLaneItem>
        {hint && (
          <NoticeLaneItem lane="hint">
            <span role="status">Closed</span>
          </NoticeLaneItem>
        )}
      </NoticeLaneProvider>
    );
    const { rerender } = render(view(true));
    expect(screen.getByRole('status')).toBeInTheDocument();
    rerender(view(false));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
