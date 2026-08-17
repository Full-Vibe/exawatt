'use client';

/**
 * The pinned board and the panels that drive it (ENG-031 W4).
 *
 * The operator's direction, verbatim: "keep this as a persistent graphic which
 * changes as you scroll and then explanations and potentially even illustration
 * graphics just scroll in and out as you go up and down to tell you what's
 * going on as you scroll... They kind of highlight elements or map to elements
 * that are highlighted in the graphic or in the model."
 *
 * So: ONE board, pinned. Several explanations, scrolling past it. Each one
 * drives the board to an altitude AND emphasizes the specific Projects or
 * Agents it is describing, while the rest recede. This SUBSUMES the brief's
 * three separate altitude bands, which would have been three captures of the
 * same fleet.
 *
 * WHAT THE BANDS OWN AND WHAT THIS OWNS. The bands supply the panels, their
 * order, their headings, their word budgets, the altitude each one holds, and
 * the emphasis each one asks for. This file owns none of that: it is the
 * medium. Adding a fourth panel is a row in `manifest.ts` and a copy entry in
 * `altitude-copy.ts`.
 *
 * MECHANICS, and the constraints each one answers:
 *
 * - **Native scroll only.** No wheel handler, no `preventDefault`, no
 *   `scrollTo`, no snap, no scroll library. `position: sticky` does the
 *   pinning and the board reads a fraction of a FIXED range. The 16-site
 *   study found zero scroll-jacking across the entire premium cohort, and the
 *   hero's camera bindings are all `ACTION.NONE` besides.
 * - **It reads the same going up.** Everything visual is a pure function of
 *   scroll POSITION: altitude, panel presence, and which panel is active. No
 *   one-shot reveal, no direction test, no IntersectionObserver latch.
 * - **Nothing renders React at scroll frequency** (guide rule 14). One
 *   rAF-coalesced listener writes `progressRef` and mutates panel opacity on
 *   nodes it already owns. React state carries ONE thing, the active panel
 *   index, which changes twice over the whole sequence and is what the
 *   highlight is keyed on.
 * - **Reduced motion and small screens are the same DOM, unpinned by CSS.**
 *   The sticky element goes static, the panels return to normal flow, and the
 *   board falls to its poster on its own existing rules. Doing it in CSS
 *   rather than in a JS branch is what makes the layout shift zero: there is
 *   no second tree to swap in after hydration.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import { HeroBoard } from '@/components/site/hero-board/hero-board';
import {
  heroBoardTheme,
  HERO_DEFAULT_THEME,
  type HeroThemeKey,
} from '@/components/site/hero-board/hero-board-theme';
import {
  resolveHeroHighlight,
  type HeroHighlightId,
} from '@/components/site/hero-board/hero-board-highlight';
import { HERO_BOARD_CAPTURE } from '@/components/site/hero-board/capture';
import { spatialColorWithAlpha } from '@/components/fleet/spatial/spatial-theme';
import { altitudePanel } from './altitude-copy';
import { BandHeading } from './band-section';
import type { HomepageBand } from './manifest';
import {
  activePanel,
  boardProgressAt,
  panelAnchors,
  panelPresence,
} from './pinned-scroll';

/**
 * The sticky site header the board sits under, as literal class strings.
 *
 * They are spelled out rather than interpolated on purpose: Tailwind scans
 * source TEXT for class names, so a template literal produces a class that is
 * never generated. The three have to move together.
 */
const STICKY_CLASS = 'sticky top-12 h-[calc(100svh-3rem)]';
/**
 * Unpinned it stays `relative`, never `static`. The board frame inside it is
 * absolutely positioned, so a static parent hands that frame to the section
 * instead and the poster silently covers the whole sequence, panels included.
 */
const UNPINNED_CLASS =
  'motion-reduce:relative motion-reduce:h-[68svh] max-md:relative max-md:h-[64svh]';
const PANELS_PULLUP_CLASS = '-mt-[calc(100svh-3rem)]';

