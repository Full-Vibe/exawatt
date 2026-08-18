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
 * the comparison. Its interior has stopped carrying a call to action at all
 * (operator, 2026-08-17): the 3D command key switch came off, the plain
 * `Architecture` button that briefly replaced it came off too, and the sticky
 * header is now the only route from here to `/architecture`. That converges
 * with the proposed fold on ONE point and no more — the proposed fold spends
 * the slot on `DownloadCta` rather than leaving it empty, so flipping
 * `HOMEPAGE_ARRANGEMENT` to `proposed` is still a real change to this band.
 *
 * The `t8-home-keyswitch` R3F battery retired with the key switch. `t7`
 * (material workbench) and `t9` (agent-start eval) stay, along with the
 * `/hud-gallery` workbench itself: decision
 * `0025-reactivate-keyswitch-gallery-study` keeps that surface as the
 * material study bench, independent of what ships on `/`.
 */
export const FOLD_BAND_CLASS = '-mt-12';

export function FoldBand({ band }: { band: HomepageBand }) {
  return (
    <BandSection band={band} className={FOLD_BAND_CLASS}>
      <HomeHero />
    </BandSection>
  );
}
