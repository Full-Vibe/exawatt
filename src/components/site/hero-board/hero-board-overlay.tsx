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
import { cn } from '@/lib/utils';
import {
  STATUS_LIGHT_META,
  statusLightStateForAgentStatus,
} from '@/components/status-light/protocol';
import type { StatusLightState } from '@/components/status-light/protocol';
import { heroActiveByZone } from './hero-board-activity';
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
 *
 * Lowered from 0.28 (ENG-031 W9, operator: "these project labels sort of
 * compete with the h2 / h1 text - big, contrast. Maybe make them more
 * subtle"). Labels are WAYFINDING, and the reading column has to win at every
 * altitude; a name is still legible here and no longer the first thing the eye
 * lands on when a panel is making a claim beside it.
 */
const LABEL_DIM = 0.22;

/**
 * How a Project label leaves the frame edge, measured from ITS OWN EDGE rather
 * than from its anchor (ENG-031 W6c).
 *
 * The previous window compared the anchor's distance to the frame edge against
 * a guessed 140px chip. Names are not all one width: "Growth Marketing",
 * "Device Telemetry" and "Customer Support" all reached full strength with a
 * third of the chip already outside the frame, and on production they rendered
 * as `owth Marketing` and `Customer Suppor`, cut mid-word against a hard
 * vertical edge with the same ground on both sides. That reads as a rendering
 * bug rather than as a crop, which is exactly what the fade exists to prevent.
 *
 * The width is READ ONCE PER LABEL and cached. Its content is a fixed name and
 * two fixed counts, so the box never changes size, and one layout read per
 * zone on the first frame is not a per-frame layout read.
 */
const LABEL_EDGE_HIDE_PX = 0;
const LABEL_EDGE_FADE_PX = 56;

/** And the same at the TOP, where the frame's own fleet chip lives. A Project
 *  label riding up into it printed two lines of chrome through each other on
 *  a phone, where the frame is short and the labels reach the top edge. The
 *  window is deliberately NARROW and measured against the label's own top
 *  rather than its anchor: a wide fade here dimmed the fold's own subject,
 *  which is the one label on the page that has to be at full strength. */
const LABEL_TOP_HIDE_PX = 34;
const LABEL_TOP_FADE_PX = 50;
/** A Project label's own height, name plus counts. Constant rather than
 *  measured: reading it here would force a layout inside the render loop.
 *  Down from 46 with the type (W9): a 13/14px name at `py-0.5` over a 10px
 *  count line measures about 38. */
const LABEL_HEIGHT_PX = 38;

/** The identity card's own width, matching its class, so the flip decision can
 *  be made without a layout read inside the render loop. */
const CARD_WIDTH_PX = 240;
const CARD_MAX_WIDTH_SHARE = 0.62;
/** And its height, for the same reason: four lines plus its own padding. */
const CARD_HEIGHT_PX = 112;

/**
 * Below this frame width the board is the phone's card, and it names FEWER
 * Projects (ENG-031 W6c).
 *
 * A 390px frame holds about two and a half name chips across. At the fold and
 * at every fleet framing it was printing five, so `Battery Dispatch`,
 * `Gateway Firmware`, `Installer Portal`, `Cloud Platform` and `Customer App`
 * stacked through each other and through their own counts, and the identity
 * card landed on top of the pile. The board stopped naming itself and started
 * looking broken, which is the "pile of rotating icons" verdict returning at a
 * smaller size.
 *
 * The rule is the canon's own framing rule rather than a smaller font: a
 * portrait viewport CROPS instead of fitting, so the phone names what is in
 * the middle of the frame and lets the rest be marks. Emphasis wins first, so
 * a panel pointing at one Project always gets that Project's name; proximity
 * to the frame centre breaks the tie when every zone leads.
 */
const COMPACT_FRAME_PX = 560;
const COMPACT_LABEL_LIMIT = 2;

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
  /** The live "N active" span inside each Project label. Written as text on a
   *  node the overlay already owns, never through React (W9). */
  const activeNodes = useRef(new Map<number, HTMLElement>());
  /** Per-Project count of Agents that are not idle, recomputed only when the
   *  scheduler actually turns one. */
  const activeCounts = useRef(new Int32Array(capture.zones.length));
  const activeDirty = useRef(true);
  /** Each Project label's half width, read once. It changes only when the
   *  count line's digits do, which is what `activeWidthEpoch` re-reads. */
  const labelHalfWidths = useRef(new Map<number, number>());
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
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const beaconRef = useRef(highlight.beacon);
  beaconRef.current = highlight.beacon;
  /**
   * The Project of whatever mark the pointer is on, or -1 (W9).
   *
   * Hovering a mark at ANY altitude lifts its Project's name to full strength.
   * That is the honest amount of detail a seven-pixel dot can carry, and at
   * the fold's crop it is the whole interaction: the reader points at a dot
   * and the board tells them which team it belongs to.
   */
  const hoverZoneRef = useRef(-1);
  hoverZoneRef.current =
    hovered >= 0 ? (capture.units[hovered]?.zone ?? -1) : -1;

  /* -------------------------------------------------------------- */
  /* per-frame positioning: transforms only, never a layout read     */
  /* -------------------------------------------------------------- */

  const flush = useCallback((): void => {
    const bridge = getBridge();
    // A phone names the middle of the frame and lets the rest be marks. The
    // ranking is computed BEFORE the write pass so the decision is one pass
    // over ten zones rather than a comparison inside each label's own write.
    const compact = bridge.width > 0 && bridge.width < COMPACT_FRAME_PX;
    let named: Set<number> | null = null;
    if (compact) {
      const centreX = bridge.width / 2;
      const ranked: { index: number; focus: number; distance: number }[] = [];
      for (const index of zoneNodes.current.keys()) {
        const anchor = bridge.zones[index];
        if (!anchor?.onScreen) continue;
        ranked.push({
          index,
          focus: bridge.zoneFocus[index] ?? 1,
          distance: Math.abs(anchor.x - centreX),
        });
      }
      // Emphasis first, then the middle of the frame. A panel pointing at one
      // Project always keeps that Project's name.
      ranked.sort(
        (a, b) =>
          b.focus - a.focus || a.distance - b.distance || a.index - b.index
      );
      named = new Set(
        ranked.slice(0, COMPACT_LABEL_LIMIT).map(entry => entry.index)
      );
    }
    for (const [index, node] of zoneNodes.current) {
      const anchor = bridge.zones[index];
      if (!anchor) continue;
      if (!anchor.onScreen || (named && !named.has(index))) {
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
      // A hovered mark lifts its own Project's name out of the recession,
      // whatever the panel beside it is emphasizing.
      const focus =
        index === hoverZoneRef.current ? 1 : (bridge.zoneFocus[index] ?? 1);
      // And it fades out at the frame edge rather than being sliced by it. A
      // name cut mid-word against a hard vertical edge reads as a rendering
      // bug, not as a crop, because the ground is the same on both sides.
      // Measured from the label's OWN edge: a chip is as wide as the name in
      // it, and one guessed width let the long names print half outside.
      let half = labelHalfWidths.current.get(index);
      if (half === undefined) {
        half = node.offsetWidth / 2;
        labelHalfWidths.current.set(index, half);
      }
      const margin = Math.min(anchor.x, bridge.width - anchor.x) - (half ?? 0);
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
      // A HIT TARGET IS NOT A DECORATION (W9). Every altitude now carries
      // them, so at the fold's crop they must be invisible until pointed at:
      // three dozen hairline rings over the hero would be exactly the "pile of
      // icons" verdict returning as chrome. Past the radius where a mark is an
      // individual they read as the aimable affordance they always were.
      const individual = anchor.radius >= AGENT_TRACK_MIN_RADIUS_PX;
      const showRing = individual || index === shownRef.current;
      node.style.opacity = showRing ? String(0.3 + 0.7 * focus) : '0';
      node.style.pointerEvents = 'auto';
    }
    // THE LIVE "N ACTIVE" LINE. Recomputed only when the scheduler turned an
    // Agent, and written as text on nodes the overlay already owns, so a
    // number that changes with the board costs no React render.
    if (activeDirty.current && activeNodes.current.size > 0) {
      activeDirty.current = false;
      const counts = heroActiveByZone(
        capture,
        bridge.statuses,
        activeCounts.current
      );
      for (const [index, node] of activeNodes.current) {
        const next = `${counts[index] ?? 0} active`;
        if (node.textContent === next) continue;
        node.textContent = next;
        // The label's width can follow its digits, so the edge fade has to
        // re-read the one label that changed. Only that one: clearing the
        // whole cache would force ten synchronous layout reads on every
        // scheduler turn, which at nine turns a second is exactly the
        // per-frame layout thrash guide rule 14 exists to prevent.
        labelHalfWidths.current.delete(index);
      }
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
      // THE CARD OPENS ON PIXELS, NOT ON SCROLL POSITION (W9). "Is this mark
      // an individual" is a question about how big it is on screen, and the
      // constant that answers it already existed. Below it a hover gets a
      // target ring and its Project's name; above it, the full identity.
      if (anchor?.onScreen && anchor.radius >= AGENT_TRACK_MIN_RADIUS_PX) {
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
        // BESIDE, FLIPPED, OR STACKED, in that order (ENG-031 W6c).
        //
        // Testing the right edge alone put the card off the LEFT one on a
        // phone: a mark near the right edge flipped, and 240px to its left is
        // -106px in a 390px frame, so the whole card rendered outside the
        // board. Flipping now requires room on the side it flips TO, and when
        // neither side has room the card stacks under its own mark instead of
        // being clamped on top of it, which is the only placement a frame
        // narrower than a mark plus a card actually has.
        const fitsRight = anchor.x + gap + cardWidth <= bridge.width - 8;
        const fitsLeft = anchor.x - gap - cardWidth >= 8;
        const clampLeft = (value: number) =>
          Math.min(
            Math.max(8, value),
            Math.max(8, bridge.width - cardWidth - 8)
          );
        if (fitsRight || fitsLeft) {
          const left = clampLeft(
            fitsRight ? anchor.x + gap : anchor.x - gap - cardWidth
          );
          card.style.transform = `translate3d(${Math.round(
            left
          )}px, ${Math.round(anchor.y)}px, 0) translate(0, -50%)`;
        } else {
          const left = clampLeft(anchor.x - cardWidth / 2);
          const below = anchor.y + gap;
          const stackAbove = below + CARD_HEIGHT_PX > bridge.height - 8;
          card.style.transform = `translate3d(${Math.round(
            left
          )}px, ${Math.round(stackAbove ? anchor.y - gap : below)}px, 0) translate(0, ${
            stackAbove ? '-100%' : '0'
          })`;
        }
        card.style.opacity = '1';
      } else {
        card.style.opacity = '0';
      }
    }
  }, [capture, getBridge]);

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
      // HIT TARGETS AT EVERY ALTITUDE (W9, operator: "subtle mouseover effects
      // on the agents just to show that it's a real thing, not like a gif").
      // This used to return early and CLEAR everything below the affordance
      // progress, so the fold and the attention beat answered a mouse with
      // nothing at all. What that early return was really protecting against
      // was a card pinned over the fleet pointing at a two-pixel mark, and
      // that is now handled where it belongs, on the mark's own projected
      // radius. Selection still ends when the reader leaves the close
      // altitudes, because a selection is a semantic act and a stale one is a
      // claim about a mark nobody can see.
      if (bridge.progress < AGENT_AFFORDANCE_PROGRESS && selectedRef.current >= 0) {
        onSelect(-1);
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
      // Every turn moves a per-Project count; only the shown card needs React.
      activeDirty.current = true;
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

  /**
   * The ONE Project a panel is pointing at, or -1 (ENG-031 W9).
   *
   * The operator asked for the active Project to read at full strength while
   * the rest recede. Emphasis already travels per frame as an eased opacity,
   * which is the right channel for a value that changes every frame; WEIGHT
   * and COLOUR are semantic, they change a handful of times over the whole
   * page, and writing them per frame would be exactly the layout thrash guide
   * rule 14 forbids. So they are decided here, once per highlight, and the
   * span carries a colour transition matched to the scene's own focus ease so
   * the change arrives with the rest of the board rather than cutting.
   */
  const leadZone = useMemo(() => {
    let found = -1;
    for (let index = 0; index < highlight.zones.length; index += 1) {
      if (highlight.zones[index] !== 1) continue;
      if (found >= 0) return -1;
      found = index;
    }
    return found;
  }, [highlight]);

  /**
   * ACTIVE MEANS NOT IDLE, in the product's own five-signal vocabulary: an
   * Agent working, reviewing, holding a result, waiting on you, or faulted is
   * an Agent with work on it; only `off` is not. Read through
   * `statusLightStateForAgentStatus`, so the definition here and the
   * definition the marks are coloured by are the same definition.
   *
   * This is the first paint's number, from the frozen capture. `flush()` takes
   * it over from the live statuses on the first scheduler turn.
   */
  const activeBaseline = useMemo(() => heroActiveByZone(capture), [capture]);

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
      // The Project name sits over its own zone fill, so it still carries a
      // panel of its own ground: a name that goes translucent over a mark is
      // unreadable on every preset. The panel is what keeps it legible; the
      // TYPE is what keeps it quiet (W9).
      namePanel: spatialColorWithAlpha(theme.canvas, 0.88),
      hairline: spatialColorWithAlpha(theme.grid, 0.9),
      // The count line recedes further than the name it sits under, so the
      // pair reads as one label with a hierarchy inside it rather than as two
      // competing lines. Alpha rather than a second palette entry, so it
      // resolves correctly on classic, night and air off the same token.
      counts: spatialColorWithAlpha(theme.labelMuted, 0.72),
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
          {/* Project circles, named. The name is WAYFINDING: it is what makes
              a stranger's first two seconds work, and it is not the argument.

              W2c set it at 18px semibold near-white, which answered "the
              labels are mono-spaced and too small" by overshooting into the
              reading column's own register. W9 brings it back down (operator:
              "these project labels sort of compete with the h2 / h1 text -
              big, contrast. Maybe make them more subtle"): 13/14px, medium
              rather than semibold, and the MUTED label token rather than the
              bright one, so the H1 at the fold and the claim on every panel
              win without a scrim.

              It is still sans and still not mono, because mono is reserved for
              tracked micro-labels and a Project name is not one. The Project a
              panel is actually pointing at steps up to full strength; the
              other nine stay wayfinding. */}
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
                className={cn(
                  'rounded px-1.5 py-0.5 text-[13px] leading-tight tracking-tight transition-colors duration-700 ease-out sm:px-2 sm:text-sm',
                  index === leadZone ? 'font-semibold' : 'font-medium'
                )}
                style={{
                  color: index === leadZone ? chrome.label : chrome.muted,
                  backgroundColor: chrome.namePanel,
                }}
                data-hero-zone-name
                data-hero-zone-lead={index === leadZone ? 'true' : undefined}
              >
                {zone.label}
              </span>
              {/* WHAT THE TEAM IS DOING, NOT WHAT IS WRONG WITH IT (W9,
                  operator: "remove the 'Needs you' inline labels, replace that
                  with 'N active' and show more activity"). Ten captions each
                  ending in "need you" read as ten warning labels, and the
                  impression a stranger should take from this board is a fleet
                  WORKING. Needs-you has not gone anywhere: it is the colour on
                  the marks, it is the whole subject of the attention panel,
                  and it is the one number in the frame's own chip. It is just
                  no longer the caption under every Project.

                  The count is LIVE and the text is written by `flush()` on
                  this node, because the scheduler keeps turning Agents while
                  the reader watches and a frozen number beside a changing
                  board is a small lie. */}
              <span
                className="flex items-center gap-1 text-chrome-micro font-normal"
                style={{ color: chrome.counts }}
                data-hero-zone-counts
              >
                {zone.agentCount} agents
                <span aria-hidden>·</span>
                <span
                  ref={node => {
                    if (node) activeNodes.current.set(index, node);
                    else activeNodes.current.delete(index);
                  }}
                  data-hero-zone-active
                >
                  {activeBaseline[index]} active
                </span>
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
                onClick={() => {
                  // A click only SELECTS a mark that is an individual. At the
                  // fold's crop a click on a seven-pixel dot would set a
                  // selection whose card cannot open, which is a control that
                  // silently does nothing. Hovering still works there; it just
                  // says the Project rather than the Agent.
                  const anchor = getBridge().units[index];
                  if (!anchor || anchor.radius < AGENT_TRACK_MIN_RADIUS_PX) {
                    return;
                  }
                  onSelect(selected === index ? -1 : index);
                }}
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
            {/* The breathing beacon is retired (operator, 2026-08-17: "This
                pulsing circle doesn't look right - kill it"). It rendered as
                a muddy disc over the marks. The anchor node stays so the
                measurement bridge is unchanged; it simply has no child. */}
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
