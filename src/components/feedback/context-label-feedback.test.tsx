import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ContextLabelFeedback } from './context-label-feedback';

describe('ContextLabelFeedback', () => {
  it('stays out of the UI when feedback is not authenticated', () => {
    render(
      <ContextLabelFeedback
        label="Improve agent context summaries"
        enabled={false}
        onRate={vi.fn()}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('submits a one-click positive rating with an accessible label', async () => {
    const onRate = vi.fn(async () => true);
    render(
      <ContextLabelFeedback
        label="Improve agent context summaries"
        enabled
        alwaysVisible
        onRate={onRate}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Good context label: Improve agent context summaries',
      })
    );
    await waitFor(() => expect(onRate).toHaveBeenCalledWith(1, undefined));
    expect(document.querySelector('[data-state="sent"]')).toBeTruthy();
  });

  it('asks for an exact better label and sends it from the keyboard path', async () => {
    const onRate = vi.fn(async () => true);
    render(
      <ContextLabelFeedback
        label="Implement cmd+shift+t to reopen tabs"
        enabled
        alwaysVisible
        onRate={onRate}
      />
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Improve context label: Implement cmd+shift+t to reopen tabs',
      })
    );
    const input = await screen.findByLabelText('Better context');
    expect(
      document.querySelector('[data-context-label-feedback-popover]')
    ).toHaveClass('border-hud-cyan/20', 'bg-hud-panel');
    fireEvent.change(input, {
      target: { value: 'Improve agent context summaries' },
    });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() =>
      expect(onRate).toHaveBeenCalledWith(-1, 'Improve agent context summaries')
    );
  });

  it('keeps the correction form open and announces upload failure', async () => {
    render(
      <ContextLabelFeedback
        label="Stale label"
        enabled
        alwaysVisible
        onRate={async () => false}
      />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Improve context label: Stale label' })
    );
    fireEvent.click(
      await screen.findByRole('button', { name: 'Just downvote' })
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save that feedback'
    );
  });
});
