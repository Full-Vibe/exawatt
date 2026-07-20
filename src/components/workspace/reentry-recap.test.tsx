import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReentryRecapLine } from './reentry-recap';

const recap = {
  id: 'pty-1',
  text: 'Tests passed; migration order needs approval.',
  awayMs: 180_000,
  generatedAt: 1,
};

describe('ReentryRecapLine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the delta ambiently with a polite live region', () => {
    render(<ReentryRecapLine recap={recap} onExpire={() => {}} />);
    const line = screen.getByRole('status');
    expect(line).toHaveTextContent('since you left');
    expect(line).toHaveTextContent(recap.text);
    // ambient means chrome, not overlay: no dismiss affordance exists
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('expires on a keystroke without consuming it', () => {
    const onExpire = vi.fn();
    render(<ReentryRecapLine recap={recap} onExpire={onExpire} />);
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(onExpire).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it('expires on its own after the ambient window', () => {
    const onExpire = vi.fn();
    render(<ReentryRecapLine recap={recap} onExpire={onExpire} />);
    vi.advanceTimersByTime(44_000);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });
});
