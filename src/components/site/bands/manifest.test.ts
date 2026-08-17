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

  it('gives the fleet altitude the longest hold on the page', () => {
    const fleet = bandById('altitude-fleet');
    for (const band of HOMEPAGE_BANDS) {
      expect(band.screens).toBeLessThanOrEqual(fleet.screens);
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

  it('cannot declare more page copy than the measured maximum', () => {
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
      'altitude-team',
      'altitude-agent',
    ]);
    // the fold opens on the cropped board, and the sequence continues it
    expect(anchors.slice(1).map(anchor => anchor.altitude)).toEqual([
      'fleet',
      'team',
      'agent',
    ]);
    expect(anchorsHeroCamera(bandById('proof'))).toBe(false);
  });

  it('places every reserved band in the slot it would occupy', () => {
    const order = HOMEPAGE_BANDS.map(band => band.id);

    expect(order.indexOf('observability')).toBeGreaterThan(
      order.indexOf('altitude-agent')
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
  it('declares the three altitudes as one run, in dive order', () => {
    const pinned = pinnedBoardBands();

    expect(pinned.map(band => band.id)).toEqual([
      'altitude-fleet',
      'altitude-team',
      'altitude-agent',
    ]);
    expect(pinned.map(band => band.altitudeAnchor)).toEqual([
      'fleet',
      'team',
      'agent',
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

  it('keeps the fleet altitude the longest hold, after the reorder', () => {
    const fleet = bandById('altitude-fleet');
    for (const band of pinnedBoardBands()) {
      expect(band.screens, band.id).toBeLessThanOrEqual(fleet.screens);
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
