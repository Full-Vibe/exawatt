import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('HomeHero architecture CTA', () => {
  beforeEach(() => {
    motionState.reduced = false;
  });

  it('renders a plain link to /architecture, hidden until the background is ready', () => {
    render(<HomeHero />);
    const reveal = document.querySelector('[data-home-architecture-cta]')!;
    const link = screen.getByRole('link', { name: 'Architecture', hidden: true });

    expect(reveal).toHaveStyle({ opacity: '0' });
    expect(reveal).toHaveAttribute('aria-hidden', 'true');
    expect(link).toHaveAttribute('href', '/architecture');
    expect(link).toHaveAttribute('tabIndex', '-1');

    fireEvent.click(
      screen.getByRole('button', { name: 'Complete background fade' })
    );

    expect(reveal).toHaveStyle({ opacity: '1' });
    expect(reveal).toHaveAttribute('aria-hidden', 'false');
    expect(link).not.toHaveAttribute('tabIndex');
  });
});
