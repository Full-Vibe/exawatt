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

describe('homepage band composition', () => {
  it('registers a component for every shipped band', () => {
    // The converse is deliberately NOT asserted after W5. A registered
    // component on a `reserved` band means "written and reviewable, parked one
    // word away from the page", which is the state the whole narrative pass
    // sits in while the operator reads it at
    // `/hud-gallery/homepage-narrative`. `null` keeps its stricter meaning:
    // nothing is written at all.
    for (const band of shippedBands()) {
      expect(BAND_COMPONENTS[band.id], band.id).not.toBeNull();
    }
    // A pinned band never has a component of its own: a run of them is ONE
    // board and several panels.
    for (const band of HOMEPAGE_BANDS) {
      if (band.medium === 'pinned-board') {
        expect(BAND_COMPONENTS[band.id], band.id).toBeNull();
      }
    }
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
    expect(section).toHaveAttribute('data-band-altitude', fold.altitudeAnchor!);
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
