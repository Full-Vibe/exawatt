'use client';

/**
 * The hero board frame (ENG-031 W2): everything around the canvas that keeps
 * the canvas honest.
 *
 * - **First paint is DOM.** The canvas is a `next/dynamic` client chunk with
 *   `ssr: false`, so the server HTML carries text and a poster and never a
 *   WebGL context. The canvas mounts at `opacity-0` and fades in on its first
 *   rendered frame, which keeps it out of the running for LCP.
 * - **Reduced motion drops the canvas to zero** and puts the poster in its
 *   place — same composition, same silhouette, same box, no layout shift.
 *   This is Vercel's pattern and the cleanest in the reference set.
 * - **Mobile is the poster**, not a shrunken board. A 173-unit board is
 *   illegible on a phone at any size.
 * - **Offscreen and hidden tabs park.** An IntersectionObserver and
 *   `visibilitychange` clear `animating`, and every animating `useFrame` in the
 *   scene stops calling `invalidate()`, so a parked board renders no frames.
 * - **The stamp is inside the frame.** Demo data stays labelled demo data and
 *   the synthetic tier stays labelled synthetic, in the asset, so a cropped
 *   screenshot of the hero is still honest.
 * - **The board names itself.** `HeroBoardOverlay` is a DOM sibling of the
 *   canvas, not a layer inside it: Project names, the five-signal legend, the
 *   fleet counts, and every Agent hit target are real elements, so they stay
 *   crisp at any DPR and stay in the accessibility tree. The fixed chrome
 *   renders on the poster path too, so the reduced-motion and mobile
 *   substitutions read the same and shift nothing.
 */

import dynamic from 'next/dynamic';
import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { RefObject } from 'react';
import type { RootState } from '@react-three/fiber';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { HERO_BOARD_CAPTURE } from './capture';
import {
  heroBoardTheme,
  HERO_DEFAULT_THEME,
  type HeroThemeKey,
} from './hero-board-theme';
import { createHeroAnnotationBridge } from './hero-board-annotations';
import { HeroBoardOverlay } from './hero-board-overlay';

const HeroBoardScene = dynamic(
  () => import('./hero-board-scene').then(module => module.HeroBoardScene),
  { ssr: false }
);

export const HERO_BOARD_POSTER = '/images/hero-board-poster.jpg';

/** Below this width the board is a poster. The board is dense by design and a
 *  phone cannot carry it; the live board goes behind an explicit tap. */
export const HERO_BOARD_LIVE_MIN_WIDTH = 768;

export type HeroBoardMode = 'live' | 'poster';

/** Resolved on the FIRST client render, like `usePrefersReducedMotion`, so the
 *  poster and the canvas never trade places after paint. */
function useNarrowViewport(): boolean {
  const query = `(max-width: ${HERO_BOARD_LIVE_MIN_WIDTH - 1}px)`;
  return useSyncExternalStore(
    onChange => {
      if (typeof window.matchMedia !== 'function') return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    () =>
      typeof window.matchMedia === 'function'
        ? window.matchMedia(query).matches
        : false,
    () => false
  );
}

export interface HeroBoardProps {
  themeKey?: HeroThemeKey;
  className?: string;
  /** Scroll progress 0..1, driving the altitude pull. Written by the owner
   *  through a ref so nothing re-renders React at scroll frequency. */
  progressRef?: RefObject<number>;
  /** Study override: force the poster path, or force the live canvas frozen. */
  force?: 'auto' | 'live' | 'frozen' | 'poster';
  /** Study and eval only. Reading pixels back needs the drawing buffer kept. */
  preserveDrawingBuffer?: boolean;
  statusProtocolMotion?: boolean;
  statusChanges?: boolean;
  onCreated?: (state: RootState) => void;
  onModeChange?: (mode: HeroBoardMode) => void;
}

export function HeroBoard({
  themeKey = HERO_DEFAULT_THEME,
  className,
  progressRef,
  force = 'auto',
  preserveDrawingBuffer = false,
  statusProtocolMotion = true,
  statusChanges = true,
  onCreated,
  onModeChange,
}: HeroBoardProps) {
  const reducedMotion = usePrefersReducedMotion();
  const theme = useMemo(() => heroBoardTheme(themeKey), [themeKey]);
  const frame = useRef<HTMLDivElement>(null);
  const fallbackProgress = useRef(0);
  const narrow = useNarrowViewport();
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const [painted, setPainted] = useState(false);
  // Semantic selection only. Hover identity lives inside the overlay; neither
  // renders React at pointer or frame rate.
  const [selectedUnit, setSelectedUnit] = useState(-1);
  const bridge = useRef(
    createHeroAnnotationBridge(
      HERO_BOARD_CAPTURE.zones.length,
      HERO_BOARD_CAPTURE.units.length
    )
  );
  const getBridge = useCallback(() => bridge.current, []);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      entries => setVisible(entries.some(entry => entry.isIntersecting)),
      { rootMargin: '96px' }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  const posterOnly =
    force === 'poster' || (force === 'auto' && (reducedMotion || narrow));
  const mode: HeroBoardMode = posterOnly ? 'poster' : 'live';
  const animating =
    mode === 'live' && force !== 'frozen' && visible && pageVisible;

  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  const handleReady = useCallback(() => setPainted(true), []);

  return (
    <div
      ref={frame}
      className={`relative isolate h-full w-full overflow-hidden ${className ?? ''}`}
      data-hero-board
      data-hero-board-mode={mode}
      data-hero-board-animating={animating ? 'true' : 'false'}
      data-hero-board-canvas-count={mode === 'live' ? 1 : 0}
      style={{ backgroundColor: theme.canvas }}
    >
      {mode === 'poster' ? (
        <Image
          src={HERO_BOARD_POSTER}
          alt=""
          fill
          sizes="100vw"
          priority={false}
          className="object-cover"
          data-hero-board-poster
        />
      ) : (
        <div
          className="absolute inset-0 transition-opacity duration-700 ease-out"
          style={{ opacity: painted ? 1 : 0 }}
          data-hero-board-canvas-wrapper
          data-hero-board-painted={painted ? 'true' : 'false'}
        >
          <HeroBoardScene
            theme={theme}
            capture={HERO_BOARD_CAPTURE}
            animating={animating}
            statusProtocolMotion={statusProtocolMotion}
            statusChanges={statusChanges}
            progressRef={progressRef ?? fallbackProgress}
            preserveDrawingBuffer={preserveDrawingBuffer}
            getBridge={getBridge}
            onReady={handleReady}
            onCreated={onCreated}
          />
        </div>
      )}

      <HeroBoardOverlay
        capture={HERO_BOARD_CAPTURE}
        theme={theme}
        getBridge={getBridge}
        projected={mode === 'live'}
        selected={selectedUnit}
        onSelect={setSelectedUnit}
      />

      <p
        className="pointer-events-none absolute bottom-2 left-3 z-20 font-mono text-chrome-micro tracking-[0.14em] uppercase"
        style={{ color: theme.labelMuted }}
        data-hero-board-stamp
      >
        {HERO_BOARD_CAPTURE.source.stamp}
      </p>
    </div>
  );
}
