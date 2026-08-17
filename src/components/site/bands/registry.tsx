import type { ComponentType } from 'react';
import { FoldBand } from './fold-band';
import type { BandId, HomepageBand } from './manifest';

export type BandComponent = ComponentType<{ band: HomepageBand }>;

/**
 * Band id to band component (ENG-031 W1).
 *
 * Keyed by every `BandId`, so adding a band to the manifest makes the compiler
 * ask for its entry here. `null` is the honest value for a reserved band: the
 * slot is declared and nothing renders.
 *
 * Promoting a reserved band to the page is therefore two edits and one new
 * file: flip `status` in `manifest.ts`, write the component, replace the
 * `null` here. `src/app/page.tsx` never changes.
 *
 * ONE KIND OF BAND IS NOT REGISTERED HERE (ENG-031 W4): a `pinned-board` band
 * has no component of its own, because a run of them is ONE board and several
 * panels rather than several bands that each mount a board. `bandRuns()`
 * collects the run and `band-stack.tsx` renders `PinnedBoardSequence` over it.
 * Their entries stay `null` forever, and that is the honest value.
 */
export const BAND_COMPONENTS: Record<BandId, BandComponent | null> = {
  fold: FoldBand,
  voice: null,
  thesis: null,
  'altitude-agent': null,
  'altitude-team': null,
  'altitude-fleet': null,
  observability: null,
  'any-lab': null,
  'open-source': null,
  trust: null,
  security: null,
  cost: null,
  proof: null,
  close: null,
};
