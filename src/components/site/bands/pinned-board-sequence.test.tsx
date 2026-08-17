import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedBoardSequence } from './pinned-board-sequence';
import { ALTITUDE_PANELS } from './altitude-copy';
import { bandCopyWords, bandById, pinnedBoardBands } from './manifest';

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
 * The pinned sequence's structure (ENG-031 W4). Every assertion here is a
 * constraint the brief or the operator stated, not an implementation echo.
 */
describe('pinned board sequence', () => {
  const bands = pinnedBoardBands();

  it('mounts ONE board for the whole sequence, not one per panel', () => {
    // "The board is ONE persistent element across the altitude sequence, not
    // three separate captures."
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    expect(
      container.querySelectorAll('[data-testid="hero-board"]')
    ).toHaveLength(1);
    expect(container.querySelectorAll('[data-pinned-panel]')).toHaveLength(
      bands.length
    );
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
    expect(board.className).toContain('h-[calc(100svh-3rem)]');
    expect(panels.className).toContain('-mt-[calc(100svh-3rem)]');
  });

  it('unpins for reduced motion and for a phone, in the same DOM', () => {
    // One tree, unpinned by CSS. A second tree swapped in after hydration is
    // exactly the layout shift the constraint forbids.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const board = container.querySelector('[data-pinned-board]')!;
    const panels = container.querySelector('[data-pinned-panels-layer]')!;
    const panel = container.querySelector('[data-pinned-panel]')!;

    // `relative`, never `static`: the board frame inside is absolutely
    // positioned, so a static parent hands it to the section and the poster
    // covers the panels.
    for (const variant of ['motion-reduce:relative', 'max-md:relative']) {
      expect(board.className).toContain(variant);
    }
    expect(board.className).not.toContain('motion-reduce:static');
    for (const variant of ['motion-reduce:mt-0', 'max-md:mt-0']) {
      expect(panels.className).toContain(variant);
    }
    for (const variant of ['motion-reduce:h-auto', 'max-md:h-auto']) {
      expect(panel.className).toContain(variant);
    }
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

  it('binds no scroll listener at all on the poster path', () => {
    reducedMotion.value = true;
    const add = vi.spyOn(window, 'addEventListener');
    render(<PinnedBoardSequence bands={bands} />);

    expect(add.mock.calls.some(call => call[0] === 'scroll')).toBe(false);
    add.mockRestore();
  });

  it('lets the unpinned layouts win the panel opacity outright', () => {
    // Presence travels as a CUSTOM PROPERTY, never as an inline `opacity`. An
    // inline opacity outranks `motion-reduce:opacity-100` and
    // `max-md:opacity-100`, which is exactly how a phone and a reduced-motion
    // reader end up with two invisible panels and no way to reach them.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const panel of Array.from(
      container.querySelectorAll<HTMLElement>('[data-pinned-panel]')
    )) {
      expect(panel.style.opacity, panel.dataset.pinnedPanel).toBe('');
      expect(
        panel.style.getPropertyValue('--panel-opacity'),
        panel.dataset.pinnedPanel
      ).not.toBe('');
      expect(panel.className).toContain('opacity-[var(--panel-opacity)]');
      expect(panel.className).toContain('motion-reduce:opacity-100');
      expect(panel.className).toContain('max-md:opacity-100');
    }
  });

  it('opens every panel on the poster path, where nothing drives them', () => {
    reducedMotion.value = true;
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const panel of Array.from(
      container.querySelectorAll<HTMLElement>('[data-pinned-panel]')
    )) {
      expect(
        panel.style.getPropertyValue('--panel-opacity'),
        panel.dataset.pinnedPanel
      ).toBe('1');
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

  it('names the highlighted subject from the capture, in the panel', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const subject = container.querySelector('[data-pinned-panel-subject]');

    expect(subject).not.toBeNull();
    expect(subject!.textContent).toContain('need you');
  });

  it('holds every rendered panel to its declared copy budget', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    for (const panel of Array.from(
      container.querySelectorAll('[data-pinned-panel]')
    )) {
      const id = panel.getAttribute('data-pinned-panel')!;
      const budget = bandById(id as never).copyBudget.max;
      // The subject line is board state read off the capture, not authored
      // reading copy, so it is measured out the way the fold excludes its
      // button. What the budget governs is the heading and the sentences.
      const heading = panel.querySelector('[data-pinned-panel-heading]');
      const copy = panel.querySelector('[data-pinned-panel-copy]');
      const words =
        bandCopyWords(heading ?? document.createElement('div')) +
        bandCopyWords(copy!);
      expect(words, id).toBeLessThanOrEqual(budget);
    }
  });

  it('renders each panel copy line as its own block, so words are counted', () => {
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const first = container.querySelector('[data-pinned-panel-copy]')!;

    expect(first.querySelectorAll('span')).toHaveLength(
      ALTITUDE_PANELS[0]!.copy.length
    );
  });

  it('keeps the panels out of the board’s way for the pointer', () => {
    // The board's Agent hit targets sit under the reading column; a panel that
    // swallowed pointer events would make them unreachable.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const column = container.querySelector('[data-pinned-panel] > div')!;

    expect(column.className).toContain('pointer-events-none');
  });
});
