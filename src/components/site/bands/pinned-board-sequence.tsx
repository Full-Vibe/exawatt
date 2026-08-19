'use client';

/**
 * The pinned board and the panels that drive it (ENG-031 W4, rebuilt W6b).
 *
 * The operator's direction, verbatim: "keep this as a persistent graphic which
 * changes as you scroll and then explanations and potentially even illustration
 * graphics just scroll in and out as you go up and down to tell you what's
 * going on as you scroll... They kind of highlight elements or map to elements
 * that are highlighted in the graphic or in the model."
 *
 * So: ONE board, pinned. Several explanations, scrolling past it. Each one
 * drives the board to an altitude, chooses what it is COLOURED BY, and
 * emphasizes the specific Projects or Agents it is describing.
 *
 * THE FOLD IS PANEL ZERO (W6b). Until this pass the page mounted two boards:
 * one full-width behind the fold and a second at the top of the run. On
 * production that was a visible seam at the fold edge, two fleet-count chips
 * and two legends, and it made the page's own "one continuous board" claim
 * false. `bandRuns()` now merges the fold into the run and this component
 * renders its interior in the same column the panels use, so the reader's
 * first frame and the argument's last frame are the same canvas.
 *
 * WHAT THE BANDS OWN AND WHAT THIS OWNS. The bands supply the panels, their
 * order, their headings, their word budgets, the altitude each one holds, the
 * lens each one wears, and the emphasis each one asks for. This file owns none
 * of that: it is the medium.
 *
 * MECHANICS, and the constraints each one answers:
 *
 * - **Native scroll only.** No wheel handler, no `preventDefault`, no
 *   `scrollTo`, no scroll library. `position: sticky` does the pinning and the
 *   board reads a fraction of a FIXED range.
 * - **The page SETTLES on its steps, and the browser does it** (ENG-031 W9,
 *   operator: "could you have it snap slightly more so scroll settles in the
 *   steps, instead of being able to get stuck in between"). Native CSS scroll
 *   snap, `y proximity`, declared on the document scroller in `globals.css`
 *   and targeted by one zero-height sentinel per panel. PROXIMITY, not
 *   mandatory: it nudges a finger that has almost arrived and leaves a
 *   deliberate stop alone, which is what "snap slightly more" asks for.
 *   Doing it in CSS is what keeps the no-scroll-jacking rule intact: the
 *   browser owns the scroll from first paint, this file never calls
 *   `scrollTo`, and a reader who wants to sit between two panels still can.
 * - **It reads the same going up.** Everything visual is a pure function of
 *   scroll POSITION. No one-shot reveal, no direction test, no latch.
 * - **Nothing renders React at scroll frequency** (guide rule 14). One
 *   rAF-coalesced listener writes `progressRef` and mutates panel opacity on
 *   nodes it already owns. React state carries ONE thing, the active panel.
 * - **THE READING COLUMN NEVER CROSSES THE SITE HEADER** (W6b). It used to
 *   travel the full height of its own panel box, so at some scroll offset on
 *   every long panel a sentence was guillotined by the sticky header, and at
 *   others it crossed the board's own fleet chip. The column now lives in a
 *   nested sticky box exactly the height of the space UNDER the header and is
 *   centred inside it, so the copy holds in the one safe band for the whole
 *   panel and the crossfade is what carries it in and out. The travel that was
 *   lost was never the point: the operator asked for explanations that come
 *   and go, not for a sentence that slides under the chrome.
 * - **A phone is not a squeezed desktop** (W6b, operator: "ensure this works
 *   well on mobile so I can demonstrate it at conferences... very clearly").
 *   Below `md` the board is a FIXED-HEIGHT CARD stuck to the top of the
 *   viewport at full strength, and every explanation sits BELOW it in normal
 *   document flow at full opacity. No copy over the board, no partial fades,
 *   no dead space under a panel that was sized in viewport heights. The board
 *   still travels: the active panel is whichever one is in the reading area,
 *   so the demo is the same demo with a layout a phone can hold.
 * - **Reduced motion takes the same unpinned shape**, by CSS, in the SAME DOM,
 *   plus the board's own poster path. Doing it in CSS rather than in a JS
 *   branch is what keeps the layout shift at zero.
 * - **THE PAGE OPENS ON THE GESTURE IMAGE AND DISSOLVES INTO THE BOARD** (W11,
 *   operator: "Put the / tom cruise visual above the fold, so scrolling fades
 *   him out and the fleet board in"). The image is a layer inside the SAME
 *   sticky box the board lives in, so the dissolve happens in place: the human
 *   commanding by gesture becomes the fleet he was commanding, in one frame,
 *   without a second section and without anything scrolling away. The mapping
 *   is `fold-crossfade.ts`; three consequences live here. The board renders
 *   NOTHING while it is fully occluded (`occluded` parks the demand loop after
 *   one settled frame, so the page-top rest costs zero frames). The image layer
 *   is also the POINTER gate, because a hit target under a picture is a ghost
 *   surface — an ancestor's `pointer-events: none` does not stop a descendant
 *   that sets `auto`, so the thing that occludes the board visually is the
 *   thing that occludes it for a pointer. And the dissolve finishes with three
 *   hundred pixels to spare before the sequence's first snap point, so no
 *   settle can park a reader on a half-dissolved hero.
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
import { HarnessMark, harnessMarkExists } from '@/components/site/harness-mark';
import { altitudePanel } from './altitude-copy';
import { BandHeading } from './band-section';
import { FoldGestureImage } from './fold-gesture-image';
import { FoldHero } from './fold-hero';
import type { HomepageBand } from './manifest';
import {
  foldBoardInteractive,
  foldBoardOpacity,
  foldCrossfadeProgress,
  foldImageOpacity,
} from './fold-crossfade';
import {
  activePanel,
  boardProgressAt,
  panelAnchors,
  panelPresence,
} from './pinned-scroll';

/**
 * The sticky geometry, as literal class strings.
 *
 * Spelled out rather than interpolated on purpose: Tailwind scans source TEXT
 * for class names, so a template literal produces a class that is never
 * generated. They have to move together.
 *
 * Below `md` the board is a card of fixed height at the top of the viewport;
 * at `md` and up it is the full height under the site header. Reduced motion
 * takes the phone's shape at every width.
 */
