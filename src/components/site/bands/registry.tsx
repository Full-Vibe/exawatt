import type { ComponentType } from 'react';
import { CloseBand } from './close-band';
import { FoldBand } from './fold-band';
import type { BandId, HomepageBand } from './manifest';

export type BandComponent = ComponentType<{ band: HomepageBand }>;

/**
 * Band id to band component (ENG-031 W1, extended W5, narrowed W8).
 *
 * Keyed by every `BandId`, so adding a band to the manifest makes the compiler
 * ask for its entry here.
 *
 * `null` MEANS "THIS BAND HAS NO COMPONENT OF ITS OWN", and after W8 there are
 * three honest reasons for it:
 *
 * - a `pinned-board` band never has one, because a run of them is ONE board
 *   and several panels. `bandRuns()` collects the run and `band-stack.tsx`
 *   renders `PinnedBoardSequence` over it. Eight rows are in this state now,
 *   which is the whole middle of the page.
 * - a band whose copy moved somewhere else: `observability` into the
 *   attention panel, `open-source` into the footer column, and `proof` out to
 *   the releases page the nav's `Changelog` item now points at (W10, operator:
 *   "Remove the What shipped ... section").
 * - a band nobody has written: `voice` and `security`, each of which says in
 *   the manifest what would have to be true for anyone to write it.
 *
 * `ChapterBand` and `ThesisBand` were RETIRED by W8: every chapter is a panel
 * over the board now, so their layout lives in `pinned-board-sequence.tsx` and
 * their copy still lives in `altitude-copy.ts`.
 *
 * `fold` KEEPS ITS ENTRY, and it is used by exactly one arrangement (W6b).
 * `/` renders the pre-W3 hero through `FoldBand`. On the whole arc the fold is
 * the FIRST PANEL of the pinned run, so `bandRuns()` hands it to
 * `PinnedBoardSequence` and this entry is never reached: one board instance
 * for the page is what makes the "one continuous board" claim true, and a
 * second component mounting a second canvas is exactly what it cost before.
 */
export const BAND_COMPONENTS: Record<BandId, BandComponent | null> = {
  fold: FoldBand,
  voice: null,
  thesis: null,
  'altitude-fleet': null,
  'altitude-attention': null,
  'altitude-team': null,
  'altitude-agent': null,
  'altitude-delegation': null,
  observability: null,
  'any-lab': null,
  cost: null,
  trust: null,
  'open-source': null,
  security: null,
  proof: null,
  close: CloseBand,
};
