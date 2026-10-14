'use client';

/**
 * The open agent, stood where it belongs (ENG-031 W15h), in the same agent
 * card the dissections show (W15j: one card on the page, never two). Placement is
 * `panel-placement.ts`: pinned to a side of the stage, drifting a little with
 * the selected tile, never over it. This component is the motion:
 *
 * - It appears where it belongs. It never slides in from wherever it last
 *   was (operator 2026-10-12: "it slowly translates to position"), so the
 *   first frame of an open snaps to its place and only the opacity and a
 *   small scale come in.
 * - Selecting another agent while it is open moves it, quickly, to the new
 *   place, which is a few pixels away, so it reads as following the
 *   selection, not as a new panel.
 * - Closing fades it where it stands, still showing the agent it showed.
 *
 * Position is written to the element every frame from refs, never through
 * React state, so following the world costs no renders.
 */

import { useEffect, useRef, useState } from 'react';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import { AgentCard } from './agent-card';
import type { FleetAgent } from './fleet-model';
import { HEADER_PX, isNarrow, isShort } from './narrow';
import { panelWidth, placePanel, type PanelSide } from './panel-placement';
import type { VisualAnchor } from './visual-contract';

/** Per second: opacity coming in, going out, and the move between places. */
const IN_RATE = 24;
const OUT_RATE = 16;
const MOVE_RATE = 18;

export function PinnedAgentPanel({
  agent,
  theme,
  anchor,
  column,
  insetTop,
  insetTopNarrow,
  insetBottom = 36,
  narrowSlack = HEADER_PX,
  narrowOnly = false,
  reducedMotion,
}: {
  /** The selected agent, or null. */
  agent: FleetAgent | null;
  theme: SpatialThemeSnapshot;
  /** Where the visual says the selected tile is on screen. */
  anchor: VisualAnchor;
  /** The side the stage's reading column is on. */
  column: PanelSide;
  /** Chrome over the stage's top and foot that the panel keeps clear of. */
  insetTop: number;
  /** The top inset when the stage is narrow, if it differs (a phone has the
   *  stage's own stamp across the top). */
  insetTopNarrow?: number;
  insetBottom?: number;
  /** How much taller than wide a stage can be before it counts as narrow. */
  narrowSlack?: number;
  /** Open only where the reading column's card is not shown, a narrow or a
   *  short stage: where the agent card already stands beside the world, the
   *  card is the selection and this stays shut. */
  narrowOnly?: boolean;
  reducedMotion: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // The agent shown stays while the panel fades out.
  const [held, setHeld] = useState<FleetAgent | null>(agent);
  if (agent !== null && agent !== held) setHeld(agent);

  const latest = useRef({
    agent,
    column,
    insetTop,
    insetTopNarrow,
    insetBottom,
    narrowSlack,
    narrowOnly,
    reducedMotion,
  });
  useEffect(() => {
    latest.current = {
      agent,
      column,
      insetTop,
      insetTopNarrow,
      insetBottom,
      narrowSlack,
      narrowOnly,
      reducedMotion,
    };
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    const host = wrap?.parentElement;
    if (!wrap || !host) return;
    // Sizes are read in the frame that uses them. A resize observer reports
    // after the frame's animation callbacks, so the first frame of the first
    // open would have placed a panel that had no height yet.
    const state = {
      open: false,
      x: 0,
      y: 0,
      opacity: 0,
      side: 0 as PanelSide,
      width: 0,
      sheet: '',
    };
    let frame = 0;
    let before = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - before) / 1000);
      before = now;
      const mine = latest.current;
      const point = anchor.focusPoint;
      const width = host.clientWidth;
      const height = host.clientHeight;
      const narrow = isNarrow(width, height, mine.narrowSlack);
      // the reading column's card is not shown on a short stage either
      const short = isShort(height);
      const want =
        mine.agent !== null &&
        point !== null &&
        anchor.focus === mine.agent.id &&
        (narrow || short || !mine.narrowOnly);
      const w = panelWidth(width, narrow);
      if (w !== state.width) {
        wrap.style.width = `${w}px`;
        state.width = w;
      }
      const panelHeight = wrap.offsetHeight;
      const ease = (rate: number) =>
        mine.reducedMotion ? 1 : 1 - Math.exp(-rate * dt);
      if (want && point) {
        const target = placePanel({
          stage: { width, height },
          tile: point,
          panel: { width: w, height: panelHeight },
          column: mine.column,
          narrow,
          inset: {
            top: narrow
              ? (mine.insetTopNarrow ?? mine.insetTop)
              : mine.insetTop,
            bottom: mine.insetBottom,
          },
          previousSide: state.side,
        });
        if (!state.open) {
          // appears where it belongs
          state.x = target.x;
          state.y = target.y;
          state.open = true;
        } else {
          const k = ease(MOVE_RATE);
          state.x += (target.x - state.x) * k;
          state.y += (target.y - state.y) * k;
        }
        state.side = target.side;
        state.opacity += (1 - state.opacity) * ease(IN_RATE);
      } else {
        state.open = false;
        state.opacity += (0 - state.opacity) * ease(OUT_RATE);
        if (state.opacity < 0.01) state.opacity = 0;
      }
      // On a phone the stage's CSS reads which end the sheet took, and the
      // reading column at that end steps aside; the compact card is the
      // sheet's, the full card the side panel's.
      const sheet =
        narrow && want ? (state.y > height / 2 ? 'foot' : 'top') : '';
      // the compact card where the full one would fill the stage: a phone's
      // sheet, and any stage too short to hold it beside the agent
      const compactFlag = narrow || short ? 'true' : 'false';
      if (wrap.dataset.compact !== compactFlag)
        wrap.dataset.compact = compactFlag;
      if (sheet !== state.sheet) {
        state.sheet = sheet;
        if (sheet) host.dataset.sheet = sheet;
        else delete host.dataset.sheet;
      }
      const o = state.opacity;
      wrap.style.opacity = String(o);
      wrap.style.visibility = o === 0 ? 'hidden' : 'visible';
      wrap.style.pointerEvents = want && o > 0.6 ? 'auto' : 'none';
      wrap.style.transform = `translate3d(${state.x.toFixed(1)}px, ${state.y.toFixed(1)}px, 0) scale(${(0.96 + 0.04 * o).toFixed(4)})`;
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      delete host.dataset.sheet;
    };
  }, [anchor]);

  return (
    <div
      ref={wrapRef}
      role="region"
      aria-label="Selected agent"
      aria-hidden={agent === null}
      className="group/sheet pointer-events-none invisible absolute left-0 top-0 origin-center opacity-0 will-change-transform"
    >
      {held ? (
        <>
          <AgentCard
            agent={held}
            accent={theme.selection}
            className="w-full group-data-[compact=true]/sheet:hidden"
          />
          {/* on a phone, or a stage too short for the full card, the card's
              compact form: the full card would reach the agent from either
              end of the stage */}
          <AgentCard
            agent={held}
            accent={theme.selection}
            compact
            className="hidden w-full group-data-[compact=true]/sheet:block"
          />
        </>
      ) : null}
    </div>
  );
}
