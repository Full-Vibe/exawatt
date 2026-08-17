'use client';

/**
 * The hero board's DOM annotation layer (ENG-031 W2, operator review
 * 2026-08-17).
 *
 * The board's first review verdict was that it "is just a pile of rotating
 * icons". Everything here exists to answer, without a sentence of explanation,
 * the three questions a cold visitor has in the first two seconds:
 *
 *   what are the circles   -> every Project circle carries its real name, its
 *                             agent count, and how many of its agents need a
 *                             human, anchored to the projected centre.
 *   what are the dots      -> the legend names the five signals the product
 *                             itself uses. No sixth light is invented here.
 *   are these real         -> scroll in and every mark becomes a hoverable,
 *                             focusable, clickable Agent with its real name
 *                             and the six-word contract it is executing.
 *
 * Mechanics, per `r3f-authoring-guide.md`:
 *
 * - Text is DOM, never in-scene (decision `0003`): crisp at any DPR, in the
 *   accessibility tree, and free of the canvas's draw-call budget.
 * - Nothing renders React at frame rate (rule 14). The scene projects anchors
 *   into `HeroAnnotationBridge` once per rendered frame and calls back here;
 *   this layer writes `style.transform` on nodes it already owns. React state
 *   carries semantic identity only: the hovered unit, the selected unit, and
 *   the small set of units close enough to deserve a hit target.
 * - Hit testing is DOM, not raycasting. The units are one InstancedMesh with
 *   `raycast` disabled, so pointer work costs nothing at Fleet altitude, and
 *   what a mouse can reach a keyboard can reach too.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import { spatialColorWithAlpha } from '@/components/fleet/spatial/spatial-theme';
import {
  STATUS_LIGHT_META,
  statusLightStateForAgentStatus,
} from '@/components/status-light/protocol';
import type { StatusLightState } from '@/components/status-light/protocol';
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';
import type { HeroHighlight } from './hero-board-highlight';
import {
  AGENT_AFFORDANCE_PROGRESS,
  AGENT_TRACK_INTERVAL_MS,
  AGENT_TRACK_LIMIT,
  AGENT_TRACK_MIN_RADIUS_PX,
  type HeroBridgeAccess,
} from './hero-board-annotations';

/**
 * What a receded Project label keeps. Higher than the marks' own floor: a name
 * you can still read is what keeps the rest of the board legible as context
 * rather than as blur, and the emphasis is carried by the marks.
 */
const LABEL_DIM = 0.28;

/** A Project label is gone this close to the frame edge, and full strength by
 *  the second number. A chip is about 140px wide, so a centre inside the first
 *  figure is already half outside the frame. */
const LABEL_EDGE_HIDE_PX = 40;
const LABEL_EDGE_FADE_PX = 160;

/** And the same at the TOP, where the frame's own fleet chip lives. A Project
 *  label riding up into it printed two lines of chrome through each other on
 *  a phone, where the frame is short and the labels reach the top edge. The
 *  window is deliberately NARROW and measured against the label's own top
 *  rather than its anchor: a wide fade here dimmed the fold's own subject,
 *  which is the one label on the page that has to be at full strength. */
const LABEL_TOP_HIDE_PX = 34;
const LABEL_TOP_FADE_PX = 50;
/** A Project label's own height, chip plus counts. Constant rather than
 *  measured: reading it here would force a layout inside the render loop. */
const LABEL_HEIGHT_PX = 46;

/** The identity card's own width, matching its class, so the flip decision can
 *  be made without a layout read inside the render loop. */
const CARD_WIDTH_PX = 240;
const CARD_MAX_WIDTH_SHARE = 0.62;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The five signals, loudest first, exactly as the product names them. */
const LEGEND: StatusLightState[] = [
  'needs-you',
  'fault',
  'active',
  'result',
  'off',
];

function statusOf(
  capture: HeroBoardCapture,
  ordinal: number
): StatusLightState {
  return statusLightStateForAgentStatus(
    HERO_STATUS_ORDER[ordinal] ?? HERO_STATUS_ORDER[4]!
  );
}

export interface HeroBoardOverlayProps {
  capture: HeroBoardCapture;
  theme: SpatialThemeSnapshot;
  getBridge: HeroBridgeAccess;
  /** False on the poster path: there is no camera to project from, so the
   *  fixed chrome renders and the anchored labels do not. Same box either
   *  way, so the substitution costs no layout shift. */
  projected: boolean;
  /**
   * What the board is emphasizing (ENG-031 W4). The DOM labels recede on the
   * same eased curve the marks do, off the same array, so the annotation layer
   * and the WebGL layer never disagree about what the page is pointing at.
   */
  highlight: HeroHighlight;
  selected: number;
  onSelect: (index: number) => void;
}