const STICKY_CLASS =
  'sticky top-12 h-[calc(44svh+2rem)] md:h-[calc(100svh-3rem)] motion-reduce:md:h-[calc(44svh+2rem)]';
const PANELS_PULLUP_CLASS = 'md:-mt-[calc(100svh-3rem)] motion-reduce:md:mt-0';
/**
 * WHERE A READING COLUMN IS ALLOWED TO BE, on a pinned desktop layout.
 *
 * A ZERO-HEIGHT STICKY LINE at the centre of the space under the site header,
 * with the column centred on it. The height is zero on purpose and it is what
 * makes the no-clipping guarantee unconditional rather than tuned.
 *
 * The panel used to travel the full height of its own box, so on every long
 * panel there were scroll offsets where a sentence was cut in half by the
 * sticky header while the panel was still most of the way visible. A sticky
 * box of the FULL safe height does not fix it: `sticky` is released by its own
 * container's bottom edge, so a tall sticky box starts being pushed up early
 * and its content still crosses the header while the panel is at half
 * presence. Working the algebra through for a column of height C in a sticky
 * box of height S inside a panel of height P, over a board of height B, the
 * column reaches the header while it is still visible unless `S + C < B - 96`.
 * P cancels, so no choice of panel height rescues a tall S. At S = 0 the
 * condition is C < B - 96, which every panel on this page satisfies by a
 * factor of two, and it holds at every viewport and every panel length.
 *
 * What it costs is the copy's vertical travel, which was never the ask: the
 * operator asked for explanations that come and go, and the crossfade is what
 * carries them.
 */