export interface PinnedBoardSequenceProps {
  /** The run of `pinned-board` bands, in page order. */
  bands: HomepageBand[];
  themeKey?: HeroThemeKey;
  /** Study only. The homepage register is fixed. */
  className?: string;
}

export function PinnedBoardSequence({
  bands,
  themeKey = HERO_DEFAULT_THEME,
  className,
}: PinnedBoardSequenceProps) {
  const reducedMotion = usePrefersReducedMotion();
  const theme = useMemo(() => heroBoardTheme(themeKey), [themeKey]);

  const container = useRef<HTMLElement>(null);
  const sticky = useRef<HTMLDivElement>(null);
  const panelNodes = useRef(new Map<number, HTMLElement>());
  const progress = useRef(0);
  const ticking = useRef(false);

  const [active, setActive] = useState(0);

  const screens = useMemo(() => bands.map(band => band.screens), [bands]);
  const total = useMemo(
    () => screens.reduce((sum, value) => sum + value, 0),
    [screens]
  );

  const highlightId: HeroHighlightId =
    bands[active]?.boardHighlight ?? 'whole-fleet';

  /**
   * One rAF-coalesced pass. Reads scroll position, writes the board's progress
   * ref and every panel's opacity, and only touches React when the ACTIVE
   * panel changes.
   */
  const sync = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      const element = container.current;
      const pinned = sticky.current;
      if (!element || !pinned) return;

      const height = element.offsetHeight;
      if (height <= 0 || total <= 0) return;
      // The sticky child is not one full viewport: it sits under the site
      // header. Measure the real ratio instead of assuming it, so a panel is
      // centred exactly when the board reaches its altitude.
      const stickyScreens = (pinned.offsetHeight * total) / height;
      const travel = Math.max(1, height - pinned.offsetHeight);
      const top = element.getBoundingClientRect().top + window.scrollY;
      const scrolled = Math.min(
        1,
        Math.max(0, (window.scrollY - top) / travel)
      );

      const anchors = panelAnchors(screens, stickyScreens);
      progress.current = boardProgressAt(scrolled, anchors);

      for (const [index, node] of panelNodes.current) {
        // Written as a CUSTOM PROPERTY, never as `style.opacity`. An inline
        // opacity would outrank `motion-reduce:opacity-100` and
        // `max-md:opacity-100`, which is how the unpinned layouts get every
        // panel at full strength: the media query has to be able to win.
        node.style.setProperty(
          '--panel-opacity',
          String(
            panelPresence(scrolled, screens, anchors, index, stickyScreens)
          )
        );
      }

      const next = activePanel(scrolled, anchors);
      setActive(current => (current === next ? current : next));
    });
  }, [screens, total]);

  useEffect(() => {
    // The poster path has no camera to drive and no panel motion to schedule.
    if (reducedMotion) return;
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync, reducedMotion]);

  const subject = useMemo(
    () => resolveHeroHighlight(HERO_BOARD_CAPTURE, highlightId).subject,
    [highlightId]
  );

  const ground = theme.canvas;
  const sequenceStyle = {
    '--sequence-screens': total,
  } as CSSProperties;

  return (
    <section
      ref={container}
      className={`relative w-full min-h-[calc(var(--sequence-screens)*100svh)] motion-reduce:min-h-0 max-md:min-h-0 ${className ?? ''}`}
      style={{ ...sequenceStyle, backgroundColor: ground }}
      data-pinned-board-sequence
      data-pinned-panels={bands.length}
      data-pinned-active={bands[active]?.id}
    >
      {/* The board. One element for the whole sequence. */}
      <div
        ref={sticky}
        className={`${STICKY_CLASS} ${UNPINNED_CLASS} w-full overflow-hidden`}
        data-pinned-board
      >
        {/* The board takes the right of the frame on desktop and the reading
            column takes the left, so the explanation never covers the thing it
            is explaining. The seam is invisible because the section's ground
            IS the board's ground; the canvas simply starts further in, and the
            camera refits its own sphere to the narrower aspect. Below md the
            board is a poster in normal flow and takes the whole width. */}
        <div
          className="absolute inset-0 md:motion-safe:left-[32%]"
          data-pinned-board-frame
        >
          <HeroBoard
            themeKey={themeKey}
            progressRef={progress}
            highlight={highlightId}
          />
        </div>
        {/* A short scrim across the seam only. The reading column sits on bare
            ground; this covers the sixty pixels where a long line can reach
            past it. It is part of the pinned layer, so it does not travel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 motion-reduce:hidden max-md:hidden"
          style={{
            background: `linear-gradient(to right, ${ground} 0%, ${ground} 27%, ${spatialColorWithAlpha(
              ground,
              0.55
            )} 35%, ${spatialColorWithAlpha(ground, 0)} 44%)`,
          }}
          data-pinned-scrim
        />
      </div>

      {/* The explanations. Real DOM in reading order, scrolling over the board
          on desktop and sitting under it when the sequence is not pinned. */}
      <div
        className={`relative z-10 ${PANELS_PULLUP_CLASS} motion-reduce:mt-0 max-md:mt-0`}
        data-pinned-panels-layer
      >
        {bands.map((band, index) => (
          <PinnedPanel
            key={band.id}
            band={band}
            index={index}
            active={index === active}
            reducedMotion={reducedMotion}
            theme={{ label: theme.label, muted: theme.labelMuted }}
            accent={theme.status['needs-you']}
            subject={index === active ? subject : null}
            register={(node: HTMLElement | null) => {
              if (node) panelNodes.current.set(index, node);
              else panelNodes.current.delete(index);
            }}
          />
        ))}
      </div>
    </section>
  );
}

