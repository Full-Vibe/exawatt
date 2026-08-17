import { describe, expect, it } from 'vitest';
import {
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

  it('gives the fleet ALTITUDE the longest hold, across every panel that holds it', () => {
    // The brief's constraint is about the ALTITUDE, not about one band, and
    // W5 is what makes the difference visible: `altitude-fleet` and
    // `altitude-attention` are two panels at the same altitude, so the camera
    // sits at the Fleet framing for the sum of the two. `altitude-attention`
    // is individually the longest single hold on the page on purpose, because
    // the board changing under a still camera is the load-bearing beat.
    const held = new Map<string, number>();
    for (const band of pinnedBoardBands()) {
      const altitude = band.altitudeAnchor!;
      held.set(altitude, (held.get(altitude) ?? 0) + band.screens);
    }
    const fleet = held.get('fleet') ?? 0;
    for (const [altitude, screens] of held) {
      expect(screens, altitude).toBeLessThanOrEqual(fleet);
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

  it('derives the altitude ladder from the band order, fleet in to agent', () => {
    // AMENDED 2026-08-17 (W4): the ladder is a DIVE, not a pull-back. The
    // operator asked to keep the fold's own board as a persistent graphic that
    // changes as you scroll, and the fold's board is the Fleet.
    //
    // AMENDED again (W8): the board enters at section two and STAYS. So the
    // ladder holds at the fleet framing for the claim and the attention beat,
    // dives once to a single agent, opens all the way back out for delegation,
    // and stays out while the three lens panels re-read the same fleet from a
    // different property of the same marks.
    const anchors = heroCameraAnchors();

    expect(anchors.map(anchor => anchor.id)).toEqual([
      'fold',
      'altitude-fleet',
      'altitude-attention',
      'altitude-agent',
      'altitude-delegation',
      'any-lab',
      'cost',
      'trust',
    ]);
    expect(pinnedAltitudeLadder()).toEqual([
      'fleet',
      'fleet',
      'agent',
      'fleet',
      'fleet',
      'fleet',
      'fleet',
    ]);
    expect(anchorsHeroCamera(bandById('proof'))).toBe(false);
    expect(anchorsHeroCamera(bandById('close'))).toBe(false);
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
    // it is, and all three finish before the dated list.
    for (const id of ['any-lab', 'cost', 'trust'] as const) {
      expect(order.indexOf(id), id).toBeGreaterThan(
        order.indexOf('altitude-delegation')
      );
      expect(order.indexOf(id), id).toBeLessThan(order.indexOf('proof'));
    }
    // `observability` merged into the attention panel and `altitude-team` into
    // the dive. Each row keeps the slot it would take back.
    expect(order.indexOf('observability')).toBeGreaterThan(
      order.indexOf('altitude-delegation')
    );
    expect(order.indexOf('altitude-team')).toBeLessThan(
      order.indexOf('altitude-agent')
    );
  });

  it('renders materially fewer, shorter sections than the W5 arc', () => {
    // The operator's W8 verdict was about HEIGHT, so height is asserted rather
    // than intended: "/homepage-narrative has way too much height, too many
    // sections". W5 rendered fourteen bands over about 16.6 screens.
    expect(proposedBands().length).toBeLessThanOrEqual(11);
    expect(pageScreens()).toBeLessThan(12);
    // And most of the page is ONE graphic rather than a stack of stops.
    expect(pinnedBoardBands().length).toBeGreaterThanOrEqual(
      proposedBands().length - 4
    );
  });
});

describe('the pinned board run', () => {
  it('declares the run as an argument, and the board never leaves it', () => {
    const pinned = pinnedBoardBands();

    expect(pinned.map(band => band.id)).toEqual([
      'altitude-fleet',
      'altitude-attention',
      'altitude-agent',
      'altitude-delegation',
      'any-lab',
      'cost',
      'trust',
    ]);
    expect(pinned.map(band => band.boardHighlight)).toEqual([
      'whole-fleet',
      'needs-you',
      'one-agent',
      'delegation',
      'whole-fleet',
      'whole-fleet',
      'whole-fleet',
    ]);
    // The LENS is what makes the last three panels different pictures of the
    // same fleet rather than the same picture three times.
    expect(pinned.map(band => band.boardLens)).toEqual([
      'status',
      'status',
      'status',
      'status',
      'source',
      'burn',
      'permission',
    ]);
  });

  it('makes every pinned band say what it points at and what it colours by, and no other band', () => {
    // "Highlighting is the point; a state change alone is not enough."
    for (const band of HOMEPAGE_BANDS) {
      if (band.medium === 'pinned-board') {
        expect(band.boardHighlight, band.id).toBeTruthy();
        expect(band.boardLens, band.id).toBeTruthy();
        expect(band.altitudeAnchor, band.id).toBeTruthy();
        expect(band.heading, band.id).toBeTruthy();
      } else {
        expect(band.boardHighlight, band.id).toBeNull();
        expect(band.boardLens, band.id).toBeNull();
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

  it('collects consecutive pinned bands into ONE entry for the page', () => {
    const bands = proposedBands();
    const runs = bandRuns(bands);
    const pinned = runs.filter(run => run.kind === 'pinned-board');

    expect(pinned).toHaveLength(1);
    expect(
      pinned[0]!.kind === 'pinned-board' ? pinned[0]!.bands.map(b => b.id) : []
    ).toEqual(pinnedBoardBands().map(band => band.id));
    // The run starts at SECTION TWO, immediately after the fold (operator,
    // W8), and everything before and after it walks one band at a time.
    expect(runs[0]!.kind === 'band' ? runs[0]!.band.id : '').toBe('fold');
    expect(runs[1]!.kind).toBe('pinned-board');
    expect(runs.filter(run => run.kind === 'band')).toHaveLength(
      bands.length - pinnedBoardBands().length
    );
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