const SAFE_BAND_CLASS =
  'md:sticky md:top-[calc(50svh+1.5rem)] md:h-0 motion-reduce:md:static motion-reduce:md:h-auto';
/** How much of the frame the board takes on a desktop split. */
const BOARD_FRAME_CLASS = 'md:left-[40%] motion-reduce:md:left-0';

/**
 * WHERE A PANEL'S SNAP POINT IS, derived rather than tuned (ENG-031 W9).
 *
 * `pinned-scroll.ts` puts panel k's keyframe at the scroll position where the
 * panel's CENTRE crosses the centre of the pinned box, which is not the same
 * place as the panel box's own top edge: the box is `screens` viewport heights
 * tall and the pinned box is one viewport minus the site header. Working the
 * difference through, the keyframe sits `(screens * 100svh - stickyHeight) / 2`
 * below the panel's top, and that is exactly this expression.
 *
 * Snapping the panel BOX instead would have been up to 114px off the altitude
 * at 1.2 screens, which is a settle that lands the camera between two steps:
 * the defect, not the fix. A zero-height sentinel at the computed offset means
 * the browser's rest position and the camera's keyframe are the same number,
 * with no measurement, no JavaScript, and nothing to keep in step.
 */
const SNAP_SENTINEL_TOP =
  'calc((var(--panel-screens) * 100svh - (100svh - 3rem)) / 2)';

export interface PinnedBoardSequenceProps {
  /** The run of pinned bands, in page order. The fold leads it when the page
   *  is the whole arc; a study may pass panels alone. */
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
  /** Last written pointer phase, so the attribute is touched on a change and
   *  not once a frame. */
  const crossfadePhase = useRef<'running' | 'complete'>('running');

  const [active, setActive] = useState(0);
  /**
   * Has the dissolve started (W11)?
   *
   * The ONE piece of React state the crossfade owns, and it flips at the very
   * first pixel of scroll, before the camera has begun to move — never
   * mid-flight (guide rule 4e). It exists because `animating` is a prop the
   * scene threads into every `useFrame`, and a board nobody can see must not
   * ask for frames: false here parks the demand loop after its first settled
   * frame at the fold's own framing. It is a pure function of position like
   * everything else, so scrolling back to the top parks it again.
   */
  const [revealed, setRevealed] = useState(false);

  const screens = useMemo(() => bands.map(band => band.screens), [bands]);
  const total = useMemo(
    () => screens.reduce((sum, value) => sum + value, 0),
    [screens]
  );

  /**
   * Does this run OPEN the page (W11)?
   *
   * `headingRole` is the discriminator rather than the id, for the same reason
   * `PinnedPanel` uses it: "the band that carries the page headline" is
   * exactly the thing that is true about the fold, and the manifest allows
   * only one. A study that passes panels alone gets no gesture image, no
   * dissolve, and a board that is live from its first frame.
   */
  const hasFold = bands[0]?.headingRole === 'headline';

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
   *
   * TWO GEOMETRIES, ONE PASS. Pinned, the panel boxes are sized in viewport
   * heights and `pinned-scroll.ts` owns the maths. Unpinned, the panel boxes
   * are whatever their copy needs, so the same questions are answered off the
   * real boxes instead: the active panel is the one occupying the reading area
   * under the board card, and the board's progress is that panel's index plus
   * how far through it the reader is. Measuring rather than modelling is what
   * lets the phone layout be a real document instead of a scaled desktop.
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

