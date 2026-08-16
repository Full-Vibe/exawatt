'use client';

import { useEffect, useState } from 'react';
import { CommandKeySwitchButton } from '@/components/hud/webgl/keyswitch-study';
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

const COMMAND_KEY_DELAY_MS = 1_000;
const COMMAND_KEY_FADE_DURATION_MS = 2_000;

type CommandKeyRevealPhase = 'waiting' | 'revealing' | 'ready';

export function HomeHero() {
  const reducedMotion = usePrefersReducedMotion();
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [keyPhase, setKeyPhase] = useState<CommandKeyRevealPhase>('waiting');

  useEffect(() => {
    if (!backgroundReady) return;
    if (reducedMotion) {
      setKeyPhase('ready');
      return;
    }

    const revealTimer = window.setTimeout(
      () => setKeyPhase('revealing'),
      COMMAND_KEY_DELAY_MS
    );
    const readyTimer = window.setTimeout(
      () => setKeyPhase('ready'),
      COMMAND_KEY_DELAY_MS + COMMAND_KEY_FADE_DURATION_MS
    );

    return () => {
      window.clearTimeout(revealTimer);
      window.clearTimeout(readyTimer);
    };
  }, [backgroundReady, reducedMotion]);

  const keyVisible = keyPhase !== 'waiting';
  const keyInteractive = keyPhase === 'ready';

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
          aria-hidden={!keyInteractive}
          data-home-command-key-reveal
          data-reveal-delay-ms={COMMAND_KEY_DELAY_MS}
          data-reveal-duration-ms={COMMAND_KEY_FADE_DURATION_MS}
          data-reveal-state={keyPhase}
          style={{
            opacity: keyVisible ? 1 : 0,
            transitionDuration: reducedMotion
              ? '0ms'
              : `${COMMAND_KEY_FADE_DURATION_MS}ms`,
            transitionProperty: 'opacity',
            transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
            willChange: keyPhase === 'revealing' ? 'opacity' : undefined,
          }}
        >
          <CommandKeySwitchButton
            idleHint={keyInteractive}
            interactive={keyInteractive}
          />
        </div>
      </BandContent>
    </div>
  );
}
