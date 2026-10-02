import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationReceipt } from './operation-receipt';

afterEach(cleanup);

describe('operation receipt accessibility', () => {
  it('announces changed delivery state without moving work focus', () => {
    const workInput = document.createElement('textarea');
    document.body.appendChild(workInput);
    workInput.focus();
    const { rerender } = render(
      <OperationReceipt state="pending" title="Pending fixture" />
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    rerender(
      <OperationReceipt
        state="partial"
        title="Partial fixture"
        description="Evidence fixture"
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('Partial fixture');
    expect(document.activeElement).toBe(workInput);
    workInput.remove();
  });

  it('keeps recovery and dismissal interactive outside its atomic announcement', () => {
    const recover = vi.fn();
    const dismiss = vi.fn();
    render(
      <OperationReceipt
        state="error"
        title="Failure fixture"
        actions={<button onClick={recover}>Recovery fixture</button>}
        onDismiss={dismiss}
        dismissLabel="Dismiss fixture"
      />
    );
    const action = screen.getByRole('button', { name: 'Recovery fixture' });
    expect(screen.getByRole('status')).not.toContainElement(action);
    fireEvent.click(action);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss fixture' }));
    expect(recover).toHaveBeenCalledOnce();
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