      // THE DISSOLVE, before either geometry branch (W11). It is the same
      // question at both widths — how far into the sequence is the reader, as
      // a share of the pinned box — so it is answered once, and the phone's
      // shorter board card gets a proportionally shorter dissolve for free.
      const sequenceTop = element.getBoundingClientRect().top + window.scrollY;
      if (hasFold) {
        const crossfade = foldCrossfadeProgress(
          window.scrollY - sequenceTop,
          pinned.offsetHeight
        );
        pinned.style.setProperty(
          '--fold-image-opacity',
          String(foldImageOpacity(crossfade))
        );
        pinned.style.setProperty(
          '--fold-board-opacity',
          String(foldBoardOpacity(crossfade))
        );
        const phase = foldBoardInteractive(crossfade) ? 'complete' : 'running';
        if (crossfadePhase.current !== phase) {
          crossfadePhase.current = phase;
          pinned.dataset.foldCrossfade = phase;
        }
        const started = crossfade > 0;
        setRevealed(current => (current === started ? current : started));
      }

      const stacked = !window.matchMedia('(min-width: 768px)').matches;
      if (stacked) {
        // The reading area is everything under the board card.
        const board = pinned.getBoundingClientRect();
        const centre = (Math.max(board.bottom, 0) + window.innerHeight) / 2;
        let index = 0;
        let local = 0;
        let best = Infinity;
        for (const [at, node] of panelNodes.current) {
          const rect = node.getBoundingClientRect();
          const distance =
            centre < rect.top
              ? rect.top - centre
              : centre > rect.bottom
                ? centre - rect.bottom
                : 0;
          if (distance < best) {
            best = distance;
            index = at;
            local =
              rect.height > 0
                ? Math.min(1, Math.max(0, (centre - rect.top) / rect.height))
                : 0;
          }
          // Unpinned panels are never faded: the copy is in normal flow and a
          // half-transparent paragraph is a defect rather than a transition.
          node.style.setProperty('--panel-opacity', '1');
        }
        const spans = Math.max(1, panelNodes.current.size - 1);
        progress.current = Math.min(1, Math.max(0, (index + local) / spans));
        setActive(current => (current === index ? current : index));
        return;
      }

      // The sticky child is not one full viewport: it sits under the site
      // header. Measure the real ratio instead of assuming it, so a panel is
      // centred exactly when the board reaches its altitude.
      const stickyScreens = (pinned.offsetHeight * total) / height;
      const travel = Math.max(1, height - pinned.offsetHeight);
      const top = element.getBoundingClientRect().top + window.scrollY;
      // RAW for presence, CLAMPED for the camera. A column leaving the top of
      // the sequence is still moving after the board has parked at its last
      // altitude, and a presence that stopped growing at 1 is what left the
      // final panel at full strength on its way under the header.
      const raw = (window.scrollY - top) / travel;
      const scrolled = Math.min(1, Math.max(0, raw));

      const anchors = panelAnchors(screens, stickyScreens);
      progress.current = boardProgressAt(scrolled, anchors);

      for (const [index, node] of panelNodes.current) {
        // Written as a CUSTOM PROPERTY, never as `style.opacity`. An inline
        // opacity would outrank `motion-reduce:opacity-100`, which is how the
        // unpinned layout gets every panel at full strength: the media query
        // has to be able to win.
        node.style.setProperty(
          '--panel-opacity',
          String(panelPresence(raw, screens, anchors, index, stickyScreens))
        );
      }

