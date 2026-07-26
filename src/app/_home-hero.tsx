'use client';

import { useEffect, useState } from 'react';
import { CommandKeySwitchButton } from '@/components/hud/webgl/keyswitch-study';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { HeroBg } from './_hero-bg';

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
      className="relative -mt-12 flex min-h-screen items-center justify-center bg-black pt-12"
      data-background-ready={backgroundReady ? 'true' : 'false'}
      data-home-hero
    >
      <HeroBg
        onFadeInComplete={() => setBackgroundReady(true)}
        reducedMotion={reducedMotion}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/50 to-black/80" />
      <main
        className="home-hero-content relative z-10 flex flex-col items-center gap-8 px-4 text-center"
        data-home-hero-content
      >
        <h1
          className="home-hero-title text-4xl font-bold tracking-tight text-white drop-shadow-lg sm:text-6xl"
          data-home-hero-title
        >
          Exawatt
        </h1>
        <p className="home-hero-copy w-full max-w-3xl text-xs leading-relaxed text-white/80 drop-shadow-md sm:text-lg">
          <span className="block">The economy is refactoring.</span>
          <span className="block">
            Exawatt is the command interface for billions of agents.
          </span>
        </p>
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
      </main>
    </div>
  );
}
