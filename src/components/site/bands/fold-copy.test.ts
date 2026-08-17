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
  READER_AS_BOTTLENECK,
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

  it('never makes the reader the thing that fails', () => {
    // operator, 2026-08-17, rejecting the first four variants: "'Two hundred
    // you cannot' - are you trying to pitch me that I can't watch 200 agents?"
    // The enemy is the old way of working and the tools that have not kept up.
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const prose = variantProse(variant).toLowerCase();
      for (const shape of READER_AS_BOTTLENECK) {
        expect(prose, `${variant.id} / ${shape}`).not.toContain(shape);
      }
    }
  });

  it('frames a trajectory, today into tomorrow, in every fold', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const fold = [
        variant.kicker ?? '',
        ...variant.headline,
        ...variant.subhead,
      ]
        .join(' ')
        .toLowerCase();

      expect(fold, variant.id).toMatch(
        /\b(tomorrow|about to|will run|next year)\b/u
      );
    }
  });

  it('names the tools as the bottleneck somewhere in every arrangement', () => {
    for (const variant of FOLD_CLOSE_VARIANTS) {
      expect(variantProse(variant).toLowerCase(), variant.id).toMatch(
        /your tools/u
      );
    }
  });

  it('addresses one reader and one fleet, never a possessive team', () => {
    // Operator, 2026-08-17, on the shipped study: "Exawatt is the command
    // interface for your agent fleet." Singular, no "team's". The climb from
    // 10 to 10,000 is what reaches past the single operator; the product
    // sentence stays addressed to the person reading it. The possessive made
    // a reader count other people's fleets before running one of their own.
    for (const variant of FOLD_CLOSE_VARIANTS) {
      const fold = [
        variant.kicker ?? '',
        ...variant.headline,
        ...variant.subhead,
      ]
        .join(' ')
        .toLowerCase();

      expect(fold, variant.id).not.toContain("team's");
      expect(fold, variant.id).not.toMatch(/agent fleets/u);
    }
  });

  it('keeps the kicker slot working without letting the thesis lead', () => {
    // The mechanism stays, because demoting a clause is a real arrangement
    // (B hands the whole h1 to the future number). What it must never do is
    // put the vision line back in the top slot, which the operator's own
    // draft integrated into the flow instead.
    const withKicker = FOLD_CLOSE_VARIANTS.filter(variant => variant.kicker);

    expect(withKicker.length).toBeGreaterThanOrEqual(1);
    for (const variant of withKicker) {
      expect(variant.kicker!.toLowerCase(), variant.id).not.toContain(
        'the economy is refactoring'
      );
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
