'use client';

/**
 * The marketing hero board (ENG-031 W2).
 *
 * One frozen capture of the Demo Workspace, rendered as three draw calls. Read
 * `docs/engineering/r3f-authoring-guide.md` before editing.
 *
 * ONE behaviour (operator, 2026-08-17): planted at rest, and the page scroll
 * drives the altitude pull from Fleet to Team to Agent. The ambient orbit was
 * deleted, not demoted — it destroyed the readable layout that is the whole
 * claim. All text and all interactivity live in the DOM overlay next door;
 * this file projects the anchors it needs into `HeroAnnotationBridge`.
 *
 * The budget this file exists to hold (`projects/website-overhaul.md` → "The
 * hero board" → "Measured budget"):
 *
 * - `antialias: false`, compensated in shader — every mark is an analytic SDF
 *   antialiased with `fwidth`, which is sharper than MSAA on thin strokes and
 *   costs nothing on the framebuffer.
 * - DPR capped at 1.5, the production median across GitHub, Vercel, Modal,
 *   Warp and Lusion.
 * - One `InstancedMesh` for all units, one for all zones, one ground plane.
 *   Per-instance status colour is an `InstancedBufferAttribute` animated from a
 *   single `uTime` uniform: no per-frame JavaScript touches the 173 units.
 *   The status scheduler writes a handful of floats a second, on state change
 *   only.
 * - `frameloop="demand"`. Every animating `useFrame` calls `invalidate()` while
 *   it animates and stops when it settles, so a parked board renders zero
 *   frames. The owner passes `animating={false}` when the hero leaves the
 *   viewport or the tab is hidden, and the loop stops there too.
 * - No postprocessing. Bloom is the heaviest import in the stack and the board
 *   is complete without it.
 *
 * Interaction: every camera-controls binding is `ACTION.NONE`. The hero can
 * never eat a page scroll and can never be dragged out of its framing; the
 * only input that moves this camera is the page's own scroll position.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  statusLightStateForAgentStatus,
} from '@/components/status-light/protocol';
import type { HeroBoardCapture } from './capture-types';
import { HERO_STATUS_ORDER } from './capture-types';
import { IDLE_BUDGET, STATUS_CHANGES_PER_SECOND } from './hero-board-budget';
import type { HeroAnchor, HeroBridgeAccess } from './hero-board-annotations';
import {
  HERO_DIM,
  HERO_ZONE_DIM,
  heroStatusNeedsHuman,
  type HeroHighlight,
} from './hero-board-highlight';
import type { HeroLens } from './hero-board-lens';
import { heroBoardSubjects } from './hero-board-subjects';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Decorative geometry never costs a raycast. A function, never null: drei and
 *  the strict R3F types both type `raycast` as a function. */
const noopRaycast = () => null;

/** The planted three-quarter view. The board rests here and returns here. */
const BASE_AZIMUTH = -12 * DEG;
const BASE_POLAR = 40 * DEG;

/** How tightly each altitude frames its bounding sphere. Below 1 crops in.
 *  Fleet opened out from 0.66 once the Projects were named (2026-08-17): a
 *  crop that carries scale is worth having, a crop that cuts two Project
 *  labels off the bottom edge is not. */
const FRAMING_TIGHTNESS = {
  fleet: 0.74,
  team: 0.86,
  agent: 0.95,
  /** The fold's crop, as a share of the fleet's own bounding sphere. Tuned so
   *  three to four Project clusters fill a 58%-width column and a single mark
   *  is still an individual rather than a pixel. */
  clusterRadius: 0.5,
} as const;

/**
 * How much harder a PORTRAIT viewport crops (ENG-031 W5, operator: the phone
 * is a demo surface, not a fallback).
 *
 * Fitting a wide board into a tall frame is the wrong instinct: it satisfies
 * the geometry and produces a postage stamp with two thirds of the screen
 * empty, which is exactly the "just a pile of icons" failure at a smaller
 * size. The brief already states the correct rule for conveying scale, and it
 * is the opposite one: density and crop carry scale, and Palantir's board
 * bleeds past all four edges of its frame. So on a phone the board fills the
 * width and runs off the top and bottom, and the marks stay the size a thumb
 * can actually resolve.
 *
 * KEYED ON A NARROW FRAME, NOT ON `height > width` (ENG-031 W6c). The phone's
 * board is a fixed card of `44svh + 2rem`, which at 390x844 is 403px tall: it
 * cleared the portrait test by thirteen pixels, and on a shorter phone, in
 * landscape, or after any change to the card's height it would have failed it
 * and silently served the desktop framing to a 390px frame. The condition the
 * crop is actually about is that the frame is NARROW relative to the board's
 * own spread, so that is what it now tests, with the aspect test kept for a
 * genuinely tall frame at any width.
 */
const PORTRAIT_CROP = 0.62;

/** A frame this narrow gets the phone's crop whatever its aspect. Matches the
 *  overlay's own `COMPACT_FRAME_PX`, which decides how many Projects a frame
 *  that size can name. */
const NARROW_FRAME_PX = 560;

const MARK_SCALE = 1.7;
const STATUS_TRANSITION_SECONDS = 0.85;

/**
 * The delegated-child quad, as a multiple of the child's own mark size
 * (ENG-031 W5).
 *
 * The lineage tether and the child mark are drawn in ONE quad and therefore in
 * one draw call. That is not a micro-optimisation: the board's whole claim is
 * that a readable operations picture costs three draw calls, and a separate
 * `LineSegments` for the tethers would have made it five. Measured against the
 * capture, every tether's parent-side endpoint already falls inside the
 * child's own mark footprint, so this multiple is headroom rather than a fit.
 */
const DELEGATION_QUAD = 2.4;

/** How long the constellations take to bloom out of their parents. Finite and
 *  damped, arriving at rest (ENG-023 D3c spawn transitions, guide rule 4b). */
const DELEGATION_BLOOM_SECONDS = 0.9;

/** The share of the bloom spent staggering. A simultaneous pop of 23 marks
 *  reads as a glitch; a short per-instance offset reads as a fan-out. */
const DELEGATION_STAGGER = 0.35;

/**
 * How long the board takes to move its emphasis from one panel's subject to
 * the next (ENG-031 W4).
 *
 * This is a SEMANTIC transition, not a follow, so it gets one duration and one
 * ease that leaves and arrives at rest, and every layer samples the same
 * progress (guide rule 4b): the zone fills, the unit marks, and the DOM labels
 * all run 0 to 1 over this many seconds from the same event. `damp` would be
 * wrong here twice over, because it starts at maximum velocity and because two
 * layers at two lambdas would arrive at different times.
 */
const FOCUS_TRANSITION_SECONDS = 0.7;

