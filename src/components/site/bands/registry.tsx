import type { ComponentType } from 'react';
import { CloseBand } from './close-band';
import { FoldBand, ProposedFoldBand } from './fold-band';
import { ProofBand } from './proof-band';
import type { BandId, HomepageArrangement, HomepageBand } from './manifest';

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
 *   attention panel, `open-source` into the footer column.
 * - a band nobody has written: `voice` and `security`, each of which says in
 *   the manifest what would have to be true for anyone to write it.
 *
 * `ChapterBand` and `ThesisBand` were RETIRED by W8: every chapter is a panel
 * over the board now, so their layout lives in `pinned-board-sequence.tsx` and
 * their copy still lives in `narrative-copy.ts`, read through
 * `altitude-copy.ts`.
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
  proof: ProofBand,
  close: CloseBand,
};

/**
 * The ONE band that renders differently in the two arrangements.
 *
 * `/` still renders the pre-W3 hero inside the fold, because the shipped page
 * is the thing the proposal is being compared against and it must not move
 * under the comparison. `/v2` renders `FoldHero`, which is the fold as
 * proposed. Everything else is identical by construction, which is what keeps
 * the reviewed page and the shipped page from becoming two pages.
 */
const PROPOSED_BAND_COMPONENTS: Record<BandId, BandComponent | null> = {
  ...BAND_COMPONENTS,
  fold: ProposedFoldBand,
};

export function arrangementComponents(
  arrangement: HomepageArrangement
): Record<BandId, BandComponent | null> {
  return arrangement === 'proposed'
    ? PROPOSED_BAND_COMPONENTS
    : BAND_COMPONENTS;
}
