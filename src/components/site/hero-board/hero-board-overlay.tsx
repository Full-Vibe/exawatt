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
 *   what are the dots      -> point at one. Every mark, at every altitude, is
 *                             a hit target, and the card that opens names the
 *                             harness, the Agent, its Project, what it is
 *                             doing and its live status. The bottom-right
 *                             legend came off in W10 (operator: "i think we
 *                             don't need the legend at the bottom-right"): the
 *                             attention panel's copy and the card teach the
 *                             colours, and the legend was chrome over a board
 *                             that is meant to be the argument.
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
 * - Hit testing is DOM, not raycasting, and after W10 it is DELEGATED: ONE
 *   handler over the board frame resolves the nearest projected mark, which is
 *   O(1) DOM and one pass over 173 numbers per pointer event. That is what
 *   makes every mark hoverable at every altitude without 173 positioned nodes
 *   in the per-frame write pass; the per-frame cost went DOWN, from 36 rings
 *   to one. The units stay one InstancedMesh with `raycast` disabled.
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
  AGENT_HOVER_SLOP_PX,
  AGENT_KEYBOARD_LIMIT,
  AGENT_TRACK_INTERVAL_MS,
  type HeroBridgeAccess,
} from './hero-board-annotations';
import { HarnessMark, harnessMarkExists } from '@/components/site/harness-mark';

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
/** And its height, for the same reason: the harness row, the name, the
 *  Project, the contract line and the status, plus its own padding. */
