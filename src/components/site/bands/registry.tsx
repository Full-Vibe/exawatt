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
