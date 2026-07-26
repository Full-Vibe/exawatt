import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeHero } from './_home-hero';

const motionState = vi.hoisted(() => ({ reduced: false }));

vi.mock('@/lib/motion/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => motionState.reduced,
}));

vi.mock('./_hero-bg', () => ({
  HeroBg: ({ onFadeInComplete }: { onFadeInComplete?: () => void }) => (
    <button onClick={onFadeInComplete} type="button">
      Complete background fade
    </button>
  ),
}));

vi.mock('@/components/hud/webgl/keyswitch-study', () => ({
  CommandKeySwitchButton: ({
    idleHint,
    interactive,
  }: {
    idleHint?: boolean;
    interactive?: boolean;
  }) => (
    <div
      data-idle-hint={idleHint ? 'true' : 'false'}
      data-interactive={interactive ? 'true' : 'false'}
      data-testid="command-key"
    />
  ),
}));

describe('HomeHero command-key reveal', () => {
  beforeEach(() => {
    motionState.reduced = false;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits one second after the background, then fades for two seconds', () => {
    render(<HomeHero />);
    const reveal = document.querySelector('[data-home-command-key-reveal]')!;
    const key = screen.getByTestId('command-key');

    expect(reveal).toHaveAttribute('data-reveal-state', 'waiting');
    expect(reveal).toHaveStyle({ opacity: '0' });
    expect(key).toHaveAttribute('data-interactive', 'false');

    fireEvent.click(
      screen.getByRole('button', { name: 'Complete background fade' })
    );

    act(() => vi.advanceTimersByTime(999));
    expect(reveal).toHaveAttribute('data-reveal-state', 'waiting');

    act(() => vi.advanceTimersByTime(1));
    expect(reveal).toHaveAttribute('data-reveal-state', 'revealing');
    expect(reveal).toHaveStyle({ opacity: '1' });
    expect(key).toHaveAttribute('data-interactive', 'false');

    act(() => vi.advanceTimersByTime(1_999));
    expect(reveal).toHaveAttribute('data-reveal-state', 'revealing');

    act(() => vi.advanceTimersByTime(1));
    expect(reveal).toHaveAttribute('data-reveal-state', 'ready');
    expect(key).toHaveAttribute('data-interactive', 'true');
    expect(key).toHaveAttribute('data-idle-hint', 'true');
  });

  it('reveals immediately for reduced motion', () => {
    motionState.reduced = true;
    render(<HomeHero />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Complete background fade' })
    );

    expect(
      document.querySelector('[data-home-command-key-reveal]')
    ).toHaveAttribute('data-reveal-state', 'ready');
    expect(screen.getByTestId('command-key')).toHaveAttribute(
      'data-interactive',
      'true'
    );
  });
});