const CARD_HEIGHT_PX = 132;

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
  const [keyboardStops, setKeyboardStops] = useState<number[]>([]);
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
  /** The ONE target ring, moved to whichever mark is being read. */
  const ringNode = useRef<HTMLDivElement>(null);
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
    // ONE RING, ON THE MARK THE READER IS ON (W10). It used to be one node per
    // tracked unit, positioned every frame whether or not anybody was pointing
    // at it, which cost 36 write passes a frame to draw affordances nobody had
    // asked for. Hit testing is delegated now, so the only ring that has to
    // exist is the one under the pointer, the keyboard focus, or the panel's
    // own subject. Thirty-six per-frame node writes became one.
    const ring = ringNode.current;
    if (ring) {
      const anchor =
        shownRef.current >= 0 ? bridge.units[shownRef.current] : undefined;
      if (anchor?.onScreen) {
        const size = Math.max(22, Math.round(anchor.radius * 2 + 10));
        ring.style.width = `${size}px`;
        ring.style.height = `${size}px`;
        ring.style.transform = `translate3d(${Math.round(anchor.x)}px, ${Math.round(
          anchor.y
        )}px, 0) translate(-50%, -50%)`;
        ring.style.opacity = '1';
      } else {
        ring.style.opacity = '0';
      }
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
      // THE CARD OPENS ON EVERY MARK (W10, operator: "When you hover and click
      // on one, I want it to pop up and indicate what it's doing"). W9 gated
      // it on the mark's projected radius, so at the fold's crop and at the
      // attention beat a hover said only which Project the dot belonged to.
      // A seven-pixel dot is small; the Agent behind it is not, and the card
      // is next to the mark rather than inside it.
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
  /* pointer: ONE delegated handler, every mark, at every altitude   */
  /* -------------------------------------------------------------- */

  /**
   * Resolve the mark under a point, or -1 (ENG-031 W10).
   *
   * One pass over the projected centres, nearest wins, and the winner has to
   * be inside its own radius plus a little slop. That is O(n) arithmetic over
   * 173 numbers per pointer event and zero DOM, which is why every mark can be
   * a target at every altitude: the alternative, a positioned node per mark,
   * is O(n) DOM in the per-frame write pass, and it is what capped this at 36.
   */
  const markAt = useCallback(
    (x: number, y: number): number => {
      const bridge = getBridge();
      let best = -1;
      let bestDistance = Infinity;
      for (let index = 0; index < bridge.units.length; index += 1) {
        const anchor = bridge.units[index]!;
        if (!anchor.onScreen) continue;
        const distance = Math.hypot(anchor.x - x, anchor.y - y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = index;
        }
      }
      if (best < 0) return -1;
      const reach = Math.max(bridge.markRadius, 6) + AGENT_HOVER_SLOP_PX;
      return bestDistance <= reach ? best : -1;
    },
    [getBridge]
  );

  const framePoint = useCallback(
    (
      event:
        | React.PointerEvent<HTMLDivElement>
        | React.MouseEvent<HTMLDivElement>
    ) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    []
  );

  const handleHitPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      // A finger on the board is the reader scrolling the page, so touch never
      // hovers. It still taps, below.
      if (event.pointerType === 'touch') return;
      const point = framePoint(event);
      const index = markAt(point.x, point.y);
      // SEMANTIC IDENTITY ONLY (guide rule 14). This runs at pointer
      // frequency and sets state only when the ANSWER changes, which is a few
      // times a second at most.
      setHovered(current => (current === index ? current : index));
    },
    [framePoint, markAt]
  );

  const handleHitPointerLeave = useCallback(() => setHovered(-1), []);

  const handleHitClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const point = framePoint(event);
      const index = markAt(point.x, point.y);
      // CLICK PINS, CLICK AWAY RELEASES. A click that lands on no mark is the
      // reader dismissing the card, which is the other half of the operator's
      // "Escape or click-away releases".
      if (index < 0) {
        if (selectedRef.current >= 0) onSelect(-1);
        return;
      }
      setHovered(index);
      onSelect(selectedRef.current === index ? -1 : index);
    },
    [framePoint, markAt, onSelect]
  );

  /* -------------------------------------------------------------- */
  /* keyboard stops: a bounded sample, re-chosen at 6Hz              */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const bridge = getBridge();
    if (!projected) {
      setKeyboardStops([]);
      return;
    }
    const pick = () => {
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
      const next = candidates.slice(0, AGENT_KEYBOARD_LIMIT).map(c => c.index);
      // Keep whatever the visitor is currently reading, even if it drifted out
      // of the nearest set: a focused button must not be removed under the
      // caret, and a pinned card must not lose its stop.
      for (const keep of [selectedRef.current, focus.current]) {
        if (keep >= 0 && !next.includes(keep)) next.push(keep);
      }
      next.sort((a, b) => a - b);
      setKeyboardStops(previous =>
        previous.length === next.length &&
        previous.every((value, at) => value === next[at])
          ? previous
          : next
      );
    };
    pick();
    const timer = globalThis.setInterval(pick, AGENT_TRACK_INTERVAL_MS);
    return () => globalThis.clearInterval(timer);
  }, [getBridge, projected]);

  /* -------------------------------------------------------------- */
  /* the projector measures an exact radius for ONE mark             */
  /* -------------------------------------------------------------- */

  useEffect(() => {
    const bridge = getBridge();
    // The ring's size and the card's offset are the only things that need a
    // mark's exact projected radius, and they only ever need it for the mark
    // being read. Everything else is a centre.
    bridge.tracked = shown >= 0 ? [shown] : [];
  }, [getBridge, shown]);

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
  const unitSource =
    unit !== undefined ? capture.sources[unit.source] : undefined;
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

          {/* THE HIT LAYER (ENG-031 W10, operator: "It looks like not all
              the agents are hoverable and clickable"). One element, covering
              the board, resolving the nearest projected mark on every pointer
              event. Every one of the 173 marks answers a mouse at every
              altitude, and the per-frame write pass got SMALLER rather than
              larger, because the affordance that used to be 36 positioned
              nodes is now one ring on the mark being read.

              It sits first so every annotation paints over it, and it is the
              only element in this overlay that takes the pointer at all. */}
          <div
            className="absolute inset-0"
            style={{ pointerEvents: 'auto' }}
            onPointerMove={handleHitPointerMove}
            onPointerLeave={handleHitPointerLeave}
            onClick={handleHitClick}
            data-hero-hit-layer
          />

          {/* The target ring. One node, moved, never remounted. */}
          <div
            ref={ringNode}
            aria-hidden
            className="absolute top-0 left-0 rounded-full transition-opacity duration-150"
            style={{
              opacity: 0,
              willChange: 'transform',
              borderWidth: 2,
              borderStyle: 'solid',
              borderColor: unitStatus
                ? theme.status[unitStatus]
                : spatialColorWithAlpha(theme.label, 0.3),
              backgroundColor: unitStatus
                ? spatialColorWithAlpha(theme.status[unitStatus], 0.14)
                : 'transparent',
              boxShadow: unitStatus
                ? `0 0 0 4px ${spatialColorWithAlpha(theme.status[unitStatus], 0.14)}`
                : 'none',
            }}
            data-hero-unit-ring={shown >= 0 ? String(shown) : undefined}
          />

          {/* KEYBOARD REACH. A bounded sample of the same marks, as real
              buttons carrying the same accessible sentence they have carried
              since W2. They are visually hidden because the RING is the visual
              affordance now, and a focused stop opens the same card a hover
              does. See `AGENT_KEYBOARD_LIMIT` for why the tab order is bounded
              while the pointer's reach is not. */}
          <ul className="sr-only" data-hero-unit-stops>
            {keyboardStops.map(index => {
              const target = capture.units[index];
              if (!target) return null;
              const state = statusOf(
                capture,
                bridge.statuses[index] ?? target.status
              );
              return (
                <li key={index}>
                  <button
                    type="button"
                    style={{ pointerEvents: 'auto' }}
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
                    data-hero-unit-shown={index === shown ? 'true' : undefined}
                  >
                    {target.name}. {capture.zones[target.zone]?.label}.{' '}
                    {target.doing}. {STATUS_LIGHT_META[state].label}.
                  </button>
                </li>
              );
            })}
          </ul>

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
                {/* THE HARNESS, AS ITS OWN MARK (ENG-031 W10, operator: "I
                    want it to show a recognizable harness logo"). It is the
                    first thing on the card because it is the thing a stranger
                    recognises before they have read a word: the fleet is
                    running agents from more than one lab, and the proof is
                    that this Agent's card carries that lab's mark. Read off
                    `capture.sources[unit.source]`, which comes from
                    `contracts/agent-sources.json` by way of the launcher's
                    own declarations, so the mark, the label and the lens
                    colour are one answer. */}
                {unitSource ? (
                  <p
                    className="flex items-center gap-1.5"
                    data-hero-unit-harness={unitSource.adapterId}
                  >
                    {harnessMarkExists(unitSource.adapterId) ? (
                      <span
                        aria-hidden
                        className="inline-flex shrink-0 items-center justify-center"
                        // ONE NEUTRAL INK for every harness. Anthropic, OpenAI
                        // and xAI each forbid recolouring their mark, and each
                        // supplies a white rendition for a dark ground, which
                        // is what this is. The SOURCE colour is already on
                        // screen: it is what the marks are painted in under
                        // the `source` lens. See
                        // `LICENSES/brand/harness-marks.md`.
                        style={{ color: chrome.label }}
                      >
                        <HarnessMark
                          adapterId={unitSource.adapterId}
                          size={16}
                        />
                      </span>
                    ) : null}
                    <span
                      className="text-chrome-micro tracking-wide"
                      style={{ color: chrome.muted }}
                    >
                      {unitSource.label}
                    </span>
                  </p>
                ) : null}
                <p
                  className="mt-1 text-chrome-title font-semibold"
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
