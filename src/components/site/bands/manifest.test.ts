import { describe, expect, it } from 'vitest';
import {
  BAND_ALTITUDE_DEPTH,
  BAND_SCREENS_MAX,
  BAND_SCREENS_MIN,
  HOMEPAGE_BANDS,
  PAGE_COPY_BUDGET,
  anchorsHeroCamera,
  bandById,
  bandRuns,
  countWords,
  heroCameraAnchors,
  HOMEPAGE_ARRANGEMENT,
  arrangementBands,
  pageCopyCeiling,
  pageScreens,
  pinnedAltitudeDepths,
  pinnedAltitudeLadder,
  pinnedBoardBands,
  proposedBands,
  reservedBands,
  shippedBands,
} from './manifest';

describe('homepage band contract', () => {
  it('keeps band identity unique in the one manifest', () => {
    expect(new Set(HOMEPAGE_BANDS.map(band => band.id)).size).toBe(
      HOMEPAGE_BANDS.length
    );
  });

  it('holds every band to one idea per screen', () => {
    for (const band of HOMEPAGE_BANDS) {
      expect(band.screens).toBeGreaterThanOrEqual(BAND_SCREENS_MIN);
      expect(band.screens).toBeLessThanOrEqual(BAND_SCREENS_MAX);
    }
  });

  it('gives the WIDEST framing the longest hold, across every panel that holds it', () => {
    // The brief's constraint is about the ALTITUDE, not about one band, and
    // W9 is what makes the difference visible: the fold and
    // `altitude-attention` are two panels at the SAME framing, so the camera
    // sits at the fold's crop for the sum of the two before it ever moves.
    // That hold is the load-bearing beat on the page, because the board
    // changing under a still camera is the one thing a competitor cannot
    // screenshot, and it may not be shorter than any other hold in the run.
    const held = new Map<string, number>();
    for (const anchor of heroCameraAnchors()) {
      const band = bandById(anchor.id);
      held.set(
        anchor.altitude,
        (held.get(anchor.altitude) ?? 0) + band.screens
      );
    }
    let widest = '';
    for (const altitude of held.keys()) {
      if (widest === '' || BAND_ALTITUDE_DEPTH[altitude as 'fleet'] <
          BAND_ALTITUDE_DEPTH[widest as 'fleet']) {
        widest = altitude;
      }
    }
    const opening = held.get(widest) ?? 0;
    for (const [altitude, screens] of held) {
      expect(screens, altitude).toBeLessThanOrEqual(opening);
    }
  });

  it('states a copy budget as a ceiling, with any floor beneath it', () => {
    for (const band of HOMEPAGE_BANDS) {
      expect(band.copyBudget.max).toBeGreaterThan(0);
      if (band.copyBudget.min !== undefined) {
        expect(band.copyBudget.min).toBeLessThanOrEqual(band.copyBudget.max);
      }
    }
  });

  it('keeps the fold under the measured above-the-fold word ceiling', () => {
    expect(bandById('fold').copyBudget.max).toBeLessThan(26);
  });

  it('keeps the closing band at ten words or fewer', () => {
    expect(bandById('close').copyBudget.max).toBeLessThanOrEqual(10);
  });

  it('requires a reserved band to say what earns it, and a shipped band not to', () => {
    for (const band of reservedBands()) {
      expect(band.reservedUntil, band.id).toBeTruthy();
    }
    for (const band of shippedBands()) {
      expect(band.reservedUntil, band.id).toBeUndefined();
    }
  });

  it('gives every operator-flagged reserve concept a declared home', () => {
    for (const id of [
      'trust',
      'open-source',
      'cost',
      'observability',
      'security',
    ] as const) {
      expect(bandById(id)).toBeDefined();
    }
  });
});

