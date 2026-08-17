import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_HREF,
  DOWNLOAD_LABEL,
  DOWNLOAD_REQUIREMENT,
} from './download';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  FOLD_CLOSE_VARIANTS,
  FOLD_FORBIDDEN,
  closeWords,
  foldBudget,
  foldCloseVariant,
  foldWords,
  variantProse,
} from './fold-copy';
import { bandById } from './manifest';

/**
 * The copy contract (ENG-031 W3). Every rule here is a measured constraint
 * from the 16-site study or a recorded operator rule, and each is enforced
 * against every variant, so a later edit cannot quietly break one.
 */
describe('fold and close copy', () => {
  it('offers the operator three to four complete arrangements', () => {
    expect(FOLD_CLOSE_VARIANTS.length).toBeGreaterThanOrEqual(3);
    expect(FOLD_CLOSE_VARIANTS.length).toBeLessThanOrEqual(4);
    expect(new Set(FOLD_CLOSE_VARIANTS.map(v => v.id)).size).toBe(
      FOLD_CLOSE_VARIANTS.length
    );
  });

  it('holds every variant under the measured word ceiling above the fold', () => {
    // "Under 26 words above the fold", six sites, six confirmations.
    expect(foldBudget()).toBeLessThan(26);
    for (const variant of FOLD_CLOSE_VARIANTS) {
      expect(foldWords(variant), variant.id).toBeLessThanOrEqual(foldBudget());
      expect(foldWords(variant), variant.id).toBeGreaterThan(0);
    }
  });

  it('holds every closing line to ten words or fewer', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      expect(closeWords(variant), variant.id).toBeLessThanOrEqual(
        bandById('close').copyBudget.max
      );
    }
  });

  it('never uses an em dash, in any variant', () => {
    // operator, 2026-08-13: "that's an AI smell".
    for (const variant of FOLD_CLOSE_VARIANTS) {
      expect(variantProse(variant), variant.id).not.toMatch(/[—–]/u);
    }
    expect(DOWNLOAD_REQUIREMENT).not.toMatch(/[—–]/u);
    expect(DOWNLOAD_LABEL).not.toMatch(/[—–]/u);
  });

  it('keeps the five named words out of the fold and the close', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const prose = variantProse(variant).toLowerCase();
      for (const word of FOLD_FORBIDDEN) {
        expect(prose, `${variant.id} / ${word}`).not.toContain(
          word.toLowerCase()
        );
      }
    }
  });

  it('develops both directions the operator selected', () => {
    const headlines = FOLD_CLOSE_VARIANTS.map(v => v.headline.join(' '));

    expect(
      headlines.filter(line =>
        line.includes('One agent you can watch. Two hundred you cannot.')
      ).length
    ).toBeGreaterThanOrEqual(1);
    expect(
      headlines.filter(line => line.includes('Command a fleet of 100 agents.'))
        .length
    ).toBeGreaterThanOrEqual(1);
  });

  it('gives the thesis line a genuine two-way door', () => {
    const thesis = 'The economy is refactoring.';

    // At least one variant keeps it as the h1 proper.
    const asHeadline = FOLD_CLOSE_VARIANTS.filter(v =>
      v.headline.join(' ').includes(thesis)
    );
    // At least one demotes it to a small kicker above a control-thesis h1.
    const asKicker = FOLD_CLOSE_VARIANTS.filter(v =>
      v.kicker?.includes(thesis)
    );

    expect(asHeadline.length).toBeGreaterThanOrEqual(1);
    expect(asKicker.length).toBeGreaterThanOrEqual(1);
    for (const variant of asKicker) {
      expect(variant.headline.join(' '), variant.id).not.toContain(thesis);
    }
  });

  it('states the product, not only the problem, in every variant', () => {
    // The standing test: a cold reader must be able to restate WHAT it is.
    for (const variant of FOLD_CLOSE_VARIANTS) {
      expect(
        [variant.kicker ?? '', ...variant.headline, ...variant.subhead].join(
          ' '
        ),
        variant.id
      ).toContain('Exawatt');
    }
  });

  it('resolves an unknown or missing selection to the shipping default', () => {
    expect(foldCloseVariant(null).id).toBe(DEFAULT_FOLD_CLOSE_VARIANT);
    expect(foldCloseVariant('zzz').id).toBe(DEFAULT_FOLD_CLOSE_VARIANT);
    expect(foldCloseVariant('b').id).toBe('b');
  });
});

describe('the download affordance', () => {
  it('names the OS at the button', () => {
    expect(DOWNLOAD_LABEL).toMatch(/Mac/u);
    expect(DOWNLOAD_HREF).toBe('/download');
  });

  it('states the real requirement, pinned from the build', () => {
    // electron-builder.yml ships arm64 only; Electron 43's Info.plist declares
    // LSMinimumSystemVersion 12.0. Both are re-checked when either moves.
    expect(DOWNLOAD_REQUIREMENT).toContain('macOS 12');
    expect(DOWNLOAD_REQUIREMENT).toContain('Apple silicon');
  });

  it('never promises a distribution channel that does not exist', () => {
    expect(DOWNLOAD_REQUIREMENT.toLowerCase()).not.toContain('brew');
  });
});
