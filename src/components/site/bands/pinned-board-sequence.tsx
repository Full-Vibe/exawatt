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
 * - **Reduced motion is unpinned by CSS**, in the SAME DOM. The sticky element
 *   goes static, the panels return to normal flow, and the board falls to its
 *   poster on its own existing rules. Doing it in CSS rather than in a JS
 *   branch is what makes the layout shift zero: there is no second tree to
 *   swap in after hydration.
 * - **A phone gets the real sequence** (operator, 2026-08-17: "ensure this
 *   works well on mobile so I can demonstrate it at conferences... on my phone
 *   very clearly"). W4 unpinned below `md` and fell to a poster, which turned
 *   the one thing worth demonstrating into a picture of itself. Mobile now
 *   pins exactly like the desktop; only the reading column moves, from beside
 *   the board to over its lower third on a scrim, because a 390px viewport has
 *   no room for two columns and the explanation still may not cover the thing
 *   it explains. The board answers legibility by cropping rather than fitting
 *   (`PORTRAIT_CROP`), which is the brief's own rule for scale.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { usePrefersReducedMotion } from '@/lib/motion/use-prefers-reduced-motion';
import {
  HeroBoard,
  useNarrowViewport,
} from '@/components/site/hero-board/hero-board';
import {
  heroBoardTheme,
  HERO_DEFAULT_THEME,
  type HeroThemeKey,
} from '@/components/site/hero-board/hero-board-theme';
import {
  resolveHeroHighlight,
  type HeroHighlightId,
} from '@/components/site/hero-board/hero-board-highlight';
import {
  resolveHeroLens,
  type HeroLensId,
} from '@/components/site/hero-board/hero-board-lens';
import { HERO_BOARD_CAPTURE } from '@/components/site/hero-board/capture';
import {
  spatialColorWithAlpha,
  type SpatialThemeSnapshot,
} from '@/components/fleet/spatial/spatial-theme';
import { cn } from '@/lib/utils';
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
 *
 * Only REDUCED MOTION unpins now. `max-md:` came off in W5 when the phone
 * became a demo surface rather than a fallback.
 */
const UNPINNED_CLASS = 'motion-reduce:relative motion-reduce:h-[68svh]';
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
  // Narrow no longer unpins; it only decides where the reading column sits.
  const narrow = useNarrowViewport();
  // The condition the CSS unpins on, in JS. When the layout is not pinned
  // there is no camera to drive and no presence to schedule, so the listener
  // does not exist rather than running and being overridden.
  const unpinned = reducedMotion;
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
  // The LENS is the second thing a panel drives (ENG-031 W8) and it is
  // deliberately independent of the highlight: one says what a mark means, the
  // other says which marks lead.
  const lensId: HeroLensId = bands[active]?.boardLens ?? 'status';

  // The camera choreography is DERIVED from the same band list that supplies
  // the panels, so a reordered or added panel moves the camera with it and
  // there is never a second copy of the sequence to keep in step.
  const ladder = useMemo(
    () => bands.map(band => band.altitudeAnchor ?? 'fleet'),
    [bands]
  );

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
    if (unpinned) return;
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync, unpinned]);

  const ground = theme.canvas;
  const sequenceStyle = {
    '--sequence-screens': total,
  } as CSSProperties;

  return (
    <section
      ref={container}
      className={`relative w-full min-h-[calc(var(--sequence-screens)*100svh)] motion-reduce:min-h-0 ${className ?? ''}`}
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
            ladder={ladder}
            highlight={highlightId}
            lens={lensId}
          />
        </div>
        {/* A short scrim across the seam only. The reading column sits on bare
            ground; this covers the sixty pixels where a long line can reach
            past it. It is part of the pinned layer, so it does not travel. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 motion-reduce:hidden"
          style={{
            background: narrow
              ? // On a phone the reading column sits over the board's lower
                // half, so the seam is horizontal and the board keeps its top
                // unobstructed. W8 pushed the opaque edge from 22% to 55%:
                // once the panels carry mechanisms as well as a claim they are
                // half a screen tall, and a heading crossing an anchored
                // Project label at full strength is the one thing a demo
                // surface may not do. The seam belongs in ONE fixed layer and
                // never on the panels themselves, because several panels are
                // positioned at once and their scrims would stack into an
                // opaque floor.
                `linear-gradient(to top, ${ground} 0%, ${ground} 28%, ${spatialColorWithAlpha(
                  ground,
                  0.55
                )} 42%, ${spatialColorWithAlpha(ground, 0)} 56%)`
              : `linear-gradient(to right, ${ground} 0%, ${ground} 27%, ${spatialColorWithAlpha(
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
        className={`relative z-10 ${PANELS_PULLUP_CLASS} motion-reduce:mt-0`}
        data-pinned-panels-layer
      >
        {bands.map((band, index) => (
          <PinnedPanel
            key={band.id}
            band={band}
            index={index}
            active={index === active}
            unpinned={unpinned}
            theme={{ label: theme.label, muted: theme.labelMuted }}
            accent={theme.status['needs-you']}
            snapshot={theme}
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
  unpinned,
  theme,
  snapshot,
  accent,
  register,
}: {
  band: HomepageBand;
  index: number;
  active: boolean;
  unpinned: boolean;
  theme: { label: string; muted: string };
  /** The whole resolved snapshot, which the lens needs for its palette. */
  snapshot: SpatialThemeSnapshot;
  accent: string;
  register: (node: HTMLElement | null) => void;
}) {
  const copy = altitudePanel(band.id);
  // Every panel names its OWN subject, not the active one's. Gating it on
  // "am I active" was wrong twice: unpinned, all three panels are on screen at
  // once and only one of them would have named anything; and pinned, the
  // subject would have popped in a frame after the panel it belongs to.
  const subject = useMemo(
    () =>
      resolveHeroHighlight(
        HERO_BOARD_CAPTURE,
        band.boardHighlight ?? 'whole-fleet'
      ).subject,
    [band.boardHighlight]
  );
  // Resolved per panel rather than per active panel, for the same reason the
  // subject is: unpinned, several panels are on screen at once, and a legend
  // that named the ACTIVE lens would label the wrong colours on all but one.
  const lens = useMemo(
    () => resolveHeroLens(HERO_BOARD_CAPTURE, band.boardLens ?? 'status', snapshot),
    [band.boardLens, snapshot]
  );
  // The whole-fleet line is identical on every panel that does not narrow the
  // board, so it is spent on the scale claim and on the panels that do.
  const showSubject =
    band.boardHighlight !== 'whole-fleet' || band.id === 'altitude-fleet';
  const style = {
    '--panel-screens': band.screens,
    // The pinned pass owns this after first paint. It starts at the first
    // panel's own presence so nothing flashes in before the listener runs.
    '--panel-opacity': unpinned || index === 0 ? 1 : 0,
  } as CSSProperties;

  return (
    <div
      ref={register}
      className="flex h-[calc(var(--panel-screens)*100svh)] w-full items-end pb-10 opacity-[var(--panel-opacity)] motion-reduce:h-auto motion-reduce:items-center motion-reduce:py-16 motion-reduce:pb-16 motion-reduce:opacity-100 md:items-center md:pb-0"
      style={style}
      data-pinned-panel={band.id}
      data-pinned-panel-active={active ? 'true' : undefined}
    >
      {/* On a phone the reading column STICKS to the viewport bottom rather
          than sitting at the bottom of its panel box. A panel is 1.0 to 1.4
          viewport heights by contract, so `items-end` alone anchors the copy
          to a box edge that is up to 338px below the fold, and at peak
          presence the last line of a panel was off screen. Sticky inside the
          panel keeps the copy over the board's lower third for the whole hold,
          with no JavaScript and no second layout. Desktop is centred and does
          not need it. */}
      <div
        className="pointer-events-none relative w-full max-w-[30rem] px-5 sm:px-10 max-md:sticky max-md:bottom-3 lg:max-w-[34rem] lg:pl-16"
        data-pinned-panel-column
      >
        {/* THE PHONE'S SEAM TRAVELS WITH THE COLUMN.
            A panel is bottom-pinned for the first half of its life and then
            rides up and out, which is ordinary scrollytelling. What is not
            ordinary is a panel heading crossing an anchored Project label
            while both are at full strength, and a FIXED seam cannot follow the
            copy that far. So the fixed seam in the pinned layer covers the
            bottom quarter, where the column always is, and this one covers the
            column itself wherever it happens to be. It carries the panel's own
            presence, so it fades exactly as its copy does; two of them overlap
            for one crossfade and land around three quarters opaque, which is
            the moment the board has least to say anyway. Desktop needs none of
            this: the board starts at 32% and the column never crosses it. */}
        <div
          aria-hidden
          className="absolute inset-x-0 -bottom-8 top-0 md:hidden"
          style={{
            background: `linear-gradient(to top, ${snapshot.canvas} 0%, ${snapshot.canvas} 88%, ${spatialColorWithAlpha(
              snapshot.canvas,
              0
            )} 100%)`,
          }}
          data-pinned-panel-scrim
        />
        <BandHeading
          band={band}
          className="tracking-tight"
          style={{ color: theme.muted }}
          data-pinned-panel-heading
        />
        {/* A panel that carries mechanisms leads with a SMALLER claim. One
            idea per screen is a height constraint as much as a copy one, and
            at the full claim size a three-card panel ran past the fold edge on
            a 900px laptop and cut its own last line off. */}
        <p
          className={cn(
            'mt-2.5 font-medium text-pretty',
            copy?.cards?.length
              ? 'text-[15px] leading-snug sm:text-lg sm:leading-snug lg:text-xl lg:leading-snug'
              : 'text-lg leading-snug sm:text-xl sm:leading-snug lg:text-2xl lg:leading-snug'
          )}
          style={{ color: theme.label }}
          data-pinned-panel-copy
        >
          {copy?.copy.map(line => (
            <span className="block" key={line}>
              {line}
            </span>
          ))}
        </p>
        {/* The board's own numbers, read off the capture, never typed. On a
            panel whose emphasis is the whole fleet this would be the same
            line four times over, so it is spent where it says something new:
            the scale claim and every panel that narrows the board. */}
        {showSubject ? (
          <p
            className="mt-4 flex flex-wrap items-baseline gap-x-2 gap-y-1"
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
        {/* THE LENS LEGEND. Printed only when the lens is actually re-reading
            the board: a legend for colours the board is not using is worse
            than no legend, which is why `active` is a property of the resolved
            lens rather than of the band. The status lens prints nothing here,
            because the board's own five-signal legend is already in frame. */}
        {lens.active && lens.legend.length ? (
          <div className="mt-4 flex flex-col gap-1.5" data-pinned-panel-legend>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {lens.legendKind === 'ramp' ? (
                <span className="flex items-center gap-2">
                  <span
                    className="text-chrome-label"
                    style={{ color: theme.muted }}
                  >
                    {lens.legend[0]?.label}
                  </span>
                  <span
                    aria-hidden
                    className="h-1.5 w-24 rounded-full"
                    style={{
                      background: `linear-gradient(to right, ${lens.colors
                        .slice(0, 5)
                        .join(', ')})`,
                    }}
                  />
                  <span
                    className="text-chrome-label"
                    style={{ color: theme.muted }}
                  >
                    {lens.legend[1]?.label}
                  </span>
                </span>
              ) : (
                lens.legend.map(channel => (
                  <span
                    className="flex items-center gap-1.5"
                    key={channel.label}
                  >
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full"
                      style={{ background: channel.color }}
                    />
                    <span
                      className="text-chrome-label"
                      style={{ color: theme.label }}
                    >
                      {channel.label}
                    </span>
                  </span>
                ))
              )}
            </div>
            {lens.caption ? (
              <p
                className="text-chrome-label"
                style={{ color: theme.muted }}
                data-pinned-panel-lens-caption
              >
                {lens.caption}
              </p>
            ) : null}
          </div>
        ) : null}
        {/* The mechanisms that make the claim checkable, on the panel rather
            than on a chapter one screen further down (W8). Three is the
            working ceiling: a fourth card starts covering the evidence it is
            about, and on a phone the column already sits over the board's
            lower third. Type steps down hard from the claim so the panel
            still reads as one idea. */}
        {copy?.cards?.length ? (
          <ul
            className="mt-3.5 flex flex-col gap-2 sm:mt-4 sm:gap-2.5"
            data-pinned-panel-cards
          >
            {copy.cards.map(card => (
              <li className="flex flex-col gap-0.5" key={card.title}>
                <span
                  className="text-[13px] font-semibold sm:text-sm lg:text-base"
                  style={{ color: theme.label }}
                >
                  {card.title}
                </span>
                <span
                  className="text-[12px] leading-snug sm:text-[13px] sm:leading-snug lg:text-sm lg:leading-snug"
                  style={{ color: theme.muted }}
                >
                  {card.body}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {copy?.coda ? (
          <p
            className="mt-3 text-[11px] leading-snug sm:mt-4 sm:text-xs lg:text-sm"
            style={{ color: theme.muted }}
            data-pinned-panel-coda
          >
            {copy.coda}
          </p>
        ) : null}
      </div>
    </div>
  );
}
