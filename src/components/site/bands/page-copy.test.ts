import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLD_CLOSE_VARIANT,
  closeWords,
  foldCloseVariant,
  foldWords,
} from './fold-copy';
import { pinnedRunWords } from './altitude-copy';
import { PAGE_COPY_BUDGET } from './manifest';

/**
 * The whole page, counted (ENG-031 W5, moved here in W10).
 *
 * The 16-site study's governing number is 1,200 to 1,700 words for a page that
 * is both premium and communicative, and W1 shipped the band system knowing
 * the declared bands summed to about 474. This is the assertion that says the
 * gap is closed in the copy rather than in the budgets: it counts what is
 * actually WRITTEN, not what is allowed.
 *
 * It used to live in `narrative-copy.test.ts` beside the dated changelog. W10
 * removed the `What shipped` band (operator: "Remove the What shipped ...
 * section"), which took the last of that file's own subject with it, so the
 * page-level count moved to a file named for what it measures and the file
 * named for a deleted band went with the band.
 */
describe('the page, counted', () => {
  const variant = foldCloseVariant(DEFAULT_FOLD_CLOSE_VARIANT);

  /** Every word a reader reads: the fold, the six pinned panels, the close.
   *  The thesis is a PANEL after W8, so `pinnedRunWords()` already counts it,
   *  and adding it again is the double count that would make a shorter page
   *  look longer than it is. */
  function writtenWords(): number {
    return foldWords(variant) + pinnedRunWords() + closeWords(variant);
  }

  it('lands inside the measured word band', () => {
    const words = writtenWords();
    expect(words).toBeGreaterThanOrEqual(PAGE_COPY_BUDGET.min);
    expect(words).toBeLessThanOrEqual(PAGE_COPY_BUDGET.max);
  });

  it('still spends almost nothing above the fold', () => {
    // The fold spends nothing; the scroll spends everything.
    expect(foldWords(variant)).toBeLessThan(26);
    expect(closeWords(variant)).toBeLessThanOrEqual(10);
  });
});
