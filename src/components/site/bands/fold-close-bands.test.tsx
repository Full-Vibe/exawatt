import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloseBand } from './close-band';
import {
  DOWNLOAD_HREF,
  DOWNLOAD_LABEL,
  DOWNLOAD_REQUIREMENT,
} from './download';
import { FOLD_CLOSE_VARIANTS, foldCloseVariant, foldWords } from './fold-copy';
import { FoldHero } from './fold-hero';
import { bandById, bandCopyWords, countWords } from './manifest';

vi.mock('@/lib/motion/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => true,
}));

vi.mock('@/app/_hero-bg', () => ({
  HeroBg: () => <div data-testid="hero-bg" />,
}));

const FOLD = bandById('fold');
const CLOSE = bandById('close');

describe('the fold, rendered', () => {
  it('holds every variant under the fold copy budget as rendered', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const { container, unmount } = render(<FoldHero variant={variant.id} />);
      const fold = container.querySelector('[data-fold-hero]')!;

      expect(bandCopyWords(fold), variant.id).toBeLessThanOrEqual(
        FOLD.copyBudget.max
      );
      // The rendered count and the source count must agree, or the ceiling is
      // measured on a different page than the one that ships. Each line is its
      // own block span; `bandCopyWords` treats element boundaries as word
      // boundaries so the two cannot drift.
      expect(bandCopyWords(fold), variant.id).toBe(foldWords(variant));
      unmount();
    }
  });

  it('gives the page exactly one h1, at the headline rung', () => {
    render(<FoldHero variant="a" />);
    const headline = screen.getByRole('heading', { level: 1 });

    expect(headline).toHaveAttribute('data-fold-headline');
    expect(headline.className).toContain('sm:text-6xl');
  });

  it('renders the selected variant and nothing from the others', () => {
    const { container } = render(<FoldHero variant="b" />);
    const copy = foldCloseVariant('b');

    expect(container.querySelector('[data-fold-hero]')).toHaveAttribute(
      'data-fold-variant',
      'b'
    );
    expect(container.querySelector('[data-fold-kicker]')).toHaveTextContent(
      copy.kicker!
    );
    for (const line of copy.subhead) {
      expect(container.querySelector('[data-fold-subhead]')).toHaveTextContent(
        line
      );
    }
  });

  it('omits the kicker entirely when a variant has none', () => {
    const { container } = render(<FoldHero variant="a" />);

    expect(container.querySelector('[data-fold-kicker]')).toBeNull();
  });

  it('states the download requirement at the button, in flat DOM', () => {
    render(<FoldHero variant="a" />);
    const button = screen.getByRole('link', { name: DOWNLOAD_LABEL });

    expect(button).toHaveAttribute('href', DOWNLOAD_HREF);
    expect(screen.getByText(DOWNLOAD_REQUIREMENT)).toBeInTheDocument();
    // never a 3D object, and never a mesh standing in for a CTA
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('carries at most two CTAs, exactly one of them primary', () => {
    const { container } = render(<FoldHero variant="a" />);
    const ctas = container.querySelectorAll('a[href]');

    expect(ctas.length).toBeLessThanOrEqual(2);
    expect(container.querySelectorAll('[data-band-download]')).toHaveLength(1);
  });

  it('keeps public exhibition typography insulated', () => {
    const { container } = render(<FoldHero variant="a" />);

    expect(container.querySelector('[data-fold-hero]')).toHaveAttribute(
      'data-public-exhibition-surface',
      'true'
    );
  });
});

describe('the closing band, rendered', () => {
  it('holds every closing line to ten words or fewer as rendered', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const { container, unmount } = render(
        <CloseBand band={CLOSE} variant={variant.id} />
      );
      const close = container.querySelector('[data-band="close"]')!;

      expect(bandCopyWords(close), variant.id).toBeLessThanOrEqual(
        CLOSE.copyBudget.max
      );
      unmount();
    }
  });

  it('is the biggest type on the page, at the site-closing rung', () => {
    render(<CloseBand band={CLOSE} variant="a" />);
    const line = screen.getByRole('heading', { level: 2 });

    // 72px, four times the 18px section rung, inside the measured 3x to 7x
    // window declared by W1 in docs/engineering/design-system.md.
    expect(line.className).toContain('sm:text-7xl');
    expect(line).toHaveAttribute('data-close-line');
  });

  it('repeats the fold, button and requirement, rather than inventing a CTA', () => {
    const fold = render(<FoldHero variant="a" />);
    const foldButton = fold.container.querySelector('a[data-band-download]')!;
    fold.unmount();

    render(<CloseBand band={CLOSE} variant="a" />);
    const closeButton = document.querySelector('a[data-band-download]')!;

    expect(closeButton.getAttribute('href')).toBe(
      foldButton.getAttribute('href')
    );
    expect(closeButton.textContent).toBe(foldButton.textContent);
    expect(
      document.querySelector('[data-band-download-requirement]')
    ).toHaveTextContent(DOWNLOAD_REQUIREMENT);
  });

  it('carries the band contract onto its section', () => {
    const { container } = render(<CloseBand band={CLOSE} variant="d" />);
    const section = container.querySelector('[data-band="close"]')!;

    expect(section.tagName).toBe('SECTION');
    expect(section).toHaveAttribute('data-band-medium', CLOSE.medium);
    expect(section).toHaveAttribute('data-band-altitude', 'none');
    expect(section).toHaveAttribute('data-close-variant', 'd');
    expect(section).toHaveStyle({ minHeight: '100vh' });
  });
});

describe('bandCopyWords', () => {
  it('counts reading copy and excludes the conversion affordance', () => {
    const { container } = render(<CloseBand band={CLOSE} variant="a" />);
    const close = container.querySelector('[data-band="close"]')!;

    expect(bandCopyWords(close)).toBe(countWords(foldCloseVariant('a').close));
    // the affordance is present, and it is what the ceiling excludes
    expect(countWords(close.textContent ?? '')).toBeGreaterThan(
      bandCopyWords(close)
    );
  });
});
