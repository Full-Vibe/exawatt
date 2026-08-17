import { HomeHero } from '@/app/_home-hero';
import { BandSection } from './band-section';
import type { HomepageBand } from './manifest';

/**
 * The fold band (ENG-031 W1, W3).
 *
 * The band owns the fold's ground and geometry: full width, one screen, and
 * the bleed up under the sticky header so the board runs to the top edge.
 * Exported because the W3 copy study renders the real band, not a mock of it.
 */
export const FOLD_BAND_CLASS = '-mt-12';

/**
 * Its interior is still `src/app/_home-hero.tsx`, deliberately.
 *
 * W3 built the shipping interior (`fold-hero.tsx`) as FOUR complete
 * arrangements of the fold and the close, switchable at
 * `/hud-gallery/fold-close`. Wiring one of them in here is the operator's
 * pick, not an agent's, and it lands together with retiring the homepage key
 * switch and its `t8-home-keyswitch` R3F battery, since "the 3D key switch
 * comes off the site" is the same edit. Until then the shipped fold renders
 * exactly what it rendered before.
 */
export function FoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className={FOLD_BAND_CLASS}>
      <HomeHero />
    </BandSection>
  );
}
