import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedBoardSequence } from './pinned-board-sequence';
import { ALTITUDE_PANELS } from './altitude-copy';
import {
  bandCopyWords,
  bandById,
  bandRuns,
  pinnedBoardBands,
  proposedBands,
} from './manifest';

// The board is an R3F client chunk; this suite is about the sequence around it.
vi.mock('@/components/site/hero-board/hero-board', () => ({
  HeroBoard: (props: Record<string, unknown>) => (
    <div data-testid="hero-board" data-highlight={String(props.highlight)} />
  ),
}));

const reducedMotion = { value: false };
vi.mock('@/lib/motion/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => reducedMotion.value,
}));

afterEach(() => {
  reducedMotion.value = false;
});

/**
 * The pinned sequence's structure (ENG-031 W4, W6b). Every assertion here is a
 * constraint the brief or the operator stated, not an implementation echo.
 */
describe('pinned board sequence', () => {
  /** What the PAGE hands this component: the fold plus every pinned band. */
  const run = bandRuns(proposedBands()).find(
    entry => entry.kind === 'pinned-board'
  )!;
  const bands = run.kind === 'pinned-board' ? run.bands : [];

  it('mounts ONE board for the whole page, fold included', () => {
    // W6b. The fold used to mount its own `HeroBoard` and the run mounted a
    // second, which shipped as a visible seam at the fold edge, a duplicated
    // fleet chip and a duplicated legend. "One continuous board" is a claim
    // the page makes, so it has to be literally true.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    expect(
      container.querySelectorAll('[data-testid="hero-board"]')
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-pinned-panel]')).toHaveLength(
      bands.length
    );
    expect(bands[0]!.id).toBe('fold');
    expect(container.querySelector('[data-fold-hero]')).not.toBeNull();
  });

  it('takes its panels and their order from the band manifest', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    expect(
      Array.from(container.querySelectorAll('[data-pinned-panel]')).map(node =>
        node.getAttribute('data-pinned-panel')
      )
    ).toEqual(bands.map(band => band.id));
  });

  it('pins the board and pulls the panels back over it', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const board = container.querySelector('[data-pinned-board]')!;
    const panels = container.querySelector('[data-pinned-panels-layer]')!;

    expect(board.className).toContain('sticky');
    expect(board.className).toContain('md:h-[calc(100svh-3rem)]');
    expect(panels.className).toContain('md:-mt-[calc(100svh-3rem)]');
  });

  it('keeps every reading column inside the band under the site header', () => {
    // The one structural guarantee this pass added (W6b). A column in a sticky
    // box of the full safe height is released by its own panel's bottom edge
    // and crosses the header while it is still visible. A ZERO-HEIGHT sticky
    // line has no such release, so no scroll offset puts a sentence under the
    // chrome. Verified in the browser at 1440x900, 1280x720 and 390x844 by
    // stepping the page 100px at a time.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const band = container.querySelector('[data-pinned-panel-safe-band]')!;

    expect(band.className).toContain('md:sticky');
    expect(band.className).toContain('md:h-0');
    expect(band.className).toContain('md:top-[calc(50svh+1.5rem)]');
    expect(band.className).toContain('items-center');
  });

  it('stacks the phone: board card on top, copy below it in flow', () => {
    // The operator demos this on a phone (marketing.md, "Mobile is a demo
    // surface"). W6b stopped squeezing the desktop overlay onto it: the board
    // is a fixed-height card stuck to the top at full strength, every
    // explanation is an ordinary block beneath it, and nothing fades.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const board = container.querySelector('[data-pinned-board]')!;
    const panels = container.querySelector('[data-pinned-panels-layer]')!;
    const panel = container.querySelector('[data-pinned-panel]')!;
    const section = container.querySelector('[data-pinned-board-sequence]')!;

    expect(board.className).toContain('h-[calc(44svh+2rem)]');
    // The card is ABOVE the copy when stacked and below it when pinned.
    expect(board.className).toContain('z-20');
    expect(board.className).toContain('md:z-0');
    // No pull-up and no viewport-height panel below `md`, so no dead space.
    expect(panels.className).not.toMatch(/(^|\s)-mt-/u);
    expect(panel.className).toContain('opacity-100');
    expect(panel.className).not.toMatch(/(^|\s)h-\[calc\(var/u);
    expect(section.className).not.toMatch(/(^|\s)min-h-\[calc/u);
  });

  it('unpins for reduced motion, in the same DOM', () => {
    // One tree, unpinned by CSS. A second tree swapped in after hydration is
    // exactly the layout shift the constraint forbids. Reduced motion takes
    // the phone's shape at every width and the board falls to its poster.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const board = container.querySelector('[data-pinned-board]')!;
    const panels = container.querySelector('[data-pinned-panels-layer]')!;
    const panel = container.querySelector('[data-pinned-panel]')!;

    expect(board.className).toContain('motion-reduce:md:h-[calc(44svh+2rem)]');
    expect(panels.className).toContain('motion-reduce:md:mt-0');
    expect(panel.className).toContain('motion-reduce:md:h-auto');
    expect(panel.className).not.toContain('max-md:h-auto');
  });

  it('never takes the scroll away from the reader', () => {
    // Hard rule from the 16-site study: zero premium sites scroll-jack. The
    // sequence may only ever LISTEN, passively.
    const add = vi.spyOn(window, 'addEventListener');
    render(<PinnedBoardSequence bands={bands} />);

    const scrollListeners = add.mock.calls.filter(call => call[0] === 'scroll');
    expect(scrollListeners.length).toBeGreaterThan(0);
    for (const call of scrollListeners) {
      expect(call[2]).toMatchObject({ passive: true });
    }
    for (const blocked of ['wheel', 'touchmove', 'keydown']) {
      expect(add.mock.calls.some(call => call[0] === blocked)).toBe(false);
    }
    add.mockRestore();
  });

  it('binds no scroll listener when reduced motion unpins the layout', () => {
    // Unpinned there is no camera to drive: the listener does not exist rather
    // than running and being overridden by a media query.
    reducedMotion.value = true;
    const add = vi.spyOn(window, 'addEventListener');
    render(<PinnedBoardSequence bands={bands} />);
    expect(add.mock.calls.some(call => call[0] === 'scroll')).toBe(false);
    add.mockRestore();
  });

  it('lets the stacked layouts win the panel opacity outright', () => {
    // Presence travels as a CUSTOM PROPERTY, never as an inline `opacity`. An
    // inline opacity outranks the media queries, which is exactly how a phone
    // and a reduced-motion reader end up with invisible panels and no way to
    // reach them.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const panel of Array.from(
      container.querySelectorAll<HTMLElement>('[data-pinned-panel]')
    )) {
      expect(panel.style.opacity, panel.dataset.pinnedPanel).toBe('');
      expect(
        panel.style.getPropertyValue('--panel-opacity'),
        panel.dataset.pinnedPanel
      ).not.toBe('');
      expect(panel.className).toContain('md:opacity-[var(--panel-opacity)]');
      expect(panel.className).toContain('motion-reduce:md:opacity-100');
    }
  });

  it('asks the board for the active panel’s own emphasis', () => {
    // A state change alone is not enough (operator): the panel and the board
    // have to be pointing at the same thing.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    expect(
      container.querySelector('[data-testid="hero-board"]')
    ).toHaveAttribute('data-highlight', bands[0]!.boardHighlight!);
    expect(
      container.querySelector('[data-pinned-board-sequence]')
    ).toHaveAttribute('data-pinned-active', bands[0]!.id);
  });

  it('gives every panel exactly ONE stat line, and never two', () => {
    // Operator, W6b: one kicker, one two-sentence claim, one stat line. A
    // panel whose lens prints a legend has its state line already; every other
    // panel prints the subject the highlight resolved off the capture. The
    // fold prints neither, because the board's own fleet chip is beside it.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const band of bands) {
      const panel = container.querySelector(
        `[data-pinned-panel="${band.id}"]`
      )!;
      const subject = panel.querySelector('[data-pinned-panel-subject]');
      const legend = panel.querySelector('[data-pinned-panel-legend]');
      const lines = [subject, legend].filter(Boolean).length;
      expect(lines, band.id).toBe(band.id === 'fold' ? 0 : 1);
    }

    const subjects = Array.from(
      container.querySelectorAll('[data-pinned-panel-subject-label]')
    ).map(node => node.textContent);
    // Every stat line says something the others do not.
    expect(new Set(subjects).size).toBe(subjects.length);
    expect(subjects.join(' ')).toContain('need you');
  });

  it('prints a lens legend only where the lens actually re-reads the board', () => {
    // A legend for colours the board is not using is worse than no legend, so
    // `permission` renders as status and prints nothing until the capture
    // carries an approval mode.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    for (const band of bands) {
      const panel = container.querySelector(
        `[data-pinned-panel="${band.id}"]`
      )!;
      const legend = panel.querySelector('[data-pinned-panel-legend]');
      const resolvable =
        band.boardLens === 'source' || band.boardLens === 'burn';
      expect(Boolean(legend), `${band.id} / ${band.boardLens}`).toBe(
        resolvable
      );
    }
  });

  it('holds every rendered panel to its declared copy budget', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const band of pinnedBoardBands()) {
      const panel = container.querySelector(
        `[data-pinned-panel="${band.id}"]`
      )!;
      const budget = bandById(band.id).copyBudget.max;
      // The subject line is board state read off the capture, not authored
      // reading copy, so it is measured out the way the fold excludes its
      // button. What the budget governs is the heading and the sentences.
      const heading = panel.querySelector('[data-pinned-panel-heading]');
      const copy = panel.querySelector('[data-pinned-panel-copy]');
      const coda = panel.querySelector('[data-pinned-panel-coda]');
      const words =
        bandCopyWords(heading ?? document.createElement('div')) +
        bandCopyWords(copy!) +
        bandCopyWords(coda ?? document.createElement('div'));
      expect(words, band.id).toBeLessThanOrEqual(budget);
    }
  });

  it('sets each claim as REAL PARAGRAPHS, not a slab of stacked lines', () => {
    // The claim used to stack its sentences as bare blocks inside one <p>,
    // which set an eight-line slab at one leading with no rhythm in it.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const first = container.querySelector('[data-pinned-panel-copy]')!;

    expect(first.querySelectorAll('p')).toHaveLength(
      ALTITUDE_PANELS[0]!.copy.length
    );
    expect(first.className).toContain('gap-3');
  });

  it('carries no sub-headed mechanism trios', () => {
    // Operator, W6b: "I don't want to read all the text on that page." A
    // mechanism list is documentation and belongs in the docs.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    expect(container.querySelector('[data-pinned-panel-cards]')).toBeNull();
    for (const panel of ALTITUDE_PANELS) {
      expect(panel.copy.length, panel.id).toBeLessThanOrEqual(2);
    }
  });

  it('keeps the panels out of the board’s way for the pointer', () => {
    // The board's Agent hit targets sit under the reading column; a panel that
    // swallowed pointer events would make them unreachable. The fold's own
    // button is the one thing that opts back in.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const column = container.querySelector('[data-pinned-panel-column]')!;

    expect(column.className).toContain('pointer-events-none');
    expect(
      container.querySelector('[data-band-affordance="download"]')!.className
    ).toContain('pointer-events-auto');
  });
});
