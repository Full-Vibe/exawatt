import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ReentryRecapCard } from './reentry-recap';

const recap = {
  id: 'pty-1',
  text: 'Tests passed; migration order needs approval.',
  awayMs: 180_000,
  generatedAt: 1,
};

describe('ReentryRecapCard', () => {
  it('shows the current thread and change summary', () => {
    render(
      <ReentryRecapCard
        recap={recap}
        title="Auth migration"
        context="validating database rollback"
        onDismiss={() => {}}
      />
    );
    expect(screen.getByText('While you were away')).toBeInTheDocument();
    expect(screen.getByText('Auth migration')).toBeInTheDocument();
    expect(screen.getByText('validating database rollback')).toBeInTheDocument();
    expect(screen.getByText(recap.text)).toBeInTheDocument();
  });

  it('dismisses on a keystroke without consuming it', () => {
    const onDismiss = vi.fn();
    render(
      <ReentryRecapCard recap={recap} title="Auth" onDismiss={onDismiss} />
    );
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('provides an icon button to dismiss explicitly', () => {
    const onDismiss = vi.fn();
    render(
      <ReentryRecapCard recap={recap} title="Auth" onDismiss={onDismiss} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss recap' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
