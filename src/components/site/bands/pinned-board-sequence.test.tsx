import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PinnedBoardSequence } from './pinned-board-sequence';
import { ALTITUDE_PANELS } from './altitude-copy';
import { panelStepId } from './pinned-scroll';
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

  it('settles on its steps with NATIVE snap, and only inside the run', () => {
    // Operator, W9: "could you have it snap slightly more so scroll settles in
    // the steps, instead of being able to get stuck in between." The answer is
    // CSS scroll snap, declared on the document scroller in `globals.css` and
    // targeted here, so the browser owns the scroll from first paint and this
    // component still never calls `scrollTo`.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const section = container.querySelector('[data-pinned-board-sequence]')!;
    expect(section.getAttribute('data-pinned-snap')).toBe('proximity');

    const points = Array.from(
      container.querySelectorAll('[data-pinned-snap-point]')
    );
    // Every panel but the fold. The fold's own resting place is scroll zero,
    // and a snap point a few pixels below it would fight the one position
    // every page already has.
    expect(
      points.map(node => node.getAttribute('data-pinned-snap-point'))
    ).toEqual(bands.slice(1).map(band => band.id));
    for (const point of points) {
      // Desktop only, and off under reduced motion: the unpinned layout is a
      // reading column in normal flow, with no camera steps to settle on.
      expect(point.className).toContain('md:snap-start');
      expect(point.className).toContain('motion-reduce:md:snap-align-none');
      // A zero-height, non-interactive marker. It exists to be a scroll
      // position, never to be seen or hit.
      expect(point.className).toContain('h-px');
      expect(point.className).toContain('pointer-events-none');
      expect(point.getAttribute('aria-hidden')).toBe('true');
    }
    // The snap point sits on the CAMERA KEYFRAME, not on the panel box: the
    // panel is `screens` viewport heights tall and the pinned box is one
    // viewport minus the header, so the two differ by up to 114px at 1.2
    // screens. `pinned-scroll.test.ts` proves the arithmetic; this proves the
    // component ships it.
    expect((points[0] as HTMLElement).style.top).toBe(
      'calc((var(--panel-screens) * 100svh - (100svh - 3rem)) / 2)'
    );
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

  it('prints no stat line and no coda on any panel, at all', () => {
    // SUPERSEDES W6b's "exactly ONE stat line per panel" (operator, W12: "the
    // last two lines of copy are horrendous here - you're just putting random
    // numbers and labels '172 agents' and 'Every outbound feature' - kill that
    // and other such overpedantic hyperpolite copy lines").
    //
    // Every subject line the panels printed was a second printing of something
    // already in the same frame: the fleet chip's own three numbers under
    // `trust`, the same chip's needs-you figure under `altitude-attention`, a
    // delegation count the bloom is the picture of, and under the dive the
    // identity card's own three lines verbatim. The board says its own state
    // now and the panel says the claim.
    const { container } = render(<PinnedBoardSequence bands={bands} />);

    expect(container.querySelector('[data-pinned-panel-subject]')).toBeNull();
    expect(container.querySelector('[data-pinned-panel-coda]')).toBeNull();
  });

  it('gives the fold a way down that lands on the next panel snap point', () => {
    // Operator, W12: "put a second CTA next to download like an arrow button
    // to indicate scrollability which scrolls down to the next frame."
    //
    // It is a real link to the sentinel the browser already snaps to, so the
    // affordance and the settle position cannot drift, and this component
    // still calls no `scrollTo`.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const cue = container.querySelector('[data-fold-scroll-cue]')!;
    expect(cue).toBeTruthy();
    expect(cue.tagName).toBe('A');
    expect(cue.getAttribute('href')).toBe(`#${panelStepId(bands[1]!.id)}`);
    // A real name, not a description of the gesture.
    expect(cue.getAttribute('aria-label')).toBeTruthy();
    // The target is the panel's own snap sentinel, and exactly one element
    // owns that id.
    const targets = container.querySelectorAll(
      `[id="${panelStepId(bands[1]!.id)}"]`
    );
    expect(targets).toHaveLength(1);
    expect(targets[0]!.getAttribute('data-pinned-snap-point')).toBe(
      bands[1]!.id
    );
    // Quiet, not a second primary: no fill of its own.
    expect(cue.className).not.toContain('bg-white');
    // Inside the affordance boundary, so it never spends reading words against
    // the fold's 24-word ceiling.
    expect(cue.closest('[data-band-affordance]')).toBeTruthy();
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
    //
    // THE WHOLE LAYER, not just the column (ENG-031 W9). Asserting only the
    // column passed while the page shipped a full-width, full-height panel box
    // over the board at `z-10`, which swallowed every hover the board has ever
    // been offered on this page. The assertion is on the layer now, which is
    // the element that actually covers the board.
    const { container } = render(<PinnedBoardSequence bands={bands} />);
    const layer = container.querySelector('[data-pinned-panels-layer]')!;
    const column = container.querySelector('[data-pinned-panel-column]')!;

    expect(layer.className).toContain('pointer-events-none');
    expect(column.className).toContain('pointer-events-none');
    expect(
      container.querySelector('[data-band-affordance="download"]')!.className
    ).toContain('pointer-events-auto');
  });
});