export function HeroBoardOverlay({
  capture,
  theme,
  getBridge,
  projected,
  highlight,
  selected,
  onSelect,
}: HeroBoardOverlayProps) {
  const bridge = getBridge();
  const [tracked, setTracked] = useState<number[]>([]);
  const [hovered, setHovered] = useState(-1);
  const [statusTick, setStatusTick] = useState(0);

  const zoneNodes = useRef(new Map<number, HTMLElement>());
  const unitNodes = useRef(new Map<number, HTMLElement>());
  const cardNode = useRef<HTMLDivElement>(null);
  const beaconNode = useRef<HTMLDivElement>(null);
  const focus = useRef(-1);

  // The card follows whichever unit is under the pointer, then the selected
  // one, then the Agent the active panel is describing. Selection is what
  // survives a mouse leaving; the highlight's own subject is what makes the
  // closest altitude legible with no pointer in the room at all.
  const shown =
    hovered >= 0 ? hovered : selected >= 0 ? selected : highlight.subject.unit;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const beaconRef = useRef(highlight.beacon);
  beaconRef.current = highlight.beacon;

  /* -------------------------------------------------------------- */
  /* per-frame positioning: transforms only, never a layout read     */
  /* -------------------------------------------------------------- */

  const flush = useCallback((): void => {
    const bridge = getBridge();
    for (const [index, node] of zoneNodes.current) {
      const anchor = bridge.zones[index];
      if (!anchor) continue;
      if (!anchor.onScreen) {
        node.style.opacity = '0';
        continue;
      }
      // The label sits over the TOP OF ITS OWN circle, not above it. At the
      // Fleet altitude ten circles leave about twelve pixels of gap between
      // rows, so a label parked above its circle lands inside the one above.
      // A fraction of the radius keeps it tucked into the empty crown of its
      // own zone, where the marks are not, at every altitude.
      const lift = anchor.radius * 0.46 + 10;
      node.style.transform = `translate3d(${Math.round(anchor.x)}px, ${Math.round(
        anchor.y - lift
      )}px, 0) translate(-50%, -100%)`;
      // The label recedes with its zone, off the eased value the scene writes.
      // No CSS transition here on purpose: the value is ALREADY eased, and a
      // transition chasing a per-frame target only adds lag it never resolves.
      const focus = bridge.zoneFocus[index] ?? 1;
      // And it fades out at the frame edge rather than being sliced by it. A
      // name cut mid-word against a hard vertical edge reads as a rendering
      // bug, not as a crop, because the ground is the same on both sides.
      const margin = Math.min(anchor.x, bridge.width - anchor.x);
      const edge = smoothstep(LABEL_EDGE_HIDE_PX, LABEL_EDGE_FADE_PX, margin);
      const top = smoothstep(
        LABEL_TOP_HIDE_PX,
        LABEL_TOP_FADE_PX,
        anchor.y - lift - LABEL_HEIGHT_PX
      );
      node.style.opacity = String(
        (LABEL_DIM + (1 - LABEL_DIM) * focus) * edge * top
      );
    }
    for (const [index, node] of unitNodes.current) {
      const anchor = bridge.units[index];
      if (!anchor) continue;
      if (!anchor.onScreen) {
        node.style.opacity = '0';
        node.style.pointerEvents = 'none';
        continue;
      }
      const size = Math.max(22, Math.round(anchor.radius * 2));
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.transform = `translate3d(${Math.round(anchor.x)}px, ${Math.round(
        anchor.y
      )}px, 0) translate(-50%, -50%)`;
      const focus = bridge.unitFocus[index] ?? 1;
      node.style.opacity = String(0.3 + 0.7 * focus);
      node.style.pointerEvents = 'auto';
    }
    const beacon = beaconNode.current;
    if (beacon) {
      const anchor =
        beaconRef.current >= 0 ? bridge.units[beaconRef.current] : undefined;
      if (anchor?.onScreen) {
        beacon.style.transform = `translate3d(${Math.round(anchor.x)}px, ${Math.round(
          anchor.y
        )}px, 0)`;
        beacon.style.visibility = 'visible';
      } else {
        beacon.style.visibility = 'hidden';
      }
    }
    const card = cardNode.current;
    const target = shownRef.current;
    if (card && target >= 0) {
      const anchor = bridge.units[target];
      if (anchor?.onScreen) {
        // Flip when the card would not FIT, not at a fixed share of the frame.
        // A share works on a wide desktop frame and fails on a 390px phone,
        // where a unit left of centre still leaves less room than the card
        // needs and the contract line ran off the right edge. The width is a
        // constant matching the card's own class, so no layout is read inside
        // the render loop.
        const cardWidth = Math.min(
          CARD_WIDTH_PX,
          bridge.width * CARD_MAX_WIDTH_SHARE
        );
        const gap = anchor.radius + 14;
        const flip = anchor.x + gap + cardWidth > bridge.width - 8;
        card.style.transform = `translate3d(${Math.round(
          anchor.x + (flip ? -gap : gap)
        )}px, ${Math.round(anchor.y)}px, 0) translate(${
          flip ? '-100%' : '0'
        }, -50%)`;
        card.style.opacity = '1';
      } else {
        card.style.opacity = '0';
      }
    }
  }, [getBridge]);

  useEffect(() => {
    if (!projected) return;
    const bridge = getBridge();
    bridge.onProject = flush;
    flush();
    return () => {
      bridge.onProject = null;
    };
  }, [getBridge, flush, projected]);

  /* -------------------------------------------------------------- */
  /* which units own a hit target: re-chosen at 6Hz, never per frame */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const bridge = getBridge();
    if (!projected) {
      setTracked([]);
      bridge.tracked = [];
      return;
    }
    const pick = () => {
      if (bridge.progress < AGENT_AFFORDANCE_PROGRESS) {
        if (bridge.tracked.length === 0) return;
        // Pulling back out of the Agent altitude ends the inspection. A card
        // left pinned over the Fleet view covers three Projects and points at
        // a mark two pixels wide.
        bridge.tracked = [];
        setTracked([]);
        setHovered(-1);
        onSelect(-1);
        return;
      }
      const centreX = bridge.width / 2;
      const centreY = bridge.height / 2;
      const candidates: { index: number; distance: number }[] = [];
      for (let index = 0; index < bridge.units.length; index += 1) {
        const anchor = bridge.units[index]!;
        if (!anchor.onScreen) continue;
        if (
          anchor.x < 0 ||
          anchor.y < 0 ||
          anchor.x > bridge.width ||
          anchor.y > bridge.height
        )
          continue;
        candidates.push({
          index,
          distance: Math.hypot(anchor.x - centreX, anchor.y - centreY),
        });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const next = candidates.slice(0, AGENT_TRACK_LIMIT).map(c => c.index);
      // Keep whatever the visitor is currently reading, even if it drifted out
      // of the nearest set: a card must not vanish under the pointer.
      for (const keep of [shownRef.current, focus.current]) {
        if (keep >= 0 && !next.includes(keep)) next.push(keep);
      }
      next.sort((a, b) => a - b);
      // The projector measures an exact on-screen radius only for these.
      bridge.tracked = next;
      setTracked(previous =>
        previous.length === next.length &&
        previous.every((value, at) => value === next[at])
          ? previous
          : next
      );
    };
    pick();
    const timer = globalThis.setInterval(pick, AGENT_TRACK_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [getBridge, projected, onSelect]);

  /* -------------------------------------------------------------- */
  /* the shown unit's status is live, so watch just that one         */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const bridge = getBridge();
    bridge.onStatusChange = index => {
      if (index === shownRef.current) setStatusTick(tick => tick + 1);
    };
    return () => {
      bridge.onStatusChange = null;
    };
  }, [getBridge]);

  useEffect(() => {
    if (selected < 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSelect(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selected, onSelect]);

  /* -------------------------------------------------------------- */
  /* render                                                          */
  /* -------------------------------------------------------------- */

  const needsYou = capture.counts.needsYou;
  const unit = shown >= 0 ? capture.units[shown] : undefined;
  const unitStatus =
    unit !== undefined
      ? statusOf(capture, bridge.statuses[shown] ?? unit.status)
      : null;
  const unitProject =
    unit !== undefined ? capture.zones[unit.zone]?.label : undefined;
  void statusTick;

  const chrome = useMemo(
    () => ({
      label: theme.label,
      muted: theme.labelMuted,
      panel: spatialColorWithAlpha(theme.canvas, 0.82),
      // The Project name chip sits over its own zone fill, so it carries a
      // heavier panel than the floating card: at 18px it is the first thing a
      // stranger reads and it may not go translucent over a mark.
      namePanel: spatialColorWithAlpha(theme.canvas, 0.93),
      hairline: spatialColorWithAlpha(theme.grid, 0.9),
    }),
    [theme]
  );

  return (
    <div
      className="absolute inset-0 z-10"
      style={{ pointerEvents: 'none' }}
      data-hero-overlay
    >
      {/* What the board is, in product state rather than a sentence. */}
      {/* THE ONE MONO LINE ON THE PAGE (operator, W6b: "mono ONCE, the stat
          chip"). It carries a panel of its own ground so it reads as chrome
          over the board rather than as a caption tangled in the Project
          labels behind it. */}
      <p
        className="absolute top-2 left-3 rounded-md px-2 py-1 font-mono text-chrome-micro tracking-[0.14em] uppercase"
        style={{ color: chrome.muted, backgroundColor: chrome.panel }}
        data-hero-overlay-fixed
        data-hero-overlay-counts
      >
        <span style={{ color: chrome.label }}>{capture.counts.agents}</span>{' '}
        agents
        <span className="mx-1.5">·</span>
        <span style={{ color: chrome.label }}>
          {capture.counts.projects}
        </span>{' '}
        projects
        <span className="mx-1.5">·</span>
        <span style={{ color: theme.status['needs-you'] }}>
          {needsYou}
        </span>{' '}
        need you
      </p>

      {/* Colour means state, in the product's own five-signal vocabulary.
          It is set in the READING FACE, sentence case (ENG-031 W6b, operator:
          "kill the uppercase monospace eyebrows everywhere except that chip").
          Tracked uppercase mono is a machine voice, and these five words are
          the product's own vocabulary being taught to a person. The legend
          also stopped wrapping: at 390px five tracked items broke across two
          lines and orphaned IDLE on its own row. */}
      <ul
        // On a phone the legend and the honesty stamp share the bottom rail and
        // collide, so the legend steps up a line until there is room for both.
        className="absolute right-3 bottom-7 flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end gap-x-3 gap-y-1 rounded-md px-2 py-1 sm:bottom-2"
        style={{ color: chrome.muted, backgroundColor: chrome.panel }}
        data-hero-overlay-fixed
        data-hero-overlay-legend
      >
        {LEGEND.map(state => (
          <li
            key={state}
            className="flex shrink-0 items-center gap-1.5 text-[11px] leading-none whitespace-nowrap sm:text-xs"
          >
            <span
              aria-hidden
              className="inline-block size-1.5 rounded-full"
              style={{ backgroundColor: theme.status[state] }}
            />
            {STATUS_LIGHT_META[state].label}
          </li>
        ))}
      </ul>

      {projected ? (
        <>
          {/* Project circles, named. The name is the biggest thing on the
              board that is not the board: it is what makes a stranger's first
              two seconds work, so it is set as a primary typographic element
              (18px semibold sans, the `section` rung) rather than as chrome.
              Operator, 2026-08-17: "the labels are mono-spaced and too small".
              Mono is reserved for tracked micro-labels at 11px and below, and
              a Project name is neither. The counts stay a size below it, so
              the pair still reads as one label with a hierarchy inside it. */}
          {capture.zones.map((zone, index) => (
            <div
              key={zone.label}
              ref={node => {
                if (node) zoneNodes.current.set(index, node);
                else zoneNodes.current.delete(index);
              }}
              className="absolute top-0 left-0 flex flex-col items-center gap-1 whitespace-nowrap"
              style={{ opacity: 0, willChange: 'transform, opacity' }}
              data-hero-zone-label={zone.label}
            >
              <span
                className="rounded-md border px-2.5 py-1 text-lg leading-tight font-semibold tracking-tight"
                style={{
                  color: chrome.label,
                  backgroundColor: chrome.namePanel,
                  borderColor: chrome.hairline,
                }}
                data-hero-zone-name
              >
                {zone.label}
              </span>
              <span
                className="flex items-center gap-1.5 text-chrome-label font-medium"
                style={{ color: chrome.muted }}
                data-hero-zone-counts
              >
                {zone.agentCount} agents
                {zone.needsYou > 0 ? (
                  <>
                    <span
                      aria-hidden
                      className="inline-block size-1.5 rounded-full"
                      style={{ backgroundColor: theme.status['needs-you'] }}
                    />
                    <span style={{ color: theme.status['needs-you'] }}>
                      {zone.needsYou} need you
                    </span>
                  </>
                ) : null}
              </span>
            </div>
          ))}

          {/* Individual agents, once the pull is close enough to aim at one. */}
          {tracked.map(index => {
            const target = capture.units[index];
            if (!target) return null;
            const state = statusOf(
              capture,
              bridge.statuses[index] ?? target.status
            );
            const isShown = index === shown;
            return (
              <button
                key={index}
                type="button"
                ref={node => {
                  if (node) unitNodes.current.set(index, node);
                  else unitNodes.current.delete(index);
                }}
                className="absolute top-0 left-0 rounded-full transition-[border-color,background-color,box-shadow] duration-150 outline-none"
                style={{
                  opacity: 0,
                  willChange: 'transform',
                  // Resting: a hairline that says "aimable" without competing
                  // with the mark inside it. Shown: the unit's own status
                  // colour, so the highlight and the signal agree.
                  borderWidth: isShown ? 2 : 1,
                  borderStyle: 'solid',
                  borderColor: isShown
                    ? theme.status[state]
                    : spatialColorWithAlpha(theme.label, 0.2),
                  backgroundColor: isShown
                    ? spatialColorWithAlpha(theme.status[state], 0.16)
                    : 'transparent',
                  boxShadow: isShown
                    ? `0 0 0 4px ${spatialColorWithAlpha(theme.status[state], 0.16)}`
                    : 'none',
                }}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(-1)}
                onFocus={() => {
                  focus.current = index;
                  setHovered(index);
                }}
                onBlur={() => {
                  focus.current = -1;
                  setHovered(-1);
                }}
                onClick={() => onSelect(selected === index ? -1 : index)}
                data-hero-unit={index}
                data-hero-unit-shown={isShown ? 'true' : undefined}
              >
                <span className="sr-only">
                  {target.name}. {capture.zones[target.zone]?.label}.{' '}
                  {target.doing}. {STATUS_LIGHT_META[state].label}.
                </span>
              </button>
            );
          })}

          {/* ONE BREATHING MARK (ENG-031 W6b). The single agent the framed
              Project is waiting on, haloed in the DOM so the fold has
              something alive in it without putting a pulse on 173 marks or
              spending the measured idle budget on the GPU. Reduced motion
              holds it still; `visibility` rather than `display` so the node is
              never remounted. */}
          <div
            ref={beaconNode}
            aria-hidden
            className="absolute top-0 left-0"
            style={{ visibility: 'hidden', willChange: 'transform' }}
            data-hero-beacon={
              highlight.beacon >= 0 ? highlight.beacon : undefined
            }
          >
            {highlight.beacon >= 0 ? (
              <span
                className="hero-beacon-breath absolute block size-14 rounded-full"
                style={{
                  backgroundColor: spatialColorWithAlpha(
                    theme.status['needs-you'],
                    0.55
                  ),
                }}
              />
            ) : null}
          </div>

          {/* The identity card. One node, moved, never remounted. */}
          <div
            ref={cardNode}
            aria-hidden
            className="absolute top-0 left-0 w-[15rem] max-w-[62%] rounded-md border p-2.5 transition-opacity duration-150"
            style={{
              opacity: 0,
              willChange: 'transform',
              backgroundColor: chrome.panel,
              borderColor: chrome.hairline,
              backdropFilter: 'blur(6px)',
              display: unit ? undefined : 'none',
            }}
            data-hero-unit-card={unit ? String(shown) : undefined}
          >
            {unit && unitStatus ? (
              <>
                <p
                  className="text-chrome-title font-semibold"
                  style={{ color: chrome.label }}
                >
                  {unit.name}
                </p>
                <p className="mt-0.5 text-xs" style={{ color: chrome.muted }}>
                  {unitProject}
                </p>
                <p
                  className="mt-1.5 text-chrome-label"
                  style={{ color: chrome.label }}
                >
                  {unit.doing}
                </p>
                <p className="mt-1.5 flex items-center gap-1.5 text-xs">
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: theme.status[unitStatus] }}
                  />
                  <span style={{ color: theme.status[unitStatus] }}>
                    {STATUS_LIGHT_META[unitStatus].label}
                  </span>
                </p>
              </>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