      const next = activePanel(scrolled, anchors);
      setActive(current => (current === next ? current : next));
    });
  }, [screens, total]);

  useEffect(() => {
    // Reduced motion pins nothing and drives nothing: the board is a poster in
    // a card and every explanation is already on screen.
    if (reducedMotion) return;
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    sync();
    return () => {
      window.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [sync, reducedMotion]);

  const ground = theme.canvas;
  const sequenceStyle = {
    '--sequence-screens': total,
  } as CSSProperties;

  return (
    <section
      ref={container}
      className={cn(
        'relative w-full md:min-h-[calc(var(--sequence-screens)*100svh)] motion-reduce:md:min-h-0',
        className
      )}
      style={{ ...sequenceStyle, backgroundColor: ground }}
      data-pinned-board-sequence
      data-pinned-snap="proximity"
      data-pinned-panels={bands.length}
      data-pinned-active={bands[active]?.id}
      data-public-exhibition-surface="true"
    >
      {/* The board. One element for the whole page. */}
      <div
        ref={sticky}
        // STACKED, THE BOARD IS ON TOP and the copy scrolls beneath it, which
        // is what keeps a phone's reading area a fixed rectangle under a card
        // that never moves. Pinned, the order reverses: the column is over the
        // board's left third, where the board deliberately has nothing.
        className={`${STICKY_CLASS} z-20 w-full overflow-hidden md:z-0 motion-reduce:md:z-20`}
        data-pinned-board
      >
        {/* Desktop: the board takes the right of the frame and the reading
            column takes the left, so nothing is ever printed over the object
            and the object never has to be dimmed to carry type. The seam is
            invisible because the section's ground IS the board's ground; the
            canvas simply starts further in and the camera refits its own
            sphere to the narrower aspect. Stacked, it is the whole card. */}
        <div
          className={`absolute inset-x-0 top-0 bottom-8 md:bottom-0 ${BOARD_FRAME_CLASS} motion-reduce:md:bottom-8`}
          // The board is the layer UNDERNEATH the dissolve, so it arrives
          // first and is at full strength before the image finishes leaving.
          // The var defaults to 1, so a run without a fold (a study passing
          // panels alone) is unaffected.
          style={
            hasFold
              ? { opacity: 'var(--fold-board-opacity, 1)' }
              : undefined
          }
          data-pinned-board-frame
        >
          <HeroBoard
            themeKey={themeKey}
            progressRef={progress}
            ladder={ladder}
            highlight={highlightId}
            lens={lensId}
            // A board nobody can see must not ask for frames. `frozen` parks
            // the demand loop after one settled frame at the fold's own
            // framing, so the page-top rest costs nothing; the first pixel of
            // scroll flips it before the camera has begun to move.
            force={hasFold && !revealed ? 'frozen' : 'auto'}
          />
        </div>
        {/* THE OPENING FRAME (W11). Same sticky box as the board, one layer
            above it, so the dissolve happens in place rather than as a section
            that scrolls away. It is also the pointer gate: an ancestor's
            `pointer-events: none` does not stop a descendant that sets `auto`,
            so the thing that occludes the board visually is the thing that
            occludes it for a pointer, keyed off the phase the scroll pass
            writes. Reduced motion gets no dissolve and no image: the board
            carries the fold as it already does, with zero layout shift. */}
        {hasFold ? (
          <FoldGestureImage
            priority
            className="z-10 motion-reduce:hidden"
            data-fold-gesture-layer=""
          />
        ) : null}
        {/* Stacked, the copy scrolls UNDER the board card, and a hard card
            edge slices a sentence in half rather than letting it leave. Two
            rem of ground fading to nothing is the whole repair: a line
            dissolves at the card's edge instead of being cut by it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-8 md:hidden motion-reduce:md:block"
          style={{
            background: `linear-gradient(to bottom, ${ground} 0%, ${ground} 45%, ${spatialColorWithAlpha(
              ground,
              0
            )} 100%)`,
          }}
          data-pinned-card-fade
        />
        {/* A soft edge on the board's left so a mark landing exactly on the
            column boundary fades rather than being sliced. It is 40px wide and
            it is the only scrim left on the page: the layout, not a curtain,
            is what keeps the type legible now. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-[40%] hidden w-10 md:block motion-reduce:md:hidden"
          style={{
            background: `linear-gradient(to right, ${ground} 0%, ${spatialColorWithAlpha(
              ground,
              0
            )} 100%)`,
          }}
          data-pinned-scrim
        />
      </div>

      {/* The explanations. Real DOM in reading order: over the left of the
          board when the sequence is pinned, and under the board card when it
          is not. */}
      {/* THE WHOLE PANEL LAYER IS TRANSPARENT TO THE POINTER (ENG-031 W9).
          The reading COLUMN has been `pointer-events-none` since W4, but the
          panel boxes it sits in are full width and full height, and the layer
          is pulled up over the board at `z-10`, so on every desktop viewport
          an invisible box covered the entire board and swallowed every hover.
          The board's Agent hit targets have been unreachable on this page for
          as long as the page has existed; they only ever worked in the study,
          which has no panel layer over it. Found while wiring the operator's
          "show that it's a real thing" pass, and it is the reason that pass
          could not have worked without this line. Conversion affordances opt
          back in with `pointer-events-auto`, and `DownloadCta` already did. */}
      <div
        className={`pointer-events-none relative z-10 ${PANELS_PULLUP_CLASS}`}
        data-pinned-panels-layer
      >
        {bands.map((band, index) => (
          <PinnedPanel
            key={band.id}
            band={band}
            index={index}
            active={index === active}
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
  theme,
  snapshot,
  accent,
  register,
}: {
  band: HomepageBand;
  index: number;
  active: boolean;
  theme: { label: string; muted: string };
  /** The whole resolved snapshot, which the lens needs for its palette. */
  snapshot: SpatialThemeSnapshot;
  accent: string;
  register: (node: HTMLElement | null) => void;
}) {
  const copy = altitudePanel(band.id);
  // The FOLD is panel zero and it is the one panel whose interior is not a
  // claim about the board. `headingRole` is the discriminator rather than the
  // id, because "the band that carries the page headline" is exactly the thing
  // that is true about it, and the manifest already allows only one.
  const isFold = band.headingRole === 'headline';
  // Every panel names its OWN subject, not the active one's. Gating it on
  // "am I active" was wrong twice: unpinned, every panel is on screen at once
  // and only one of them would have named anything; and pinned, the subject
  // would have popped a frame after the panel it belongs to.
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
    () =>
      resolveHeroLens(HERO_BOARD_CAPTURE, band.boardLens ?? 'status', snapshot),
    [band.boardLens, snapshot]
  );
  // ONE STAT LINE PER PANEL, and only one. A panel whose lens prints a legend
  // has its state line already; every other panel prints the subject the
  // highlight resolved off the capture. The fold prints neither: its stat line
  // is the board's own fleet chip, which is in frame beside it.
  const showLegend = lens.active && lens.legend.length > 0;
  const showSubject = !isFold && !showLegend;
  const style = {
    '--panel-screens': band.screens,
    // The pinned pass owns this after first paint. It starts at the first
    // panel's own presence so nothing flashes in before the listener runs.
    '--panel-opacity': index === 0 ? 1 : 0,
  } as CSSProperties;

  return (
    <div
      ref={register}
      className={cn(
        // Stacked: an ordinary block, as tall as its copy, at full strength.
        // Pinned: a box sized in viewport heights whose presence is a function
        // of scroll position.
        'relative w-full opacity-100 md:h-[calc(var(--panel-screens)*100svh)] md:opacity-[var(--panel-opacity)] motion-reduce:md:h-auto motion-reduce:md:opacity-100',
        isFold ? 'pt-9 pb-12' : 'py-9',
        'md:py-0 motion-reduce:md:py-10'
      )}
      style={style}
      data-pinned-panel={band.id}
      data-pinned-panel-active={active ? 'true' : undefined}
    >
      {/* THE SNAP POINT, and only where snapping helps. The fold has none: it
          is the top of the document, the reader's resting place there is
          scroll zero, and a snap point 24px below it would fight the one
          position every page already has. Every later panel gets one, so a
          finger that stops between two claims settles onto the nearer one.
          `md:` only, so the phone's document-flow reading column is never
          nudged mid-sentence, and off under reduced motion, where the sequence
          is unpinned and there are no steps to settle on. */}
      {index === 0 ? null : (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 h-px md:snap-start motion-reduce:md:snap-align-none"
          style={{ top: SNAP_SENTINEL_TOP }}
          data-pinned-snap-point={band.id}
        />
      )}
      {/* THE SAFE BAND. Pinned, the column lives in a nested sticky box that is
          exactly the viewport minus the site header and centres its content
          inside it, so a sentence cannot reach the header at any scroll offset
          and cannot reach the board's own chip either. Stacked, this is an
          ordinary block and the copy simply flows. */}
      <div
        className={`flex w-full items-center ${SAFE_BAND_CLASS}`}
        data-pinned-panel-safe-band
      >
        <div
          className={cn(
            'pointer-events-none relative w-full px-6 sm:px-10 md:max-w-[30rem] lg:max-w-[34rem] lg:pl-16',
            isFold && 'md:max-w-[32rem] lg:max-w-[36rem]'
          )}
          data-pinned-panel-column
        >
          {isFold ? (
            <FoldHero />
          ) : (
            <>
              <BandHeading
                band={band}
                className="tracking-tight"
                style={{ color: theme.muted }}
                data-pinned-panel-heading
              />
              {/* Real paragraphs, with real spacing. The claim used to stack
                  its sentences as bare blocks, which set an eight-line slab at
                  one leading with no rhythm inside it. Two sentences, two
                  paragraphs, and the measure stays where a reader's eye can
                  return to the left edge without hunting. */}
              <div
                className="mt-3 flex flex-col gap-3 text-[17px] leading-relaxed font-medium text-pretty sm:text-xl sm:leading-relaxed lg:text-[22px] lg:leading-relaxed"
                style={{ color: theme.label }}
                data-pinned-panel-copy
              >
                {copy?.copy.map(line => (
                  <p key={line}>{line}</p>
                ))}
              </div>
              {/* The board's own numbers, read off the capture, never typed. */}
              {showSubject ? (
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
                    className="text-sm"
                    style={{ color: theme.muted }}
                    data-pinned-panel-subject-detail
                  >
                    {subject.detail}
                  </span>
                </p>
              ) : null}
              {/* THE LENS LEGEND, and it is this panel's stat line. Printed
                  only when the lens is actually re-reading the board: a legend
                  for colours the board is not using is worse than no legend,
                  which is why `active` is a property of the resolved lens
                  rather than of the band. */}
              {showLegend ? (
                <div
                  className="mt-5 flex flex-col gap-2"
                  data-pinned-panel-legend
                >
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {lens.legendKind === 'ramp' ? (
                      <span className="flex items-center gap-2">
                        <span
                          className="text-sm"
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
                          className="text-sm"
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
                          {/* THE HARNESS'S OWN MARK (ENG-031 W10, operator:
                              "I want it to show a recognizable harness
                              logo"). The swatch is what maps the legend to
                              the board; the mark is what a stranger
                              recognises before they read the name. Drawn in
                              the panel's own ink rather than the source
                              colour: three of these vendors forbid
                              recolouring their mark, and the colour is
                              already said by the swatch beside it. See
                              `LICENSES/brand/harness-marks.md`. */}
                          {channel.adapterId &&
                          harnessMarkExists(channel.adapterId) ? (
                            <span
                              aria-hidden
                              className="inline-flex shrink-0 items-center justify-center"
                              style={{ color: theme.label }}
                              data-pinned-legend-harness={channel.adapterId}
                            >
                              <HarnessMark
                                adapterId={channel.adapterId}
                                size={16}
                              />
                            </span>
                          ) : null}
                          <span
                            className="text-sm"
                            style={{ color: theme.label }}
                          >
                            {channel.label}
                          </span>
                        </span>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              {copy?.coda ? (
                <p
                  className="mt-4 text-[13px] leading-snug sm:text-sm"
                  style={{ color: theme.muted }}
                  data-pinned-panel-coda
                >
                  {copy.coda}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
