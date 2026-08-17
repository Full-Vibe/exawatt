'use client';

/**
 * Altitude scroll study (ENG-031 W4).
 *
 * The pinned board and its explanations, exactly as they will ship: the real
 * band declarations, the real `PinnedBoardSequence`, the real hero board, the
 * real capture. Not a mock of the sequence, the sequence.
 *
 * The study's own chrome is one row of controls, because the last two board
 * studies earned the note "I don't want to read all the text on that page".
 * Scroll the page. Then scroll back up.
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PinnedBoardSequence } from '@/components/site/bands/pinned-board-sequence';
import { pinnedBoardBands } from '@/components/site/bands/manifest';
import {
  HERO_THEMES,
  type HeroThemeKey,
} from '@/components/site/hero-board/hero-board-theme';
import { cn } from '@/lib/utils';

export function AltitudeScrollStudy() {
  const searchParams = useSearchParams();
  const theme = useMemo<HeroThemeKey>(() => {
    const value = searchParams.get('theme');
    return value && value in HERO_THEMES ? (value as HeroThemeKey) : 'classic';
  }, [searchParams]);

  const bands = useMemo(() => pinnedBoardBands(), []);

  return (
    <main
      className="bg-background font-ui text-foreground"
      data-altitude-scroll-study
      data-public-exhibition-surface="true"
    >
      <div className="border-border sticky top-12 z-30 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b bg-background/90 px-4 py-2 backdrop-blur">
        <p className="font-mono text-chrome-micro text-muted-foreground">
          <Link href="/hud-gallery" className="hover:text-foreground">
            HUD Gallery
          </Link>{' '}
          / <span className="text-foreground">Altitude scroll</span>
        </p>
        <div className="flex flex-wrap gap-1">
          {(Object.keys(HERO_THEMES) as HeroThemeKey[]).map(value => (
            <Link
              key={value}
              href={`/hud-gallery/altitude-scroll?theme=${value}`}
              scroll={false}
              data-study-option={value}
              aria-current={value === theme ? 'true' : undefined}
              className={cn(
                'rounded border px-2 py-1 text-chrome-micro transition-colors',
                value === theme
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border hover:bg-secondary'
              )}
            >
              {value}
            </Link>
          ))}
        </div>
      </div>

      {/* A screen of ordinary page above the sequence, so the operator sees the
          board arrive and pin the way it will on the homepage, rather than
          starting already pinned. */}
      <div className="flex h-[60svh] items-end px-6 pb-10 sm:px-10 lg:pl-16">
        <p className="max-w-xl text-2xl leading-snug font-medium text-balance sm:text-3xl">
          Scroll.
        </p>
      </div>

      <PinnedBoardSequence bands={bands} themeKey={theme} />

      {/* And a screen after it, so leaving the sequence is visible too. */}
      <div className="h-[60svh]" />
    </main>
  );
}
