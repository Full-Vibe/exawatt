'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
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

export function HomeHero() {
  const reducedMotion = usePrefersReducedMotion();
  const [backgroundReady, setBackgroundReady] = useState(false);

  return (
    <div
      className="relative flex flex-1 items-center justify-center bg-black pt-12"
      data-background-ready={backgroundReady ? 'true' : 'false'}
      data-home-hero
      data-public-exhibition-surface="true"
    >
      <HeroBg
        onFadeInComplete={() => setBackgroundReady(true)}
        reducedMotion={reducedMotion}
      />
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
        <div
          aria-hidden={!backgroundReady}
          data-home-architecture-cta
          style={{
            opacity: backgroundReady ? 1 : 0,
            transitionDuration: reducedMotion ? '0ms' : '500ms',
            transitionProperty: 'opacity',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          <Button
            asChild
            className="h-11 rounded-md bg-white px-7 text-base font-semibold text-black shadow-lg hover:bg-white/90"
            data-home-architecture-button
            tabIndex={backgroundReady ? undefined : -1}
          >
            <Link href="/architecture">Architecture</Link>
          </Button>
        </div>
      </BandContent>
    </div>
  );
}
