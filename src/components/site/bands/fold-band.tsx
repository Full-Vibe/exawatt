import { HomeHero } from '@/app/_home-hero';
import { BandSection } from './band-section';
import { FoldHero } from './fold-hero';
import type { HomepageBand } from './manifest';

/**
 * The fold band (ENG-031 W1, W3, W8).
 *
 * The band owns the fold's ground and geometry: full width, one screen, and
 * the bleed up under the sticky header so the board runs to the top edge.
 * Exported because the W3 copy study renders the real band, not a mock of it.
 */
export const FOLD_BAND_CLASS = '-mt-12';

/**
 * The SHIPPED fold, still `src/app/_home-hero.tsx`.
 *
 * `/` is the page the proposal is compared against, so it must not move under
 * the comparison. Retiring this component, the homepage command key switch and
 * the `t8-home-keyswitch` R3F battery is the same edit as flipping
 * `HOMEPAGE_ARRANGEMENT` to `proposed`, because "the 3D key switch comes off
 * the site" is what the proposed fold does.
 */
export function FoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className={FOLD_BAND_CLASS}>
      <HomeHero />
    </BandSection>
  );
}

/**
 * The PROPOSED fold: the live Fleet board with the type in a radial well, the
 * one primary download, and the requirement at the button.
 *
 * It is the same board the pinned run continues one section later, which is
 * the seam W8 closed: the persistent graphic genuinely begins in the fold
 * instead of being cut to from a photograph.
 */
export function ProposedFoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className={FOLD_BAND_CLASS}>
      <FoldHero />
    </BandSection>
  );
}