describe('homepage band ordering', () => {
  it('opens on the fold and closes on the close', () => {
    expect(HOMEPAGE_BANDS.at(0)?.id).toBe('fold');
    expect(HOMEPAGE_BANDS.at(-1)?.id).toBe('close');
  });

  it('spends loudness at the end: one headline, one closing, closing last', () => {
    const headlines = HOMEPAGE_BANDS.filter(
      band => band.headingRole === 'headline'
    );
    const closings = HOMEPAGE_BANDS.filter(
      band => band.headingRole === 'closing'
    );

    expect(headlines.map(band => band.id)).toEqual(['fold']);
    expect(closings.map(band => band.id)).toEqual(['close']);
    expect(HOMEPAGE_BANDS.at(-1)).toBe(closings[0]);
  });

  it('never carries a heading on a band that declares none', () => {
    for (const band of HOMEPAGE_BANDS) {
      if (band.headingRole === 'none') expect(band.heading, band.id).toBeNull();
    }
  });

  it('renders the shipped bands in manifest order', () => {
    const order = HOMEPAGE_BANDS.map(band => band.id);
    const shipped = shippedBands().map(band => band.id);

    expect(shipped).toEqual(order.filter(id => shipped.includes(id)));
  });

  it('derives the altitude ladder from the band order, and only ever closes in', () => {
    // AMENDED 2026-08-17 (W4): the ladder is a DIVE, not a pull-back.
    // AMENDED again (W8): the board enters at section two and STAYS.
    // AMENDED again (W6b): the fold is the run's FIRST FRAME.
    //
    // AMENDED again (W9, operator: "I think the zoom is a little bouncy, I
    // like it when it goes only one direction smoothly across multiple
    // steps"). The ladder holds the fold's crop for the attention beat, steps
    // in once while two lens panels re-read the same marks, steps in again
    // onto the Project where delegation is legible, and dives to one agent
    // last. It never opens out, at any step.
    const anchors = heroCameraAnchors();

    expect(anchors.map(anchor => anchor.id)).toEqual([
      'fold',
      'altitude-attention',
      'any-lab',
      'trust',
      'altitude-delegation',
      'altitude-agent',
    ]);
    expect(bandById('fold').altitudeAnchor).toBe('cluster');
    expect(pinnedAltitudeLadder()).toEqual([
      'cluster',
      'cluster-close',
      'cluster-close',
      'team',
      'agent',
    ]);
    expect(anchorsHeroCamera(bandById('proof'))).toBe(false);
    expect(anchorsHeroCamera(bandById('close'))).toBe(false);
  });

  it('never lets the camera reverse, so the zoom cannot go bouncy again', () => {
    // THE GUARD THE OPERATOR'S NOTE EARNED. A reordered row, a promoted
    // reserve, or a new panel given a convenient framing all fail here rather
    // than shipping a page that zooms in, out, and in again. Depth is
    // declared once in `BAND_ALTITUDE_DEPTH` and `hero-board-framings.test.ts`
    // asserts the world-unit distances agree with it, so this assertion is
    // about the real camera and not about a label.
    const depths = pinnedAltitudeDepths();
    expect(depths.length).toBeGreaterThan(1);
    for (let index = 1; index < depths.length; index += 1) {
      expect(
        depths[index]!,
        `${heroCameraAnchors()[index]!.id} must not open back out`
      ).toBeGreaterThanOrEqual(depths[index - 1]!);
    }
    // And it actually TRAVELS: a run that held one framing throughout would
    // pass a monotonicity test and say nothing.
    expect(depths.at(-1)!).toBeGreaterThan(depths[0]!);
    // The deepest rung is the last thing the page shows over the board, which
    // is what hands the reader straight to the dated list and the button.
    expect(heroCameraAnchors().at(-1)?.id).toBe('altitude-agent');
  });

  it('places every reserved band in the slot it would occupy', () => {
    const order = HOMEPAGE_BANDS.map(band => band.id);

    // The foil is named BEFORE the scale claim, and after W8 it is named as
    // the LEDE of the first panel over the board. The row still sits ahead of
    // it, so promoting it back to its own screen is a status edit.
    expect(order.indexOf('thesis')).toBeLessThan(
      order.indexOf('altitude-fleet')
    );
    // Provenance, spend and ownership run after the board has established what
    // it is, and all three finish before the dive and the dated list. W9 moved
    // them AHEAD of delegation, because saying them at the fold's crop and
    // then stepping in is the only ordering that never reverses the camera.
    for (const id of ['any-lab', 'cost', 'trust'] as const) {
      expect(order.indexOf(id), id).toBeGreaterThan(
        order.indexOf('altitude-attention')
      );
      expect(order.indexOf(id), id).toBeLessThan(
        order.indexOf('altitude-delegation')
      );
      expect(order.indexOf(id), id).toBeLessThan(order.indexOf('proof'));
    }
    // `observability` merged into the attention panel and `altitude-team` into
    // the dive. Each row keeps the slot it would take back.
    expect(order.indexOf('observability')).toBeGreaterThan(
      order.indexOf('altitude-attention')
    );
    expect(order.indexOf('altitude-team')).toBeLessThan(
      order.indexOf('altitude-agent')
    );
    // W6b reserved two more, each in the slot it would take back.
    expect(order.indexOf('altitude-fleet')).toBeLessThan(
      order.indexOf('altitude-attention')
    );
    expect(order.indexOf('cost')).toBeGreaterThan(order.indexOf('any-lab'));
  });

  it('renders materially fewer, shorter sections than the W5 arc', () => {
    // The operator's W8 verdict was about HEIGHT, so height is asserted rather
    // than intended: "/homepage-narrative has way too much height, too many
    // sections". W5 rendered fourteen bands over about 16.6 screens.
    // W6b: the operator's verdict was the same again, about text this time.
    // Eight bands over about eight and a half screens, and six of the eight
    // are one graphic.
    expect(proposedBands().length).toBeLessThanOrEqual(8);
    expect(pageScreens()).toBeLessThan(9);
    // And most of the page is ONE graphic rather than a stack of stops.
    expect(pinnedBoardBands().length + 1).toBeGreaterThanOrEqual(
      proposedBands().length - 2
    );
  });
});

