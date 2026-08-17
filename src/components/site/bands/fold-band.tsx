import { HomeHero } from '@/app/_home-hero';
import { BandSection } from './band-section';
import type { HomepageBand } from './manifest';

/**
 * The fold band (ENG-031 W1, W3, W8, narrowed W6b).
 *
 * ONLY THE SHIPPED FOLD LIVES HERE NOW. On the whole arc the fold is the first
 * panel of the pinned run and `PinnedBoardSequence` renders its interior, so
 * that the page mounts exactly one board. `ProposedFoldBand` and
 * `FoldBackground` are deleted rather than left switchable: a second component
 * that mounts a second `HeroBoard` is the defect this pass removed.
 *
 * `/` is the page the proposal is compared against, so it must not move under
 * the comparison. Retiring this component, the homepage command key switch and
 * the `t8-home-keyswitch` R3F battery is the same edit as flipping
 * `HOMEPAGE_ARRANGEMENT` to `proposed`, because "the 3D key switch comes off
 * the site" is what the proposed fold already does.
 */
export const FOLD_BAND_CLASS = '-mt-12';

export function FoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className={FOLD_BAND_CLASS}>
      <HomeHero />
    </BandSection>
  );
}
