import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseProjectConfirm } from './close-confirm';

describe('CloseProjectConfirm', () => {
  it('names the batch consequence and keeps Enter as the default action', () => {
    const onClose = vi.fn();
    render(
      <CloseProjectConfirm
        title="Exawatt"
        tabCount={3}
        workingCount={2}
        color="#19E6FF"
        onClose={onClose}
        onCancel={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Close Exawatt?' });
    expect(dialog).toHaveTextContent('3 open tabs will close');
    expect(dialog).toHaveTextContent('2 Agents are still working');
    expect(dialog).toHaveTextContent('reopened with ⌘N');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('cancels with Escape', () => {
    const onCancel = vi.fn();
    render(
      <CloseProjectConfirm
        title="Exawatt"
        tabCount={1}
        workingCount={0}
        color="#19E6FF"
        onClose={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