describe('the pinned board run', () => {
  it('declares the run as an argument, and the board never leaves it', () => {
    const pinned = pinnedBoardBands();

    expect(pinned.map(band => band.id)).toEqual([
      'altitude-attention',
      'any-lab',
      'trust',
      'altitude-delegation',
      'altitude-agent',
    ]);
    expect(pinned.map(band => band.boardHighlight)).toEqual([
      'needs-you',
      'whole-fleet',
      'whole-fleet',
      'delegation',
      'one-agent',
    ]);
    // The LENS is what makes the two middle panels different pictures of the
    // same fleet rather than the same picture twice, which is what lets the
    // camera hold between them without repeating itself.
    expect(pinned.map(band => band.boardLens)).toEqual([
      'status',
      'source',
      'permission',
      'status',
      'status',
    ]);
  });

  it('makes every pinned band say what it points at and what it colours by, and no other band', () => {
    // "Highlighting is the point; a state change alone is not enough."
    //
    // THE FOLD IS THE ONE EXCEPTION and it is deliberate (W6b): it is the
    // graphic's first frame but it cannot carry `medium: 'pinned-board'`,
    // because `/` renders it alone and a run of one would put the proposed
    // fold on the shipped homepage. It therefore declares a lens and a
    // highlight while staying `medium: 'board'`.
    for (const band of HOMEPAGE_BANDS) {
      if (band.medium === 'pinned-board' || band.id === 'fold') {
        expect(band.boardHighlight, band.id).toBeTruthy();
        expect(band.boardLens, band.id).toBeTruthy();
        expect(band.altitudeAnchor, band.id).toBeTruthy();
      } else {
        expect(band.boardHighlight, band.id).toBeNull();
        expect(band.boardLens, band.id).toBeNull();
      }
      if (band.medium === 'pinned-board') {
        expect(band.heading, band.id).toBeTruthy();
      }
    }
  });

  it('never shows the same board twice in a row', () => {
    // A panel that leaves the camera, the emphasis AND the colouring exactly
    // where the previous panel left them is a second screen of the same
    // picture, which is the height the operator asked us to take out.
    const pinned = pinnedBoardBands();
    const state = pinned.map(
      band => `${band.altitudeAnchor}/${band.boardLens}/${band.boardHighlight}`
    );
    for (let index = 1; index < state.length; index += 1) {
      expect(state[index], pinned[index]!.id).not.toBe(state[index - 1]);
    }
  });

  it('keeps every panel to one idea per screen', () => {
    for (const band of pinnedBoardBands()) {
      expect(band.screens, band.id).toBeGreaterThanOrEqual(BAND_SCREENS_MIN);
      expect(band.screens, band.id).toBeLessThanOrEqual(BAND_SCREENS_MAX);
    }
  });

  it('collects the fold and every pinned band into ONE entry for the page', () => {
    // W6b: the fold JOINS the run rather than sitting beside it, so the page
    // mounts exactly ONE board. Before this the fold had its own `HeroBoard`
    // and the run had a second one, which shipped a visible seam, two fleet
    // chips and two legends on production.
    const bands = proposedBands();
    const runs = bandRuns(bands);
    const pinned = runs.filter(run => run.kind === 'pinned-board');

    expect(pinned).toHaveLength(1);
    expect(
      pinned[0]!.kind === 'pinned-board' ? pinned[0]!.bands.map(b => b.id) : []
    ).toEqual(['fold', ...pinnedBoardBands().map(band => band.id)]);
    expect(runs[0]!.kind).toBe('pinned-board');
    expect(runs.filter(run => run.kind === 'band')).toHaveLength(
      bands.length - pinnedBoardBands().length - 1
    );
  });

  it('leaves the shipped fold as its own band, because nothing follows it', () => {
    // The merge is conditional on a run FOLLOWING the fold. `/` renders the
    // fold alone, and a pinned run of one would put the proposed fold on the
    // shipped homepage.
    const runs = bandRuns(shippedBands());
    expect(runs).toHaveLength(1);
    expect(runs[0]!.kind === 'band' ? runs[0]!.band.id : '').toBe('fold');
  });

  it('preserves manifest order across the grouping', () => {
    const flattened = bandRuns(HOMEPAGE_BANDS).flatMap(run =>
      run.kind === 'pinned-board'
        ? run.bands.map(band => band.id)
        : [run.band.id]
    );
    expect(flattened).toEqual(HOMEPAGE_BANDS.map(band => band.id));
  });
});

describe('the two arrangements', () => {
  it('keeps `/` on the shipped fold and `/v2` on the whole arc', () => {
    expect(shippedBands().map(band => band.id)).toEqual(['fold']);
    expect(proposedBands().map(band => band.id)).toContain('close');
    expect(arrangementBands('shipped')).toEqual(shippedBands());
    expect(arrangementBands('proposed')).toEqual(proposedBands());
  });

  it('promotes the proposal with ONE value', () => {
    // The whole point of the constant: `/` follows it, the fold's interior
    // follows it, and the W6 site chrome follows it. Nothing else has to move.
    expect(arrangementBands(HOMEPAGE_ARRANGEMENT)).toEqual(
      HOMEPAGE_ARRANGEMENT === 'proposed' ? proposedBands() : shippedBands()
    );
  });

  it('declares the page copy inside the measured band, at BOTH ends', () => {
    expect(pageCopyCeiling()).toBeGreaterThanOrEqual(PAGE_COPY_BUDGET.min);
    expect(pageCopyCeiling()).toBeLessThanOrEqual(PAGE_COPY_BUDGET.max);
  });
});

describe('countWords', () => {
  it('counts a rendered band against its budget', () => {
    expect(countWords('  The economy is refactoring.  ')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});
