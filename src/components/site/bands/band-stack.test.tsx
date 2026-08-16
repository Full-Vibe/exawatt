import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeBands } from './band-stack';
import {
  HOMEPAGE_BANDS,
  bandById,
  countWords,
  reservedBands,
  shippedBands,
} from './manifest';
import { BAND_COMPONENTS } from './registry';

vi.mock('@/lib/motion/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock('@/app/_hero-bg', () => ({
  HeroBg: () => <div data-testid="hero-bg" />,
}));

vi.mock('@/components/hud/webgl/keyswitch-study', () => ({
  CommandKeySwitchButton: () => <div data-testid="command-key" />,
}));

describe('homepage band composition', () => {
  it('registers a component for exactly the shipped bands', () => {
    const registered = HOMEPAGE_BANDS.filter(
      band => BAND_COMPONENTS[band.id] !== null
    ).map(band => band.id);

    expect(registered).toEqual(shippedBands().map(band => band.id));
  });

  it('declares reserved bands without rendering them', () => {
    render(<HomeBands />);

    for (const band of reservedBands()) {
      expect(
        document.querySelector(`[data-band="${band.id}"]`),
        band.id
      ).toBeNull();
    }
  });

  it('renders the shipped bands in manifest order', () => {
    render(<HomeBands />);

    const rendered = Array.from(document.querySelectorAll('[data-band]')).map(
      section => section.getAttribute('data-band')
    );

    expect(rendered).toEqual(shippedBands().map(band => band.id));
  });

  it('carries each band contract onto its section', () => {
    render(<HomeBands />);
    const fold = bandById('fold');
    const section = document.querySelector('[data-band="fold"]')!;

    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveAttribute('data-band-medium', fold.medium);
    expect(section).toHaveAttribute('data-band-screens', String(fold.screens));
    expect(section).toHaveAttribute('data-band-altitude', 'fleet');
    expect(section).toHaveStyle({ minHeight: '100vh' });
  });

  it('keeps public exhibition typography insulated for every band', () => {
    render(<HomeBands />);

    expect(document.querySelector('[data-home-bands]')).toHaveAttribute(
      'data-public-exhibition-surface',
      'true'
    );
  });

  it('holds the fold to its declared copy budget', () => {
    render(<HomeBands />);
    const fold = document.querySelector('[data-band="fold"]')!;

    expect(countWords(fold.textContent ?? '')).toBeLessThanOrEqual(
      bandById('fold').copyBudget.max
    );
  });

  it('gives the page one heading at the fold headline role', () => {
    render(<HomeBands />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Exawatt'
    );
  });
});