/**
 * The maximum zoom depth (operator, 2026-08-17: "Bind the scroll to a maximum
 * zoom depth. Right now it gets a little bit too close.").
 *
 * Stated as what it protects rather than as a number of world units: ONE Agent
 * mark never grows past this share of the frame height. Past roughly a tenth
 * of the frame a mark stops being an agent inside a fleet and becomes a crop
 * of a circle, its neighbours leave the frame, and the closest altitude reads
 * as a zoom bug rather than as an altitude. The distance is DERIVED from it
 * with the live fov, so the cap holds at every viewport instead of being a
 * magic number tuned against one.
 *
 * The interpolation itself is unchanged and stays in log space (guide rule
 * 4c): this moves the closest keyframe, it does not change how the journey to
 * it is travelled.
 */
const MAX_MARK_FRAME_SHARE = 0.1;

/** The closest the camera may sit, from the frame-share cap above. */
function maxZoomDistance(camera: THREE.Camera, markWorldSize: number): number {
  const perspective = camera as THREE.PerspectiveCamera;
  if (!perspective.isPerspectiveCamera) return 0;
  const halfFov = THREE.MathUtils.degToRad(perspective.fov) / 2;
  const span = 2 * Math.tan(halfFov) * MAX_MARK_FRAME_SHARE;
  return span > 0 ? markWorldSize / span : 0;
}

/** Plausible next states, so the board's status mix stays stationary and every
 *  change is one the product's own protocol can produce. Indices are
 *  `HERO_STATUS_ORDER`: blocked, error, reviewing, working, idle, complete. */