function PinnedPanel({
  band,
  index,
  active,
  reducedMotion,
  theme,
  accent,
  subject,
  register,
}: {
  band: HomepageBand;
  index: number;
  active: boolean;
  reducedMotion: boolean;
  theme: { label: string; muted: string };
  accent: string;
  subject: { label: string; detail: string } | null;
  register: (node: HTMLElement | null) => void;
}) {
  const copy = altitudePanel(band.id);
  const style = {
    '--panel-screens': band.screens,
    // The pinned pass owns this after first paint. It starts at the first
    // panel's own presence so nothing flashes in before the listener runs.
    '--panel-opacity': reducedMotion || index === 0 ? 1 : 0,
  } as CSSProperties;

  return (
    <div
      ref={register}
      className="flex h-[calc(var(--panel-screens)*100svh)] w-full items-center opacity-[var(--panel-opacity)] motion-reduce:h-auto motion-reduce:py-16 motion-reduce:opacity-100 max-md:h-auto max-md:py-14 max-md:opacity-100"
      style={style}
      data-pinned-panel={band.id}
      data-pinned-panel-active={active ? 'true' : undefined}
    >
      <div className="pointer-events-none w-full max-w-[28rem] px-6 sm:px-10 lg:pl-16">
        <BandHeading
          band={band}
          className="tracking-tight"
          style={{ color: theme.muted }}
          data-pinned-panel-heading
        />
        <p
          className="mt-3 text-xl leading-snug font-medium text-balance sm:text-2xl sm:leading-snug"
          style={{ color: theme.label }}
          data-pinned-panel-copy
        >
          {copy?.copy.map(line => (
            <span className="block" key={line}>
              {line}
            </span>
          ))}
        </p>
        {subject ? (
          <p
            className="mt-5 flex flex-wrap items-baseline gap-x-2 gap-y-1"
            data-pinned-panel-subject
          >
            <span
              className="text-base font-semibold"
              style={{ color: accent }}
              data-pinned-panel-subject-label
            >
              {subject.label}
            </span>
            <span
              className="text-chrome-label"
              style={{ color: theme.muted }}
              data-pinned-panel-subject-detail
            >
              {subject.detail}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
