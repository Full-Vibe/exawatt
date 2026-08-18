'use client';

import {
  BandContent,
  BandCopy,
  BandHeading,
} from '@/components/site/bands/band-section';
import { bandById } from '@/components/site/bands/manifest';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { HeroBg } from './_hero-bg';

// The fold band owns this surface's height, width and heading role
// (ENG-031 W1); the hero owns what is inside it.
const FOLD = bandById('fold');

/**
 * The shipped fold's interior: ground, heading, subhead. Nothing else.
 *
 * THE FOLD CARRIES NO CALL TO ACTION (operator, 2026-08-17). It held a 3D
 * command key switch, then briefly a plain `Architecture` button, and both
 * came off. `/architecture` is still one click from here — the sticky header
 * carries it on every marketing route — so removing the in-fold control
 * orphans nothing; it stops the fold from spending its one loud moment on a
 * project artifact. The readiness state and its fade went with the button:
 * they existed only to reveal it, and `HeroBg` fades itself.
 */
export function HomeHero() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      className="relative flex flex-1 items-center justify-center bg-black pt-12"
      data-home-hero
      data-public-exhibition-surface="true"
    >
      <HeroBg reducedMotion={reducedMotion} />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
      <BandContent className="home-hero-content" data-home-hero-content>
        <BandHeading
          band={FOLD}
          className="home-hero-title text-white drop-shadow-lg"
          data-home-hero-title
        />
        <BandCopy className="home-hero-copy text-xs leading-relaxed text-white/80 drop-shadow-md sm:text-lg">
          <span className="block">The economy is refactoring.</span>
          <span className="block">
            Exawatt is the command interface for billions of agents.
          </span>
        </BandCopy>
      </BandContent>
    </div>
  );
}
