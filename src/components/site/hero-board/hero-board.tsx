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
 *   place: same composition, same silhouette, same box, no layout shift. This
 *   is Vercel's pattern and the cleanest in the reference set, and it is an
 *   accessibility contract rather than a performance one.
 * - **Mobile runs the live board** (operator, 2026-08-17). W2 shipped the
 *   poster on phones on the reasoning that a 173-unit board is illegible at
 *   390px. That is overruled by how the page is actually used: "ensure this
 *   works well on mobile so I can demonstrate it at conferences and stuff like
 *   that on my phone very clearly." A demo surface someone holds up to a
 *   stranger cannot be a still image of the thing being demonstrated. The
 *   legibility problem is answered where it belongs, in the framing: a
 *   portrait viewport CROPS instead of fitting, which is the same rule the
 *   brief already states for conveying scale honestly (density and crop carry
 *   scale, a counter does not).
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  resolveHeroHighlight,
  type HeroHighlightId,
} from './hero-board-highlight';
import { resolveHeroLens, type HeroLensId } from './hero-board-lens';
import type { HeroAltitude } from './hero-board-scene';
import { HeroBoardOverlay } from './hero-board-overlay';

const HeroBoardScene = dynamic(
  () => import('./hero-board-scene').then(module => module.HeroBoardScene),
  { ssr: false }
);

export const HERO_BOARD_POSTER = '/images/hero-board-poster.jpg';

/** The desktop breakpoint, kept as the one place the site's `md:` boundary is
 *  named in JavaScript. It no longer decides live-versus-poster; it decides
 *  LAYOUT, which is the only thing a width should decide.
 *
 *  `useNarrowViewport` retired in W6b: the phone layout is CSS now, so nothing
 *  waits for a client render to know which shape it is in. */
export const HERO_BOARD_LIVE_MIN_WIDTH = 768;

export type HeroBoardMode = 'live' | 'poster';

export interface HeroBoardProps {
  themeKey?: HeroThemeKey;
  className?: string;
  /** Scroll progress 0..1, driving the altitude pull. Written by the owner
   *  through a ref so nothing re-renders React at scroll frequency. */
  progressRef?: RefObject<number>;
  /** The ordered altitudes the camera travels. Supplied by the page's band
   *  list so the choreography is never authored a second time here. */
  ladder?: readonly HeroAltitude[];
  /**
   * What the board emphasizes, and therefore what the panel beside it is
   * talking about (ENG-031 W4). Defaults to the whole fleet, which is the
   * fold's state and the state at rest.
   */
  highlight?: HeroHighlightId;
  /**
   * What the board is COLOURED BY (ENG-031 W8). Independent of the highlight:
   * a lens says what a mark means, a highlight says which marks lead. Defaults
   * to the product's own five status signals, which is the fold's state and
   * the state at rest.
   */
  lens?: HeroLensId;
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
  ladder,
  highlight = 'whole-fleet',
  lens = 'status',
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

  // Resolved once per highlight, from the frozen capture, and written into the
  // bridge so the WebGL layer and the DOM layer recede together off one answer.
  const resolved = useMemo(
    () => resolveHeroHighlight(HERO_BOARD_CAPTURE, highlight),
    [highlight]
  );
  useEffect(() => {
    const current = bridge.current;
    current.zoneFocus.set(resolved.zones);
    current.unitFocus.set(resolved.units);
  }, [resolved]);

  // Resolved the same way and for the same reason: off the frozen capture and
  // the resolved theme, so the palette the board paints and the legend the
  // panel prints can never be two different answers.
  const resolvedLens = useMemo(
    () => resolveHeroLens(HERO_BOARD_CAPTURE, lens, theme),
    [lens, theme]
  );

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

  // Reduced motion is the ONLY automatic poster path now. A phone gets the
  // real board; see the note at the top of this file.
  const posterOnly = force === 'poster' || (force === 'auto' && reducedMotion);
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
            ladder={ladder}
            highlight={resolved}
            lens={resolvedLens}
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
        highlight={resolved}
        selected={selectedUnit}
        onSelect={setSelectedUnit}
      />

      {/* The corner stamp is retired (operator, 2026-08-17: "what purpose does
          that serve?"). Demo-ness stays declared in the capture source. */}
    </div>
  );
}
