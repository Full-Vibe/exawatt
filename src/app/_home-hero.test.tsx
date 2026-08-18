import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeHero } from './_home-hero';

vi.mock('@/lib/motion/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

vi.mock('./_hero-bg', () => ({
  HeroBg: () => <div data-testid="hero-bg" />,
}));

describe('HomeHero', () => {
  it('states the product and its subhead over the ground', () => {
    render(<HomeHero />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Exawatt'
    );
    expect(screen.getByTestId('hero-bg')).toBeInTheDocument();
    expect(document.querySelector('[data-home-hero]')).toHaveAttribute(
      'data-public-exhibition-surface',
      'true'
    );
  });

  // The fold has now lost an in-fold control twice: the 3D command key switch,
  // then the plain `Architecture` button that replaced it. Both removals were
  // the operator's, so the absence is the contract, not an omission.
  it('carries no call to action', () => {
    render(<HomeHero />);

    expect(screen.queryAllByRole('link', { hidden: true })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { hidden: true })).toHaveLength(0);
  });
});
