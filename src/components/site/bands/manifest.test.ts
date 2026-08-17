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
  pageCopyCeiling,
  pinnedAltitudeLadder,
  pinnedBoardBands,
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

  it('declares page copy inside the measured band, at BOTH ends', () => {
    // W1 recorded the gap and could only assert the ceiling, because the nine
    // core bands summed to about 474 words: premium, and under the floor a
    // page has to clear to be communicative as well. W5's narrative copy is
    // what closes it, so the floor is now enforced rather than noted.
    expect(pageCopyCeiling()).toBeGreaterThanOrEqual(PAGE_COPY_BUDGET.min);
    expect(pageCopyCeiling()).toBeLessThanOrEqual(PAGE_COPY_BUDGET.max);
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
    // changes as you scroll, and the fold's board is the Fleet. Cutting from
    // the Fleet to one agent and starting over would be a different picture.
    const anchors = heroCameraAnchors();

    expect(anchors.map(anchor => anchor.id)).toEqual([
      'fold',
      'altitude-fleet',
      'altitude-attention',
      'altitude-team',
      'altitude-agent',
      'altitude-delegation',
    ]);
    // The fold opens on the cropped board and the sequence continues it. Two
    // properties of the W5 ladder are deliberate and would look like bugs
    // without this note: the first two panels SHARE an altitude, so the camera
    // holds while the board makes the argument, and the last one REVERSES, so
    // the run ends opening back out into the trajectory the fold promised.
    expect(anchors.slice(1).map(anchor => anchor.altitude)).toEqual([
      'fleet',
      'fleet',
      'team',
      'agent',
      'fleet',
    ]);
    expect(pinnedAltitudeLadder()).toEqual([
      'fleet',
      'fleet',
      'team',
      'agent',
      'fleet',
    ]);
    expect(anchorsHeroCamera(bandById('proof'))).toBe(false);
  });

  it('places every reserved band in the slot it would occupy', () => {
    const order = HOMEPAGE_BANDS.map(band => band.id);

    // `observability` sits directly behind the run: the truthful status claim
    // is a claim about colours the reader has just watched change.
    expect(order.indexOf('observability')).toBe(
      order.indexOf('altitude-delegation') + 1
    );
    // The foil is named BEFORE the board, which is what makes the board read
    // as evidence rather than as a product tour.
    expect(order.indexOf('thesis')).toBeLessThan(
      order.indexOf('altitude-fleet')
    );
    expect(order.indexOf('open-source')).toBeGreaterThan(
      order.indexOf('any-lab')
    );
    for (const id of ['trust', 'security', 'cost'] as const) {
      expect(order.indexOf(id), id).toBeGreaterThan(order.indexOf('any-lab'));
      expect(order.indexOf(id), id).toBeLessThan(order.indexOf('proof'));
    }
  });
});

describe('the pinned board run', () => {
  it('declares the run as an argument: scale, attention, depth, delegation', () => {
    const pinned = pinnedBoardBands();

    expect(pinned.map(band => band.id)).toEqual([
      'altitude-fleet',
      'altitude-attention',
      'altitude-team',
      'altitude-agent',
      'altitude-delegation',
    ]);
    expect(pinned.map(band => band.boardHighlight)).toEqual([
      'whole-fleet',
      'needs-you',
      'one-project',
      'one-agent',
      'delegation',
    ]);
  });

  it('makes every pinned band say what it points at, and no other band', () => {
    // "Highlighting is the point; a state change alone is not enough."
    for (const band of HOMEPAGE_BANDS) {
      if (band.medium === 'pinned-board') {
        expect(band.boardHighlight, band.id).toBeTruthy();
        expect(band.altitudeAnchor, band.id).toBeTruthy();
        expect(band.heading, band.id).toBeTruthy();
      } else {
        expect(band.boardHighlight, band.id).toBeNull();
      }
    }
  });

  it('gives every pinned band a distinct emphasis', () => {
    const highlights = pinnedBoardBands().map(band => band.boardHighlight);
    expect(new Set(highlights).size).toBe(highlights.length);
  });

  it('keeps every panel to one idea per screen', () => {
    for (const band of pinnedBoardBands()) {
      expect(band.screens, band.id).toBeGreaterThanOrEqual(BAND_SCREENS_MIN);
      expect(band.screens, band.id).toBeLessThanOrEqual(BAND_SCREENS_MAX);
    }
  });

  it('collects consecutive pinned bands into ONE entry for the page', () => {
    const runs = bandRuns(HOMEPAGE_BANDS);
    const pinned = runs.filter(run => run.kind === 'pinned-board');

    expect(pinned).toHaveLength(1);
    expect(
      pinned[0]!.kind === 'pinned-board' ? pinned[0]!.bands.map(b => b.id) : []
    ).toEqual(pinnedBoardBands().map(band => band.id));
    // Everything else still walks the page one band at a time.
    expect(runs.filter(run => run.kind === 'band')).toHaveLength(
      HOMEPAGE_BANDS.length - pinnedBoardBands().length
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

describe('countWords', () => {
  it('counts a rendered band against its budget', () => {
    expect(countWords('  The economy is refactoring.  ')).toBe(4);
    expect(countWords('')).toBe(0);
  });
});