const STATUS_TRANSITIONS: readonly number[][] = [
  [3, 3, 2], // blocked  -> working / reviewing (the human answered)
  [3, 3, 4], // error    -> working / idle (retried or parked)
  [5, 3, 0], // reviewing-> complete / working / blocked
  [2, 5, 0, 1], // working -> reviewing / complete / blocked / error
  [3, 3, 5], // idle     -> working / complete
  [4, 3], // complete -> idle / working
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Board-model coordinates centred on the origin and laid into world XZ, so
 *  camera-controls' Y-up spherical maths applies without any hand-derived
 *  rotation of our own. */
function boardCenter(capture: HeroBoardCapture) {
  return {
    x: capture.bounds.x + capture.bounds.width / 2,
    y: capture.bounds.y + capture.bounds.height / 2,
  };
}

export interface HeroBoardFraming {
  center: THREE.Vector3;
  radius: number;
  tightness: number;
  /**
   * How this altitude answers a NARROW frame (ENG-031 W6c).
   *
   * The phone crops rather than fits, but `cluster` is ALREADY the fleet
   * framing cropped, and multiplying the two put the fold's own Project half
   * outside a 390px frame with its name faded out beside it. A board whose
   * circles carry no names is the "pile of rotating icons" verdict returning
   * at a smaller size, so the altitude that exists to be a crop opts out of
   * the second one and says so here rather than in a branch at the call site.
   */
  narrowCrop: number;
}

/**
 * The altitudes the board can hold. Spelled locally rather than imported from
 * the band manifest so the scene never depends on the site.
 *
 * `cluster` is the FLEET framing cropped, on the same centre (ENG-031 W6b). It
 * is not a product altitude and it does not pretend to be one: it exists so
 * the fold can open on a board whose individual marks are legible inside a
 * column that is 58% of the viewport, and so the first scroll move is the crop
 * opening out to the whole fleet, which is the scale claim made as a camera
 * move instead of as a screen of type.
 */
export type HeroAltitude = 'fleet' | 'cluster' | 'team' | 'agent';

/**
 * The default ladder: Fleet, one real Project, one Agent inside it that needs
 * a human.
 *
 * The PAGE overrides it (ENG-031 W5). The pinned run declares its own ordered
 * altitudes in `manifest.ts`, and two properties of that ladder are invisible
 * unless the camera is derived from it rather than hardcoded here: two
 * consecutive panels may share an altitude, which makes the camera hold while
 * the board itself makes the argument, and the ladder is NOT monotonic,
 * because the last panel opens back out.
 */
export const HERO_DEFAULT_LADDER: HeroAltitude[] = ['fleet', 'team', 'agent'];

export function heroBoardFramings(
  capture: HeroBoardCapture,
  ladder: readonly HeroAltitude[] = HERO_DEFAULT_LADDER,
  /**
   * A phone-width frame. It changes exactly one thing: what `cluster` is
   * centred on (ENG-031 W6c).
   *
   * On a wide frame `cluster` is the fleet framing cropped on the fleet's own
   * centre, and whichever Projects happen to fall in the column are the ones
   * the fold shows. In a 390px frame that lottery put the ONE Project the fold
   * emphasizes into the top-left corner, half outside the frame, so its name
   * faded out and the phone's first screen was a board with nothing named on
   * it. The fold's crop is now centred on the Project the fold is actually
   * pointing at, which is the same subject `hero-board-subjects.ts` gives the
   * highlight and the copy, so the phone opens on a named, centred Project and
   * the first scroll move is still the crop opening out to the whole fleet.
   */
  narrow = false
): HeroBoardFraming[] {
  const center = boardCenter(capture);
  const fleet = new THREE.Vector3(0, 0, 0);
  const fleetRadius =
    Math.hypot(capture.bounds.width, capture.bounds.height) / 2;

  // The Project and the Agent the camera flies to are the SAME two the panels
  // name and the highlight emphasizes, so the copy and the camera cannot
  // disagree. One decision, in `hero-board-subjects.ts`.
  const subjects = heroBoardSubjects(capture);
  const zone = capture.zones[subjects.teamZone]!;
  const team = new THREE.Vector3(zone.x - center.x, 0, zone.y - center.y);

  const agentUnit = capture.units[subjects.agentUnit]!;
  const agent = new THREE.Vector3(
    agentUnit.x - center.x,
    0,
    agentUnit.y - center.y
  );

  const byAltitude: Record<HeroAltitude, HeroBoardFraming> = {
    fleet: {
      center: fleet,
      radius: fleetRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: PORTRAIT_CROP,
    },
    cluster: {
      center: narrow ? team : fleet,
      radius: fleetRadius * FRAMING_TIGHTNESS.clusterRadius,
      tightness: FRAMING_TIGHTNESS.fleet,
      narrowCrop: 1,
    },
    team: {
      center: team,
      radius: zone.radius * 1.5,
      tightness: FRAMING_TIGHTNESS.team,
      narrowCrop: PORTRAIT_CROP,
    },
    agent: {
      center: agent,
      radius: 4.4,
      tightness: FRAMING_TIGHTNESS.agent,
      narrowCrop: PORTRAIT_CROP,
    },
  };

  const resolved = (ladder.length > 1 ? ladder : HERO_DEFAULT_LADDER).map(
    altitude => byAltitude[altitude]
  );
  // Vectors are shared between repeated altitudes on purpose: the rig reads
  // each framing into its own keyframe and never mutates the framing.
  return resolved;
}

/* ------------------------------------------------------------------ */
/* ground                                                              */
/* ------------------------------------------------------------------ */

function HeroGround({
  theme,
  capture,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
}) {
  const geometry = useMemo(() => {
    const span = Math.max(capture.bounds.width, capture.bounds.height) * 3;
    const next = new THREE.PlaneGeometry(span, span);
    next.rotateX(-Math.PI / 2);
    return next;
  }, [capture]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uCanvas: { value: new THREE.Color(theme.canvas) },
      uGrid: { value: new THREE.Color(theme.grid) },
      uFade: {
        value: Math.hypot(capture.bounds.width, capture.bounds.height) * 0.42,
      },
    }),
    [theme, capture]
  );

  return (
    <mesh geometry={geometry} raycast={noopRaycast} renderOrder={0}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vWorld;
          void main() {
            vWorld = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uCanvas;
          uniform vec3 uGrid;
          uniform float uFade;
          varying vec3 vWorld;
          void main() {
            // Analytic grid: the derivative width keeps the line one pixel wide
            // at every distance, which is what antialias:false costs us and the
            // shader has to pay back.
            vec2 cell = vWorld.xz / 4.0;
            vec2 g = abs(fract(cell - 0.5) - 0.5) / fwidth(cell);
            float line = 1.0 - min(min(g.x, g.y), 1.0);
            float falloff = 1.0 - smoothstep(0.35, 1.0, length(vWorld.xz) / uFade);
            gl_FragColor = vec4(mix(uCanvas, uGrid, line * 0.42 * falloff), 1.0);
            #include <colorspace_fragment>
          }
        `}
      />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* project zones                                                       */
/* ------------------------------------------------------------------ */

function HeroZones({
  theme,
  capture,
  highlight,
  animating,
  getBridge,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  highlight: HeroHighlight;
  animating: boolean;
  getBridge: HeroBridgeAccess;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const center = useMemo(() => boardCenter(capture), [capture]);
  const count = capture.zones.length;

  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.rotateX(-Math.PI / 2);
    next.setAttribute(
      'aFocus',
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    );
    return next;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uZone: { value: new THREE.Color(theme.zone) },
      uRim: { value: new THREE.Color(theme.grid) },
      uDim: { value: HERO_ZONE_DIM },
    }),
    [theme]
  );

  useEffect(() => {
    if (!mesh.current) return;
    const scratch = new THREE.Object3D();
    capture.zones.forEach((zone, index) => {
      scratch.position.set(zone.x - center.x, 0.012, zone.y - center.y);
      scratch.scale.setScalar(zone.radius * 2);
      scratch.updateMatrix();
      mesh.current!.setMatrixAt(index, scratch.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [capture, center]);

  // Ten instances, so the emphasis transition is eased in JS and written into
  // one attribute. No allocation per frame, and the loop parks the moment it
  // arrives; the units next door stay on the GPU because there are 173 of them
  // and the brief forbids per-frame JavaScript over the field.
  const from = useRef(new Float32Array(count).fill(1));
  const to = useRef(new Float32Array(count).fill(1));
  const elapsed = useRef(FOCUS_TRANSITION_SECONDS);

  useEffect(() => {
    const attribute = geometry.getAttribute(
      'aFocus'
    ) as THREE.InstancedBufferAttribute;
    for (let index = 0; index < count; index += 1) {
      from.current[index] = attribute.getX(index);
      to.current[index] = highlight.zones[index] ?? 1;
    }
    elapsed.current = 0;
  }, [geometry, highlight, count]);

  useFrame((state: RootState, delta: number) => {
    if (!animating || elapsed.current >= FOCUS_TRANSITION_SECONDS) return;
    elapsed.current = Math.min(
      FOCUS_TRANSITION_SECONDS,
      elapsed.current + Math.min(delta, 0.05)
    );
    const t = elapsed.current / FOCUS_TRANSITION_SECONDS;
    const eased = t * t * (3 - 2 * t);
    const attribute = geometry.getAttribute(
      'aFocus'
    ) as THREE.InstancedBufferAttribute;
    const bridge = getBridge();
    for (let index = 0; index < count; index += 1) {
      const value =
        from.current[index]! +
        (to.current[index]! - from.current[index]!) * eased;
      attribute.setX(index, value);
      // The DOM labels recede on the same curve, read per frame by the overlay.
      bridge.zoneFocus[index] = value;
    }
    attribute.needsUpdate = true;
    state.invalidate();
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={1}
    >
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={`
          attribute float aFocus;
          varying vec2 vUv;
          varying float vFocus;
          void main() {
            vUv = uv - 0.5;
            vFocus = aFocus;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uZone;
          uniform vec3 uRim;
          uniform float uDim;
          varying vec2 vUv;
          varying float vFocus;
          void main() {
            float d = length(vUv) * 2.0;
            float w = fwidth(d);
            float disc = 1.0 - smoothstep(1.0 - w, 1.0 + w, d);
            float rim = 1.0 - smoothstep(0.0, w * 1.6, abs(d - 1.0 + w));
            vec3 color = mix(uZone, uRim, rim * 0.85);
            float alpha = max(disc * 0.92, rim * 0.9) * mix(uDim, 1.0, vFocus);
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(color, alpha);
            #include <colorspace_fragment>
          }
        `}
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* agent units                                                         */
/* ------------------------------------------------------------------ */

/** The D40 five-signal marks, by `HERO_STATUS_ORDER` index. 0 off, 1 active,
 *  2 result, 3 needs you, 4 fault — the same mapping the production board's
 *  population field uses. */
const MARK_BY_STATUS = [3, 4, 1, 1, 0, 2] as const;

/**
 * The mark every unit takes while a non-status LENS is on (ENG-031 W8).
 *
 * Mark SHAPE is a second status channel: a blocked agent is a different glyph
 * from an idle one, which is what keeps the board readable without colour.
 * Under a burn or source lens the colour no longer means status, so leaving
 * the shape meaning status would put two different claims on one mark. Every
 * unit takes the plain mark and the lens owns the reading.
 */
const LENS_MARK = 0;

function HeroUnits({
  theme,
  capture,
  animating,
  statusProtocolMotion,
  statusChanges,
  highlight,
  lens,
  getBridge,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  animating: boolean;
  statusProtocolMotion: boolean;
  statusChanges: boolean;
  highlight: HeroHighlight;
  lens: HeroLens;
  getBridge: HeroBridgeAccess;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const center = useMemo(() => boardCenter(capture), [capture]);
  const count = capture.units.length;

  // Live status per instance is mirrored in JS so a change reads its own
  // predecessor without a GPU read-back. It lives on the annotation bridge
  // because the hover card has to read the CURRENT status, not the captured
  // one: an agent whose state changes while you are looking at it is the point
  // of the board.

  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.rotateX(-Math.PI / 2);
    next.setAttribute(
      'aMarkFrom',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    next.setAttribute(
      'aMarkTo',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    next.setAttribute(
      'aStatusFrom',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    next.setAttribute(
      'aStatusTo',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    next.setAttribute(
      'aChangeAt',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    // Highlight emphasis rides its own per-instance transition clock rather
    // than a single uniform, because two things retrigger it: a panel change
    // moves every unit at once, and a status turn moves ONE unit whenever the
    // active highlight is derived from live status. A shared uniform would
    // restart all 173 for one agent's change.
    next.setAttribute(
      'aFocusFrom',
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    );
    next.setAttribute(
      'aFocusTo',
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1)
    );
    next.setAttribute(
      'aFocusAt',
      new THREE.InstancedBufferAttribute(new Float32Array(count).fill(-1000), 1)
    );
    return next;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // The palette, as plain strings, so the uniform effect and the mount memo
  // read exactly one source.
  const lensColors = lens.colors;
  const uniforms = useMemo(() => {
    // Seeded from the lens the board mounts with. A lens change after mount
    // writes into this same array rather than rebuilding the material, so the
    // whole mechanism costs one uniform write and never a recompile.
    const colors = lensColors.map(color => new THREE.Color(color));
    return {
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uTransition: { value: STATUS_TRANSITION_SECONDS },
      uFocusTransition: { value: FOCUS_TRANSITION_SECONDS },
      uDim: { value: HERO_DIM },
      uStatusColor: { value: colors },
    };
    // Mount-time seed only. `lensColors` is deliberately not a dependency:
    // rebuilding the uniform object would rebuild the material, and the effect
    // below writes the palette in place instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Seed instance matrices and the per-instance status attributes once.
  useEffect(() => {
    if (!mesh.current) return;
    const scratch = new THREE.Object3D();
    const markFrom = geometry.getAttribute(
      'aMarkFrom'
    ) as THREE.InstancedBufferAttribute;
    const markTo = geometry.getAttribute(
      'aMarkTo'
    ) as THREE.InstancedBufferAttribute;
    const statusFrom = geometry.getAttribute(
      'aStatusFrom'
    ) as THREE.InstancedBufferAttribute;
    const statusTo = geometry.getAttribute(
      'aStatusTo'
    ) as THREE.InstancedBufferAttribute;
    const changeAt = geometry.getAttribute(
      'aChangeAt'
    ) as THREE.InstancedBufferAttribute;
    const statuses = getBridge().statuses;
    capture.units.forEach((unit, index) => {
      statuses[index] = unit.status;
      scratch.position.set(unit.x - center.x, 0.03, unit.y - center.y);
      scratch.scale.setScalar(unit.size * MARK_SCALE);
      scratch.updateMatrix();
      mesh.current!.setMatrixAt(index, scratch.matrix);
      markFrom.setX(index, MARK_BY_STATUS[unit.status]!);
      markTo.setX(index, MARK_BY_STATUS[unit.status]!);
      statusFrom.setX(index, unit.status);
      statusTo.setX(index, unit.status);
      // Long settled: nothing flashes on arrival.
      changeAt.setX(index, -1000);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
  }, [capture, center, geometry, getBridge]);

  const elapsed = useRef(0);
  const pending = useRef(0);
  const random = useMemo(() => mulberry32(0x11ada7), []);
  const followsStatus = useRef(highlight.followsStatus);
  followsStatus.current = highlight.followsStatus;

  /** Emphasis this unit should be at, now, under the active highlight. */
  const focusTargetFor = useCallback(
    (index: number, status: number): number => {
      if (!followsStatus.current) return highlight.units[index] ?? 1;
      // Status-derived emphasis reads the LIVE status, not the captured one:
      // the scheduler turns agents while a visitor reads, and a highlight
      // frozen at capture time would keep a finished agent lit as waiting.
      return heroStatusNeedsHuman(status) ? 1 : 0;
    },
    [highlight]
  );

  /** Start one unit's emphasis transition from wherever it currently is. */
  const retargetFocus = useCallback(
    (index: number, target: number): void => {
      const focusFrom = geometry.getAttribute(
        'aFocusFrom'
      ) as THREE.InstancedBufferAttribute;
      const focusTo = geometry.getAttribute(
        'aFocusTo'
      ) as THREE.InstancedBufferAttribute;
      const focusAt = geometry.getAttribute(
        'aFocusAt'
      ) as THREE.InstancedBufferAttribute;
      const t = Math.min(
        1,
        Math.max(
          0,
          (elapsed.current - focusAt.getX(index)) / FOCUS_TRANSITION_SECONDS
        )
      );
      const eased = t * t * (3 - 2 * t);
      const current =
        focusFrom.getX(index) +
        (focusTo.getX(index) - focusFrom.getX(index)) * eased;
      focusFrom.setX(index, current);
      focusTo.setX(index, target);
      focusAt.setX(index, elapsed.current);
      focusFrom.needsUpdate = true;
      focusTo.needsUpdate = true;
      focusAt.needsUpdate = true;
      getBridge().unitFocus[index] = target;
    },
    [geometry, getBridge]
  );

  // A panel change moves every unit at once, on ONE clock, so every mark and
  // every label arrives together (guide rule 4b).
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    const statuses = getBridge().statuses;
    for (let index = 0; index < count; index += 1) {
      retargetFocus(
        index,
        focusTargetFor(index, statuses[index] ?? capture.units[index]!.status)
      );
    }
    invalidate();
  }, [
    capture,
    count,
    focusTargetFor,
    getBridge,
    invalidate,
    retargetFocus,
    highlight,
  ]);

  /**
   * THE LENS, applied (ENG-031 W8).
   *
   * A lens is a per-instance palette ordinal and a six-colour uniform, which
   * are exactly the two things status colour already was. So switching lens is
   * one uniform write and one pass over the ordinals: three draw calls
   * unchanged, no per-frame JavaScript, no material recompile, and the fleet
   * rides the SAME transition clock a status turn rides, so it crossfades into
   * its new meaning instead of cutting.
   *
   * Returning to the status lens hands the ordinals back to the LIVE statuses
   * on the bridge rather than to the captured ones, because the scheduler has
   * been turning agents the whole time the other lens was up.
   */
  const lensRef = useRef(lens);
  lensRef.current = lens;
  useEffect(() => {
    const material_ = material.current;
    if (!material_) return;
    const palette = material_.uniforms.uStatusColor!.value as THREE.Color[];
    lens.colors.forEach((color, index) => palette[index]?.set(color));

    const markFrom = geometry.getAttribute(
      'aMarkFrom'
    ) as THREE.InstancedBufferAttribute;
    const markTo = geometry.getAttribute(
      'aMarkTo'
    ) as THREE.InstancedBufferAttribute;
    const statusFrom = geometry.getAttribute(
      'aStatusFrom'
    ) as THREE.InstancedBufferAttribute;
    const statusTo = geometry.getAttribute(
      'aStatusTo'
    ) as THREE.InstancedBufferAttribute;
    const changeAt = geometry.getAttribute(
      'aChangeAt'
    ) as THREE.InstancedBufferAttribute;
    const statuses = getBridge().statuses;

    for (let index = 0; index < count; index += 1) {
      const status = statuses[index] ?? capture.units[index]!.status;
      const ordinal = lens.channel ? (lens.channel[index] ?? 0) : status;
      const mark = lens.channel ? LENS_MARK : MARK_BY_STATUS[status]!;
      markFrom.setX(index, markTo.getX(index));
      statusFrom.setX(index, statusTo.getX(index));
      markTo.setX(index, mark);
      statusTo.setX(index, ordinal);
      changeAt.setX(index, elapsed.current);
    }
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
    invalidate();
  }, [capture, count, geometry, getBridge, invalidate, lens]);

  function changeOneUnit(): void {
    const bridge = getBridge();
    const index = Math.floor(random() * count);
    const from = bridge.statuses[index]!;
    const options = STATUS_TRANSITIONS[from]!;
    const next = options[Math.floor(random() * options.length)]!;
    if (next === from) return;
    bridge.statuses[index] = next;
    // Under a non-status lens the colour and the mark mean something else, so
    // a turn must not repaint them. The TRUTH still moves: the bridge carries
    // the live status, so the hover card and the needs-you emphasis stay
    // correct, and returning to the status lens paints the fleet as it is now
    // rather than as it was when the lens came on.
    if (lensRef.current.channel !== null) {
      if (followsStatus.current) {
        retargetFocus(index, focusTargetFor(index, next));
      }
      bridge.onStatusChange?.(index);
      return;
    }
    const markFrom = geometry.getAttribute(
      'aMarkFrom'
    ) as THREE.InstancedBufferAttribute;
    const markTo = geometry.getAttribute(
      'aMarkTo'
    ) as THREE.InstancedBufferAttribute;
    const statusFrom = geometry.getAttribute(
      'aStatusFrom'
    ) as THREE.InstancedBufferAttribute;
    const statusTo = geometry.getAttribute(
      'aStatusTo'
    ) as THREE.InstancedBufferAttribute;
    const changeAt = geometry.getAttribute(
      'aChangeAt'
    ) as THREE.InstancedBufferAttribute;
    markFrom.setX(index, markTo.getX(index));
    statusFrom.setX(index, statusTo.getX(index));
    markTo.setX(index, MARK_BY_STATUS[next]!);
    statusTo.setX(index, next);
    changeAt.setX(index, elapsed.current);
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
    if (followsStatus.current) {
      // The emphasis rides the same turn the colour does, so an agent that
      // stops needing a human fades out of the highlight instead of popping.
      retargetFocus(index, focusTargetFor(index, next));
    }
    // The overlay only re-renders when the unit it is showing changed.
    bridge.onStatusChange?.(index);
  }

  useFrame((state: RootState, delta: number) => {
    if (!animating || !material.current) return;
    const step = Math.min(delta, 0.05);
    elapsed.current += step;
    material.current.uniforms.uTime!.value = elapsed.current;
    material.current.uniforms.uSpin!.value = statusProtocolMotion
      ? (-elapsed.current * TAU) / STATUS_LIGHT_ACTIVE_ROTATION_SECONDS
      : 0;

    if (statusChanges) {
      pending.current += step * STATUS_CHANGES_PER_SECOND;
      while (pending.current >= 1) {
        pending.current -= 1;
        changeOneUnit();
      }
    }
    state.invalidate();
  });

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={2}
    >
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={`
          attribute float aMarkFrom;
          attribute float aMarkTo;
          attribute float aStatusFrom;
          attribute float aStatusTo;
          attribute float aChangeAt;
          attribute float aFocusFrom;
          attribute float aFocusTo;
          attribute float aFocusAt;
          uniform float uTime;
          uniform float uTransition;
          uniform float uFocusTransition;
          uniform float uDim;
          uniform vec3 uStatusColor[6];
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;
          varying float vFocus;
          void main() {
            vUv = uv - 0.5;
            float t = clamp((uTime - aChangeAt) / uTransition, 0.0, 1.0);
            float eased = smoothstep(0.0, 1.0, t);
            vColor = mix(
              uStatusColor[int(aStatusFrom)],
              uStatusColor[int(aStatusTo)],
              eased
            );
            vMark = t < 0.5 ? aMarkFrom : aMarkTo;
            // A brightness envelope, not a scale: the mark's footprint is
            // constant, so a state change never nudges the board's geometry.
            vFlash = sin(t * 3.14159265) * (1.0 - step(0.999, t));
            // Highlight emphasis, on its own clock. A receded mark keeps uDim
            // of its alpha: the fleet is still there and still running, and a
            // board that empties itself to make a point makes a false one.
            float ft = clamp((uTime - aFocusAt) / uFocusTransition, 0.0, 1.0);
            float focus = mix(aFocusFrom, aFocusTo, smoothstep(0.0, 1.0, ft));
            vFocus = mix(uDim, 1.0, focus);
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uSpin;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;
          varying float vFocus;

          float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
            vec2 pa = p - a;
            vec2 ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            return length(pa - ba * h) - r;
          }

          void main() {
            vec2 p = vUv;
            float d = length(p);
            const float R = 0.30;
            const float T = 0.058;
            float ring = abs(d - R) - T;
            float sdf = 1.0;
            float weight = 1.0;

            if (vMark < 0.5) {
              // Idle: a quiet closed ring, and the only hollow circle in the
              // set. Nothing inside it, at any size.
              sdf = ring;
              weight = 0.62;
            } else if (vMark < 1.5) {
              // Working: an OPEN ARC whose gap travels once per rotation
              // period. The only mark that moves, in DOM and here alike.
              //
              // REDRAWN 2026-08-17 (W6b, operator: it "reads as an eyeball at
              // hero and mobile scale"). It was a ring with a rotating half
              // FILL, which is a pupil inside an iris the moment a mark is
              // bigger than a few pixels, and the fold is where the marks are
              // biggest. The centre is empty now and stays empty, so the
              // silhouette is a spinner at 80px and a ring at 4px, and neither
              // one is a face.
              float ang = atan(p.y, p.x) - uSpin;
              float wrapped = atan(sin(ang), cos(ang));
              // ~104 degrees of gap: enough to read as open at hero scale,
              // little enough that the mark keeps a circle's weight at fleet
              // scale, where colour is doing the work.
              sdf = max(ring, (0.91 - abs(wrapped)) * R);
            } else if (vMark < 2.5) {
              // Result: a check.
              sdf = min(
                sdSegment(p, vec2(-0.22, 0.0), vec2(-0.05, -0.17), T * 0.92),
                sdSegment(p, vec2(-0.05, -0.17), vec2(0.24, 0.19), T * 0.92)
              );
            } else if (vMark < 3.5) {
              // Needs you: a SOLID disc, and the only filled mark in the set.
              // It was a dot inside a ring, which is the same eye the working
              // mark was. Solid is also the right claim: the one state that
              // wants a person is the one state that is not hollow, and a
              // filled circle survives to two pixels where a concentric pair
              // turns to mush.
              sdf = d - (R + T * 0.35);
            } else {
              // Fault: a cross.
              sdf = min(
                sdSegment(p, vec2(-0.19, -0.19), vec2(0.19, 0.19), T * 0.92),
                sdSegment(p, vec2(-0.19, 0.19), vec2(0.19, -0.19), T * 0.92)
              );
            }

            // Analytic coverage: this is the shader paying back antialias:false.
            float coverage = 1.0 - smoothstep(-fwidth(sdf), fwidth(sdf), sdf);
            float alpha = coverage * weight * vFocus;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(vColor * (1.0 + vFlash * 0.45), alpha);
            #include <colorspace_fragment>
          }
        `}
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* delegated children                                                  */
/* ------------------------------------------------------------------ */

/**
 * The constellations (ENG-031 W5).
 *
 * The operator asked for "an explosion of a few sub-agents" as one of the
 * scroll phases, and it is the one motion beat on the page that is also a
 * product differentiator: delegation visibility is ENG-023, and the marks,
 * their rosette slots, their ratio to the parent, and their lineage tethers
 * are the board model's OWN output (`selectSpatialDelegationUnits`), carried
 * into the capture rather than authored here. Nothing on screen is a
 * choreography of something the product does not do.
 *
 * FOUR CONSTRAINTS, each answered in the shader rather than in JavaScript:
 *
 * - **One draw call.** Child mark and tether share one quad, so the whole beat
 *   costs one draw call and only while it is on screen. Below one percent of
 *   bloom the mesh is invisible and leaves the render list entirely, which is
 *   what keeps the resting board at the three calls its budget is written
 *   against.
 * - **No per-frame JavaScript over the field.** The bloom is one uniform. The
 *   outward travel is a vertex-shader offset along a per-instance vector, so
 *   23 children explode out of 16 parents without a matrix write.
 * - **Finite and damped, arriving at rest** (guide rule 4b). One clock, one
 *   duration, one ease that leaves and arrives at rest, with a short
 *   per-instance stagger so a fan-out reads as a fan-out.
 * - **No sixth status light** (ENG-023 boundary). A child mark is drawn in the
 *   board's label colour, deliberately outside the five-signal palette the
 *   legend names, because the capture carries a child's LINEAGE and not its
 *   state. Inventing a colour for a status we do not have would be exactly the
 *   overclaim the rest of this board is built to avoid.
 */
function HeroDelegations({
  theme,
  capture,
  highlight,
  animating,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  highlight: HeroHighlight;
  animating: boolean;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const center = useMemo(() => boardCenter(capture), [capture]);
  const count = capture.delegations.length;

  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.rotateX(-Math.PI / 2);
    for (const name of ['aParent', 'aTetherA', 'aTetherB']) {
      next.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2)
      );
    }
    next.setAttribute(
      'aDelay',
      new THREE.InstancedBufferAttribute(new Float32Array(count), 1)
    );
    return next;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uBloom: { value: 0 },
      uChild: { value: new THREE.Color(theme.label) },
      uQuad: { value: DELEGATION_QUAD },
      uStagger: { value: DELEGATION_STAGGER },
    }),
    [theme]
  );

  useEffect(() => {
    if (!mesh.current || count === 0) return;
    const scratch = new THREE.Object3D();
    const parent = geometry.getAttribute(
      'aParent'
    ) as THREE.InstancedBufferAttribute;
    const tetherA = geometry.getAttribute(
      'aTetherA'
    ) as THREE.InstancedBufferAttribute;
    const tetherB = geometry.getAttribute(
      'aTetherB'
    ) as THREE.InstancedBufferAttribute;
    const delay = geometry.getAttribute(
      'aDelay'
    ) as THREE.InstancedBufferAttribute;

    capture.delegations.forEach((child, index) => {
      // An overflow lobe stands for several Agents, so it is drawn larger than
      // one child. It is the exact census, never a decoration.
      const quad =
        child.size *
        MARK_SCALE *
        DELEGATION_QUAD *
        (child.overflow > 0 ? 1.3 : 1);
      scratch.position.set(child.x - center.x, 0.035, child.y - center.y);
      scratch.scale.set(quad, 1, quad);
      scratch.updateMatrix();
      mesh.current!.setMatrixAt(index, scratch.matrix);

      const owner = capture.units[child.parent];
      parent.setXY(
        index,
        (owner?.x ?? child.x) - child.x,
        (owner?.y ?? child.y) - child.y
      );
      // Tether endpoints in the quad's own normalized space, so the fragment
      // shader draws lineage without knowing anything about the board.
      tetherA.setXY(
        index,
        (child.tether.x2 - child.x) / quad,
        (child.tether.y2 - child.y) / quad
      );
      tetherB.setXY(
        index,
        (child.tether.x1 - child.x) / quad,
        (child.tether.y1 - child.y) / quad
      );
      delay.setX(index, count > 1 ? index / (count - 1) : 0);
    });

    mesh.current.instanceMatrix.needsUpdate = true;
    parent.needsUpdate = true;
    tetherA.needsUpdate = true;
    tetherB.needsUpdate = true;
    delay.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [capture, center, count, geometry]);

  const from = useRef(0);
  const to = useRef(0);
  const elapsed = useRef(DELEGATION_BLOOM_SECONDS);

  useEffect(() => {
    from.current = material.current?.uniforms.uBloom?.value ?? 0;
    to.current = highlight.delegation;
    elapsed.current = 0;
    // A mesh that is about to bloom has to be in the render list before the
    // first frame of the bloom, and one that has finished receding leaves it.
    if (mesh.current && to.current > 0) mesh.current.visible = true;
  }, [highlight]);

  useFrame((state: RootState, delta: number) => {
    if (!animating || !material.current) return;
    if (elapsed.current >= DELEGATION_BLOOM_SECONDS) return;
    elapsed.current = Math.min(
      DELEGATION_BLOOM_SECONDS,
      elapsed.current + Math.min(delta, 0.05)
    );
    const t = elapsed.current / DELEGATION_BLOOM_SECONDS;
    const eased = t * t * (3 - 2 * t);
    const value = from.current + (to.current - from.current) * eased;
    material.current.uniforms.uBloom!.value = value;
    if (mesh.current) mesh.current.visible = value > 0.01;
    state.invalidate();
  });

  if (count === 0) return null;

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, count]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={3}
      visible={false}
    >
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={`
          attribute vec2 aParent;
          attribute vec2 aTetherA;
          attribute vec2 aTetherB;
          attribute float aDelay;
          uniform float uBloom;
          uniform float uStagger;
          varying vec2 vUv;
          varying vec2 vTetherA;
          varying vec2 vTetherB;
          varying float vBloom;
          void main() {
            float span = max(1.0 - uStagger, 0.001);
            float b = clamp((uBloom - aDelay * uStagger) / span, 0.0, 1.0);
            float eased = b * b * (3.0 - 2.0 * b);
            vUv = uv - 0.5;
            vBloom = eased;
            vTetherA = aTetherA;
            // The tether draws outward as the child travels, so lineage grows
            // with the fan-out instead of appearing at full length.
            vTetherB = mix(aTetherA, aTetherB, eased);
            vec4 world = instanceMatrix * vec4(position, 1.0);
            // At zero bloom the child sits on its parent. The explosion is
            // this one line, and it costs no JavaScript.
            world.x += aParent.x * (1.0 - eased);
            world.z += aParent.y * (1.0 - eased);
            gl_Position = projectionMatrix * modelViewMatrix * world;
          }
        `}
        fragmentShader={`
          uniform vec3 uChild;
          uniform float uQuad;
          varying vec2 vUv;
          varying vec2 vTetherA;
          varying vec2 vTetherB;
          varying float vBloom;

          float sdSegment(vec2 p, vec2 a, vec2 b) {
            vec2 pa = p - a;
            vec2 ba = b - a;
            float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
            return length(pa - ba * h);
          }

          void main() {
            float radius = 0.27 / uQuad;
            float d = length(vUv) - radius;
            float w = fwidth(d);
            float mark = 1.0 - smoothstep(-w, w, d);

            float line = sdSegment(vUv, vTetherA, vTetherB) - 0.02 / uQuad;
            float lw = fwidth(line);
            float tether = 1.0 - smoothstep(-lw, lw, line);

            float alpha = max(mark * 0.95, tether * 0.6) * vBloom;
            if (alpha < 0.004) discard;
            gl_FragColor = vec4(uChild, alpha);
            #include <colorspace_fragment>
          }
        `}
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

interface Keyframe {
  target: THREE.Vector3;
  /** Camera distance to the target. Interpolated in LOG space (guide rule 4c):
   *  distance is a ratio, not a length, and the Fleet-to-Agent journey spans
   *  more than an order of magnitude, so a linear lerp would hide the first
   *  half of the pull and dump the rest in the last few hundred pixels. */
  distance: number;
}

function HeroCameraRig({
  capture,
  animating,
  progressRef,
  ladder,
  getBridge,
}: {
  capture: HeroBoardCapture;
  animating: boolean;
  progressRef: RefObject<number>;
  ladder: readonly HeroAltitude[];
  getBridge: HeroBridgeAccess;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  const invalidate = useThree(state => state.invalidate);
  const narrowFrame = size.width > 0 && size.width < NARROW_FRAME_PX;
  const framings = useMemo(
    () => heroBoardFramings(capture, ladder, narrowFrame),
    [capture, ladder, narrowFrame]
  );
  const keyframes = useRef<Keyframe[]>(
    framings.map(() => ({ target: new THREE.Vector3(), distance: 1 }))
  );
  const scratchTarget = useRef(new THREE.Vector3());
  const progress = useRef(0);
  const ready = useRef(false);

  /** World anchors, hoisted: nothing allocates inside the frame loop. */
  const anchors = useMemo(() => {
    const center = boardCenter(capture);
    return {
      zones: capture.zones.map(
        zone => new THREE.Vector3(zone.x - center.x, 0.02, zone.y - center.y)
      ),
      zoneRadius: capture.zones.map(zone => zone.radius),
      units: capture.units.map(
        unit => new THREE.Vector3(unit.x - center.x, 0.03, unit.y - center.y)
      ),
      unitRadius: capture.units.map(unit => (unit.size * MARK_SCALE) / 2),
    };
  }, [capture]);
  const projected = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());

  // Input policy. EVERY binding is NONE: a hero that eats page scroll is
  // scroll-jacking (the research found zero of it across all 16 sites), and a
  // hero that can be dragged loses the readable layout that is the claim.
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    const { ACTION } = CameraControlsImpl;
    rig.mouseButtons.left = ACTION.NONE;
    rig.mouseButtons.middle = ACTION.NONE;
    rig.mouseButtons.right = ACTION.NONE;
    rig.mouseButtons.wheel = ACTION.NONE;
    rig.touches.one = ACTION.NONE;
    rig.touches.two = ACTION.NONE;
    rig.touches.three = ACTION.NONE;
    rig.smoothTime = 0.4;
    rig.minPolarAngle = 24 * DEG;
    rig.maxPolarAngle = 74 * DEG;
    // Raised to the zoom cap by the framings effect, which needs the live fov.
    rig.minDistance = 4;
    rig.maxDistance = 4000;
  }, []);

  const applyProgress = useCallback((value: number): void => {
    const rig = controls.current;
    if (!rig) return;
    const clamped = THREE.MathUtils.clamp(value, 0, 1);
    // N keyframes, evenly spaced in progress (ENG-031 W5). The two-keyframe
    // special case this replaced could not express a ladder that holds an
    // altitude across two panels or reverses at the end, and both are now
    // properties of the page's own band list.
    const spans = Math.max(1, keyframes.current.length - 1);
    const scaled = clamped * spans;
    const segment = Math.min(spans - 1, Math.floor(scaled));
    const local = scaled - segment;
    const eased = local * local * (3 - 2 * local);
    const a = keyframes.current[segment]!;
    const b = keyframes.current[segment + 1]!;
    const target = scratchTarget.current.lerpVectors(a.target, b.target, eased);
    rig.rotateTo(BASE_AZIMUTH, BASE_POLAR, false);
    rig.moveTo(target.x, target.y, target.z, false);
    // Distance is a RATIO, so it interpolates in log space (guide rule 4c):
    // the Fleet-to-Agent journey spans more than an order of magnitude and a
    // linear lerp would hide the first half of the pull.
    rig.dollyTo(a.distance * (b.distance / a.distance) ** eased, false);
  }, []);

  /** Project one world point into CSS pixels inside the frame. */
  const project = useCallback(
    (point: THREE.Vector3, worldRadius: number, out: HeroAnchor): void => {
      const half = { w: size.width / 2, h: size.height / 2 };
      const ndc = projected.current.copy(point).project(camera);
      const behind = ndc.z > 1;
      out.x = (ndc.x + 1) * half.w;
      out.y = (1 - ndc.y) * half.h;
      out.onScreen =
        !behind &&
        ndc.x > -1.3 &&
        ndc.x < 1.3 &&
        ndc.y > -1.3 &&
        ndc.y < 1.3 &&
        Number.isFinite(out.x) &&
        Number.isFinite(out.y);
      if (worldRadius > 0) {
        const edge = offset.current
          .copy(point)
          .addScaledVector(right.current, worldRadius)
          .project(camera);
        out.radius = Math.abs(edge.x - ndc.x) * half.w;
      } else {
        out.radius = 0;
      }
    },
    [camera, size.width, size.height]
  );

  /** One projection pass, run at the end of every rendered frame. Bounded:
   *  ten zone centres, 173 unit centres, and an exact on-screen radius only
   *  for the handful of units that currently own a DOM node. */
  const projectAll = useCallback((): void => {
    const bridge = getBridge();
    // The renderer inverts the camera matrix at draw time, which is after this
    // runs, so do it here: a label one frame behind its mark is visible.
    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    right.current.setFromMatrixColumn(camera.matrixWorld, 0);
    bridge.width = size.width;
    bridge.height = size.height;
    for (let index = 0; index < anchors.zones.length; index += 1) {
      project(
        anchors.zones[index]!,
        anchors.zoneRadius[index]!,
        bridge.zones[index]!
      );
    }
    for (let index = 0; index < anchors.units.length; index += 1) {
      project(anchors.units[index]!, 0, bridge.units[index]!);
    }
    for (const index of bridge.tracked) {
      const anchor = bridge.units[index];
      if (!anchor) continue;
      project(anchors.units[index]!, anchors.unitRadius[index]!, anchor);
    }
    bridge.onProject?.();
  }, [anchors, getBridge, camera, project, size.width, size.height]);

  /** The largest mark on the board, in world units. The zoom cap is written
   *  against it so no unit can exceed the frame share. */
  const markWorldSize = useMemo(
    () =>
      capture.units.reduce((largest, unit) => Math.max(largest, unit.size), 0) *
      MARK_SCALE,
    [capture]
  );

  // Framings are recomputed whenever the viewport changes, because
  // getDistanceToFitSphere reads the live fov and aspect.
  useEffect(() => {
    const rig = controls.current;
    if (!rig) return;
    // The keyframe pool follows the ladder's length. A page that adds a panel
    // is a data edit in `manifest.ts`, so the rig must not assume three.
    while (keyframes.current.length < framings.length) {
      keyframes.current.push({ target: new THREE.Vector3(), distance: 1 });
    }
    keyframes.current.length = framings.length;
    // The floor is a property of the lens, not of the board, so it is computed
    // once here and applied to every keyframe AND to the rig itself: the
    // scroll cannot ask for a closer distance, and nothing else can either.
    const floor = maxZoomDistance(camera, markWorldSize);
    rig.minDistance = Math.max(4, floor);
    const narrow = size.width < NARROW_FRAME_PX || size.height > size.width;
    framings.forEach((framing, index) => {
      const crop = narrow ? framing.narrowCrop : 1;
      rig.rotateTo(BASE_AZIMUTH, BASE_POLAR, false);
      rig.moveTo(framing.center.x, framing.center.y, framing.center.z, false);
      rig.dollyTo(
        Math.max(
          floor,
          rig.getDistanceToFitSphere(framing.radius) * framing.tightness * crop
        ),
        false
      );
      rig.getTarget(keyframes.current[index]!.target, true);
      keyframes.current[index]!.distance = Math.max(
        floor,
        rig
          .getPosition(scratchTarget.current, true)
          .distanceTo(keyframes.current[index]!.target)
      );
    });
    applyProgress(0);
    ready.current = true;
    progress.current = 0;
    getBridge().progress = 0;
    invalidate();
  }, [
    applyProgress,
    camera,
    getBridge,
    framings,
    markWorldSize,
    size.width,
    size.height,
    invalidate,
  ]);

  useFrame((state: RootState, delta: number) => {
    const rig = controls.current;
    if (!rig || !ready.current) return;
    if (animating) {
      const step = Math.min(delta, 0.05);
      const target = THREE.MathUtils.clamp(progressRef.current ?? 0, 0, 1);
      progress.current = THREE.MathUtils.damp(
        progress.current,
        target,
        5.5,
        step
      );
      applyProgress(progress.current);
      getBridge().progress = progress.current;
      // camera-controls writes the camera on its own update() at priority -1,
      // which is next frame. Flush it now so the marks and their labels are
      // one composition rather than two a frame apart.
      rig.update(0);
      // Park when the camera has caught up with the scroll position.
      if (Math.abs(progress.current - target) > 0.0004) state.invalidate();
    }
    projectAll();
  });

  return <CameraControls ref={controls} makeDefault />;
}

/* ------------------------------------------------------------------ */
/* canvas                                                              */
/* ------------------------------------------------------------------ */

function FirstFrame({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    onReady();
  });
  return null;
}

export interface HeroBoardSceneProps {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  /** False when frozen (reduced motion or poster capture) or parked (offscreen,
   *  hidden tab). Nothing renders while it is false. */
  animating: boolean;
  /** The D40 rule that only Active moves. Exposed so the study can price it. */
  statusProtocolMotion?: boolean;
  statusChanges?: boolean;
  /** Scroll progress 0..1, written by a rAF-coalesced listener, never state. */
  progressRef: RefObject<number>;
  /** The ordered altitudes the camera travels, from the page's band list. */
  ladder?: readonly HeroAltitude[];
  /** What the board emphasizes. Semantic, so it is a prop and not a ref: it
   *  changes a handful of times over a whole sequence, never per frame. */
  highlight: HeroHighlight;
  /** What the board is coloured BY. Same cadence as the highlight, and
   *  independent of it: a lens says what a mark means, a highlight says which
   *  marks lead. */
  lens: HeroLens;
  /** Measurement and poster capture only: lets the study read pixels back. */
  preserveDrawingBuffer?: boolean;
  /** The seam to the DOM annotation layer: the scene writes projected anchors
   *  and live statuses, the overlay reads them. */
  getBridge: HeroBridgeAccess;
  onReady?: () => void;
  onCreated?: (state: RootState) => void;
}

export function HeroBoardScene({
  theme,
  capture,
  animating,
  statusProtocolMotion = true,
  statusChanges = true,
  progressRef,
  ladder = HERO_DEFAULT_LADDER,
  highlight,
  lens,
  preserveDrawingBuffer = false,
  getBridge,
  onReady,
  onCreated,
}: HeroBoardSceneProps) {
  return (
    <Canvas
      aria-hidden
      frameloop="demand"
      dpr={[1, IDLE_BUDGET.maxDpr]}
      gl={{
        antialias: false,
        preserveDrawingBuffer,
        powerPreference: 'high-performance',
      }}
      camera={{ fov: 34, near: 0.5, far: 6000, position: [0, 80, 120] }}
      onCreated={onCreated}
      style={{ width: '100%', height: '100%' }}
    >
      <color attach="background" args={[theme.canvas]} />
      <HeroGround theme={theme} capture={capture} />
      <HeroZones
        theme={theme}
        capture={capture}
        highlight={highlight}
        animating={animating}
        getBridge={getBridge}
      />
      <HeroUnits
        theme={theme}
        capture={capture}
        animating={animating}
        statusProtocolMotion={statusProtocolMotion}
        statusChanges={statusChanges}
        highlight={highlight}
        lens={lens}
        getBridge={getBridge}
      />
      <HeroDelegations
        theme={theme}
        capture={capture}
        highlight={highlight}
        animating={animating}
      />
      <HeroCameraRig
        capture={capture}
        animating={animating}
        progressRef={progressRef}
        ladder={ladder}
        getBridge={getBridge}
      />
      {onReady ? <FirstFrame onReady={onReady} /> : null}
    </Canvas>
  );
}
