import { HomeHero } from '@/app/_home-hero';
import { BandSection } from './band-section';
import type { HomepageBand } from './manifest';

/**
 * The fold band (ENG-031 W1).
 *
 * The band owns the fold's ground and geometry: full width, one screen, and
 * the bleed up under the sticky header so the board runs to the top edge.
 *
 * Its interior is still `src/app/_home-hero.tsx`. W1 is the architecture, not
 * the redesign, so the fold renders exactly the content it rendered before.
 * W2 replaces that interior with the live board in place, which is why this
 * band wraps the hero rather than absorbing it.
 */
export function FoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className="-mt-12">
      <HomeHero />
    </BandSection>
  );
}
