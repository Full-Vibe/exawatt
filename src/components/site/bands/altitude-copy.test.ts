import { describe, expect, it } from 'vitest';
import { HERO_BOARD_CAPTURE } from '@/components/site/hero-board/capture';
import { ALTITUDE_PANELS, altitudePanel, panelWords } from './altitude-copy';
import { FOLD_FORBIDDEN, READER_AS_BOTTLENECK } from './fold-copy';
import { bandById, pinnedBoardBands } from './manifest';

/**
 * The pinned sequence's copy contract (ENG-031 W4). Same rules the fold lives
 * under, asserted here so a panel cannot quietly reintroduce a shape the
 * operator already rejected.
 */
describe('altitude panel copy', () => {
  it('writes exactly one panel for each band that drives the board', () => {
    expect(ALTITUDE_PANELS.map(panel => panel.id)).toEqual(
      pinnedBoardBands().map(band => band.id)
    );
    for (const band of pinnedBoardBands()) {
      expect(altitudePanel(band.id), band.id).toBeDefined();
      expect(band.heading, band.id).toBeTruthy();
    }
  });

  it('holds every panel inside its declared budget, floor and ceiling', () => {
    for (const panel of ALTITUDE_PANELS) {
      const budget = bandById(panel.id).copyBudget;
      expect(panelWords(panel), panel.id).toBeLessThanOrEqual(budget.max);
      expect(panelWords(panel), panel.id).toBeGreaterThanOrEqual(
        budget.min ?? 1
      );
    }
  });

  it('never uses an em dash', () => {
    for (const panel of ALTITUDE_PANELS) {
      expect(panel.copy.join(' '), panel.id).not.toMatch(/[—–]/u);
      expect(bandById(panel.id).heading ?? '', panel.id).not.toMatch(/[—–]/u);
    }
  });

  it('never makes the reader the thing that fails', () => {
    for (const panel of ALTITUDE_PANELS) {
      const prose = [bandById(panel.id).heading ?? '', ...panel.copy]
        .join(' ')
        .toLowerCase();
      for (const shape of READER_AS_BOTTLENECK) {
        expect(prose, `${panel.id} / ${shape}`).not.toContain(shape);
      }
    }
  });

  it('keeps the five named words out of the panels too', () => {
    for (const panel of ALTITUDE_PANELS) {
      const prose = panel.copy.join(' ').toLowerCase();
      for (const word of FOLD_FORBIDDEN) {
        expect(prose, `${panel.id} / ${word}`).not.toContain(
          word.toLowerCase()
        );
      }
    }
  });

  it('describes the product, never the page or the scrolling', () => {
    // Production voice: show product state, do not explain the mechanism to
    // the reader. "Scroll down to see" is documentation, not a value line.
    const banned = ['scroll', 'below', 'above', 'this page', 'graphic'];
    for (const panel of ALTITUDE_PANELS) {
      const prose = panel.copy.join(' ').toLowerCase();
      for (const word of banned) {
        expect(prose, `${panel.id} / ${word}`).not.toContain(word);
      }
    }
  });

  it('never hardcodes a fixture name the capture owns', () => {
    // The subject's name comes from `hero-board-highlight.ts`, off the frozen
    // capture, so a regenerated capture can never leave the copy lying.
    //
    // The list is READ OFF THE CAPTURE (W9) rather than typed here. It used to
    // name three Projects, and when the fixture renamed all ten the assertion
    // was silently guarding names that no longer existed. Derived, it cannot
    // go stale.
    const names = HERO_BOARD_CAPTURE.zones.map(zone => zone.label);
    expect(names.length).toBeGreaterThan(0);
    for (const panel of ALTITUDE_PANELS) {
      for (const name of names) {
        expect(panel.copy.join(' '), panel.id).not.toContain(name);
      }
    }
  });
});
