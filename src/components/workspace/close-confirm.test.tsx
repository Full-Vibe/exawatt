import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseConfirm, CloseProjectConfirm } from './close-confirm';

describe('CloseProjectConfirm', () => {
  it('names the batch consequence and keeps Enter as the default action', () => {
    const onClose = vi.fn();
    render(
      <CloseProjectConfirm
        title="Exawatt"
        tabCount={3}
        workingCount={2}
        waitingCount={0}
        color="#19E6FF"
        onClose={onClose}
        onCancel={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Close Exawatt?' });
    expect(dialog).toHaveTextContent('3 open tabs will close');
    expect(dialog).toHaveTextContent('2 Agents are mid-turn');
    expect(dialog).toHaveTextContent('reopened with ⌘N');
    fireEvent.keyDown(dialog, { key: 'Enter' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('counts an unanswered question as its own loss', () => {
    // Interrupting a turn and discarding a question are different costs, and
    // an operator who sees the second will often answer one before closing.
    render(
      <CloseProjectConfirm
        title="Exawatt"
        tabCount={3}
        workingCount={1}
        waitingCount={2}
        color="#19E6FF"
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog', { name: 'Close Exawatt?' });
    expect(dialog).toHaveTextContent(
      'One Agent is mid-turn; its turn will be interrupted.'
    );
    expect(dialog).toHaveTextContent(
      '2 are waiting on your answer; their questions are discarded.'
    );
  });

  it('cancels with Escape', () => {
    const onCancel = vi.fn();
    render(
      <CloseProjectConfirm
        title="Exawatt"
        tabCount={1}
        workingCount={0}
        waitingCount={0}
        color="#19E6FF"
        onClose={vi.fn()}
        onCancel={onCancel}
      />
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe('CloseConfirm', () => {
  const confirm = (turn: 'working' | 'blocked' | 'done') =>
    render(
      <CloseConfirm
        title="cortex-ehr"
        goal="Wire the intake form"
        turn={turn}
        color="#19E6FF"
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />
    );

  it('names what this particular close costs', () => {
    const working = confirm('working');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It is still working — closing interrupts the turn in flight.'
    );
    working.unmount();

    // A gate is not "working" — the Agent is provably idle — but closing it
    // still throws away a question nobody answered.
    const blocked = confirm('blocked');
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'It is waiting on your answer — closing discards the question.'
    );
    blocked.unmount();

    // A finished turn costs nothing extra; the dialog stays quiet about it.
    confirm('done');
    const dialog = screen.getByRole('dialog');
    expect(dialog).not.toHaveTextContent('still working');
    expect(dialog).not.toHaveTextContent('waiting on your answer');
    expect(dialog).toHaveTextContent('Recently closed');
  });
});
