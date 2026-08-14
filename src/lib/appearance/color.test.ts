import { describe, expect, it } from 'vitest';
import {
  ACTION_SURFACE_MINIMUM,
  contrastRatio,
  correctAccentContrast,
} from './color';

/**
 * ENG-016 FIX-011. The operator, on a real build: "One of the buttons in the
 * close-confirm dialogue should be default… Zero buttons blue looks odd."
 *
 * The dialog did mark its default — a filled action button beside an outlined
 * Cancel. The mark just carried on HUE, and D32 hands the action colour to
 * the operator's macOS highlight. Set that to Graphite and the fill lands a
 * few percent off the panel behind it: filled and outlined collapse into the
 * same grey, and no button reads as the default.
 */
describe('correctAccentContrast', () => {
  const TEXT = '#04060B';
  const FALLBACK = '#19E6FF';

  it('keeps an accent that is already legible', () => {
    expect(correctAccentContrast('#19E6FF', TEXT, FALLBACK)).toBe('#19E6FF');
  });

  it('falls back when either colour is not a hex colour', () => {
    expect(correctAccentContrast('rebeccapurple', TEXT, FALLBACK)).toBe(
      FALLBACK
    );
  });

  it('lifts an accent that cannot carry its own label', () => {
    // near-black accent under near-black text
    const corrected = correctAccentContrast('#0A0A0A', TEXT, FALLBACK);
    expect(contrastRatio(corrected, TEXT)).toBeGreaterThanOrEqual(4.5);
  });

  // The defect: macOS Graphite on a light panel. It reads its own label fine,
  // so the old correction returned it untouched, and the filled default then
  // sat almost exactly on the surface behind it.
  it('separates a Graphite accent from the surface it is filled onto', () => {
    const GRAPHITE = '#8E8E93';
    const SURFACE = '#F5F5F5';

    const uncorrected = correctAccentContrast(GRAPHITE, TEXT, FALLBACK);
    const corrected = correctAccentContrast(
      GRAPHITE,
      TEXT,
      FALLBACK,
      undefined,
      SURFACE
    );

    // it passed the label check on its own, which is why this slipped through
    expect(contrastRatio(uncorrected, TEXT)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(corrected, SURFACE)).toBeGreaterThanOrEqual(
      ACTION_SURFACE_MINIMUM
    );
    // and it still has to carry its label after being moved
    expect(contrastRatio(corrected, TEXT)).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves an accent alone when it already stands off the surface', () => {
    expect(
      correctAccentContrast('#19E6FF', TEXT, FALLBACK, undefined, '#0A0A0A')
    ).toBe('#19E6FF');
  });

  it('is unchanged for callers that pass no surface', () => {
    const GRAPHITE = '#8E8E93';
    expect(correctAccentContrast(GRAPHITE, TEXT, FALLBACK)).toBe(
      correctAccentContrast(GRAPHITE, TEXT, FALLBACK, undefined, undefined)
    );
  });
});
