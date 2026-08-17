import type { ComponentType } from 'react';
import { ChapterBand } from './chapter-band';
import { CloseBand } from './close-band';
import { FoldBand } from './fold-band';
import { ProofBand } from './proof-band';
import { ThesisBand } from './thesis-band';
import type { BandId, HomepageBand } from './manifest';

export type BandComponent = ComponentType<{ band: HomepageBand }>;

/**
 * Band id to band component (ENG-031 W1, extended W5).
 *
 * Keyed by every `BandId`, so adding a band to the manifest makes the compiler
 * ask for its entry here.
 *
 * `null` MEANS "NOTHING IS WRITTEN YET", not "reserved". After W5 those are
 * two different states and the difference matters:
 *
 * - a band with `null` here has no copy and no component. `voice` and
 *   `security` are the two, and each says in the manifest what would have to
 *   be true for anyone to write it.
 * - a band with a component here and `status: 'reserved'` in the manifest is
 *   WRITTEN AND REVIEWABLE, parked one word away from the page. Everything in
 *   the narrative pass is in this state on purpose: the copy is the operator's
 *   call, and `/hud-gallery/homepage-narrative` is where he reads it. Shipping
 *   it is flipping `status`, in the manifest, with no code change at all.
 *
 * ONE KIND OF BAND IS NEVER REGISTERED HERE (ENG-031 W4): a `pinned-board`
 * band has no component of its own, because a run of them is ONE board and
 * several panels rather than several bands that each mount a board.
 * `bandRuns()` collects the run and `band-stack.tsx` renders
 * `PinnedBoardSequence` over it. Their entries stay `null` forever, and that
 * is the honest value.
 */
export const BAND_COMPONENTS: Record<BandId, BandComponent | null> = {
  fold: FoldBand,
  voice: null,
  thesis: ThesisBand,
  'altitude-fleet': null,
  'altitude-attention': null,
  'altitude-team': null,
  'altitude-agent': null,
  'altitude-delegation': null,
  observability: ChapterBand,
  'any-lab': ChapterBand,
  cost: ChapterBand,
  trust: ChapterBand,
  'open-source': ChapterBand,
  security: null,
  proof: ProofBand,
  close: CloseBand,
};
