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
import {
  POINTER_LEAN_AZIMUTH_DEG,
  POINTER_LEAN_LAMBDA,
  POINTER_LEAN_POLAR_DEG,
  POINTER_LEAN_SETTLE,
} from './hero-board-annotations';
import type { HeroAnchor, HeroBridgeAccess } from './hero-board-annotations';
import {
  HERO_DIM,
  HERO_ZONE_DIM,
  heroStatusNeedsHuman,
  type HeroHighlight,
} from './hero-board-highlight';
import type { HeroLens } from './hero-board-lens';
import {
  boardCenter,
  heroBoardFramings,
  HERO_DEFAULT_LADDER,
  DELEGATION_OVERFLOW_SCALE,
  heroDelegationPosition,
  MARK_GLYPH_RADIUS,
  MARK_SCALE,
  NARROW_FRAME_PX,
  type HeroAltitude,
} from './hero-board-framings';
import { heroBoardSubjects } from './hero-board-subjects';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/** Decorative geometry never costs a raycast. A function, never null: drei and
 *  the strict R3F types both type `raycast` as a function. */
const noopRaycast = () => null;

/** The planted three-quarter view. The board rests here and returns here. */
const BASE_AZIMUTH = -12 * DEG;
const BASE_POLAR = 40 * DEG;

const STATUS_TRANSITION_SECONDS = 0.85;

/**
 * THE WORKING-TO-DONE MOMENT (ENG-031 W10, operator: "I need a delightful
 * animation when an agent transitions from working to check done (think the
 * cool Twitter like button animation)").
 *
 * It is the one state change on this board that is unambiguously GOOD NEWS,
 * and until now it looked exactly like every other one: an 0.85s crossfade
 * from the open arc to the check. Twitter's heart is the reference and the
 * three things it does are the three things here. The mark pops past its own
 * size and settles back with a real overshoot, a ring expands out of it and
 * thins to nothing, and a handful of particles fly out and fade.
 *
 * ALL OF IT IS IN THE SHADER, keyed per instance off `aChangeAt` and one
 * `aPop` flag, so the whole beat costs two float writes per transition and
 * ZERO per-frame JavaScript over the field. And it stays in the UNIT mesh
 * rather than becoming a second one, which is the difference between three
 * draw calls and four: every unit quad is padded to `MARK_QUAD_PAD` and the
 * fragment shader scales its own coordinate space back up, so the mark is
 * drawn at exactly the size and antialiasing it always was and the burst has
 * room around it.
 *
 * REDUCED MOTION gets the plain crossfade. `aPop` is written as zero, so
 * there is no pop and no burst, and the colour and glyph change exactly as
 * they did before.
 */
const POP_SECONDS = 0.44;
const BURST_SECONDS = 0.78;
/** How far past its own size the mark swells at the peak of the pop. */
const POP_SCALE = 0.45;
/** The share of the pop spent on the attack. The rest is the eased settle,
 *  which is where the overshoot back under 1.0 comes from. */
const POP_ATTACK = 0.18;
/** Unit quad size as a multiple of the mark's own footprint, so the burst has
 *  somewhere to go without a second mesh. The mark's drawn size is unchanged:
 *  the fragment shader multiplies its coordinate space by the same number. */
const MARK_QUAD_PAD = 2.6;
/** Particles per burst. Six reads as a burst and stays one cheap loop. */
const BURST_PARTICLES = 6;

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
 * A LENS OWNS THE COLOUR; STATUS ALWAYS OWNS THE SHAPE (ENG-031 W13,
 * superseding W8's `LENS_MARK`).
 *
 * W8 flattened every mark to the plain ring while a burn or source lens was
 * on, reasoning that colour and shape both meaning status would put two claims
 * on one mark. Read on the assembled page that is backwards, and the operator
 * found it at the panel it hurts most: "at the Cloud Platform framing I see 21
 * agents, 19 active, and nearly every mark renders grey with three red. Looks
 * bland and broken without blue spinning and green checks."
 *
 * The measurement behind it. At that framing the `source` lens was on, so
 * every mark was a plain ring and the fleet was painted by harness. The demo
 * fixture then carried two harnesses, and Cloud Platform's twenty-one Agents
 * were eighteen Codex (declared `#ECECEC`) and three Claude Code (declared
 * `#DD896F`): eighteen near-white rings and three salmon ones, exactly as
 * reported, while the DOM label beside them kept printing a live "N active"
 * read off a status channel the picture had stopped drawing. Two fixes meet
 * here: the fixture now spans five harnesses, and the shape channel stays.
 *
 * Colour answers "whose agent is this" and shape answers "what is it doing".
 * Those are two questions, not two answers to one, and the legend beside the
 * panel names only the colours. So the arcs still turn, the checks still land,
 * the working-to-done pop still fires, and the count under a Project is about
 * something the board is visibly drawing at every framing.
 */

function HeroUnits({
  theme,
  capture,
  animating,
  statusProtocolMotion,
  statusChanges,
  transitionBurst,
  highlight,
  lens,
  getBridge,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  animating: boolean;
  statusProtocolMotion: boolean;
  statusChanges: boolean;
  /** False under reduced motion: the crossfade stays, the pop and the burst
   *  do not (guide rule 12). */
  transitionBurst: boolean;
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
    // 1 when the change starting at `aChangeAt` is the working-to-done one,
    // and 0 for every other change. It is the whole trigger for the pop and
    // the burst: two floats per transition, no per-frame JavaScript.
    next.setAttribute(
      'aPop',
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
      uPopSeconds: { value: POP_SECONDS },
      uBurstSeconds: { value: BURST_SECONDS },
      uPopScale: { value: POP_SCALE },
      uPopAttack: { value: POP_ATTACK },
      uQuadPad: { value: MARK_QUAD_PAD },
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
    const pop = geometry.getAttribute('aPop') as THREE.InstancedBufferAttribute;
    const statuses = getBridge().statuses;
    capture.units.forEach((unit, index) => {
      statuses[index] = unit.status;
      scratch.position.set(unit.x - center.x, 0.03, unit.y - center.y);
      // The quad is padded so the burst has room; the fragment shader scales
      // its own coordinate space by the same number, so the MARK is drawn at
      // exactly the size and antialiasing it had before.
      scratch.scale.setScalar(unit.size * MARK_SCALE * MARK_QUAD_PAD);
      scratch.updateMatrix();
      mesh.current!.setMatrixAt(index, scratch.matrix);
      markFrom.setX(index, MARK_BY_STATUS[unit.status]!);
      markTo.setX(index, MARK_BY_STATUS[unit.status]!);
      statusFrom.setX(index, unit.status);
      statusTo.setX(index, unit.status);
      // Long settled: nothing flashes on arrival.
      changeAt.setX(index, -1000);
      pop.setX(index, 0);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
    pop.needsUpdate = true;
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
  const burstRef = useRef(transitionBurst);
  burstRef.current = transitionBurst;
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
    const pop = geometry.getAttribute('aPop') as THREE.InstancedBufferAttribute;
    const statuses = getBridge().statuses;

    for (let index = 0; index < count; index += 1) {
      const status = statuses[index] ?? capture.units[index]!.status;
      const ordinal = lens.channel ? (lens.channel[index] ?? 0) : status;
      // The mark is the STATUS glyph under every lens. Only the palette
      // ordinal changes when the board is re-read by harness or by burn.
      const mark = MARK_BY_STATUS[status]!;
      markFrom.setX(index, markTo.getX(index));
      statusFrom.setX(index, statusTo.getX(index));
      markTo.setX(index, mark);
      statusTo.setX(index, ordinal);
      changeAt.setX(index, elapsed.current);
      // A LENS CHANGE IS NOT A RESULT. Every unit's `aChangeAt` moves here, so
      // leaving `aPop` set would fire 173 celebrations at once the moment the
      // reader scrolls onto the provenance panel.
      pop.setX(index, 0);
    }
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
    pop.needsUpdate = true;
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
    const lensed = lensRef.current.channel !== null;
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
    const pop = geometry.getAttribute('aPop') as THREE.InstancedBufferAttribute;
    markFrom.setX(index, markTo.getX(index));
    statusFrom.setX(index, statusTo.getX(index));
    markTo.setX(index, MARK_BY_STATUS[next]!);
    // UNDER A LENS THE COLOUR HOLDS AND ONLY THE GLYPH TURNS. Writing the new
    // status into the palette ordinal here would repaint a harness or a burn
    // band as a status colour; writing the ordinal the unit already has means
    // the shader's own crossfade resolves to no colour change at all, so one
    // code path serves both regimes and there is no second transition to keep
    // in step.
    statusTo.setX(index, lensed ? statusTo.getX(index) : next);
    changeAt.setX(index, elapsed.current);
    // WORKING TO DONE, and only that (W10). It is the ONE state change on this
    // board that is unambiguously good news, so it is the one that celebrates:
    // the open arc becoming the check, which in mark terms is 1 becoming 2.
    // Every other turn keeps the plain crossfade it has always had.
    const isResult = MARK_BY_STATUS[from] === 1 && MARK_BY_STATUS[next] === 2;
    pop.setX(index, isResult && burstRef.current ? 1 : 0);
    markFrom.needsUpdate = true;
    markTo.needsUpdate = true;
    statusFrom.needsUpdate = true;
    statusTo.needsUpdate = true;
    changeAt.needsUpdate = true;
    pop.needsUpdate = true;
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
          attribute float aPop;
          attribute float aFocusFrom;
          attribute float aFocusTo;
          attribute float aFocusAt;
          uniform float uTime;
          uniform float uTransition;
          uniform float uFocusTransition;
          uniform float uDim;
          uniform float uPopSeconds;
          uniform float uBurstSeconds;
          uniform float uPopScale;
          uniform float uPopAttack;
          uniform vec3 uStatusColor[6];
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;
          varying float vFocus;
          varying float vPop;
          varying float vBurst;
          varying float vBurstOn;
          varying float vSeed;
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

            // THE WORKING-TO-DONE POP (W10). An attack up past the mark's own
            // size, then an ease-out-BACK settle that overshoots under 1.0
            // before arriving, which is the shape the eye reads as spring
            // rather than as a zoom. It leaves and arrives at rest (guide
            // rule 4b) and it is finite: past uPopSeconds it is exactly zero.
            float pt = clamp((uTime - aChangeAt) / uPopSeconds, 0.0, 1.0);
            float attack = smoothstep(0.0, uPopAttack, pt);
            float u = clamp((pt - uPopAttack) / max(1.0 - uPopAttack, 0.001), 0.0, 1.0);
            float back = 1.0 + 2.70158 * pow(u - 1.0, 3.0) + 1.70158 * pow(u - 1.0, 2.0);
            vPop = aPop * uPopScale * (attack - back);

            // And the burst's own clock, longer than the pop so the ring is
            // still travelling out while the check settles.
            vBurst = clamp((uTime - aChangeAt) / uBurstSeconds, 0.0, 1.0);
            vBurstOn = aPop * (1.0 - step(0.999, vBurst));
            // A per-pop seed, so two bursts do not fire identical particles.
            vSeed = fract(aChangeAt * 43.7585453) * 6.2831853;

            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uSpin;
          uniform float uQuadPad;
          uniform vec3 uStatusColor[6];
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;
          varying float vFocus;
          varying float vPop;
          varying float vBurst;
          varying float vBurstOn;
          varying float vSeed;

          float sdSegment(vec2 p, vec2 a, vec2 b, float r) {
            vec2 pa = p - a;
            vec2 ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
            return length(pa - ba * h) - r;
          }

          void main() {
            // THE QUAD IS PADDED, THE MARK IS NOT (W10). Every unit's quad is
            // uQuadPad times its own footprint so the burst has room without a
            // second mesh and a fourth draw call; multiplying the coordinate
            // space back up here draws the mark at exactly the size, weight
            // and fwidth coverage it had before the padding existed.
            // Dividing by the pop is what makes the mark SWELL: the same glyph
            // in a smaller coordinate space is a bigger glyph on screen.
            vec2 p = vUv * uQuadPad / (1.0 + vPop);
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
            vec3 color = vColor * (1.0 + vFlash * 0.45);

            // THE BURST (W10). A ring that expands out of the mark and thins
            // to nothing, and six particles that fly out and fade, in the
            // RESULT colour, drawn in the padded quad's own space. All of it
            // is finite and all of it is analytic: no second mesh, no second
            // draw call, no per-frame JavaScript, and past uBurstSeconds
            // vBurstOn is exactly zero so the board is pixel-identical to the
            // board the idle budget was measured on.
            if (vBurstOn > 0.0) {
              float bt = vBurst;
              float ease = 1.0 - pow(1.0 - bt, 2.4);
              float fade = pow(1.0 - bt, 1.6);

              float ringR = mix(0.055, 0.30, ease);
              float ringW = mix(0.028, 0.004, ease);
              float ringD = abs(length(vUv) - ringR) - ringW;
              float ring = 1.0 - smoothstep(-fwidth(ringD), fwidth(ringD), ringD);

              float travel = mix(0.075, 0.40, ease);
              float sparkR = mix(0.030, 0.002, ease);
              float best = 1.0e9;
              for (int i = 0; i < ${BURST_PARTICLES}; i++) {
                float a = vSeed + 6.2831853 * (float(i) / float(${BURST_PARTICLES}));
                vec2 c = vec2(cos(a), sin(a)) * travel;
                best = min(best, length(vUv - c) - sparkR);
              }
              float sparks = 1.0 - smoothstep(-fwidth(best), fwidth(best), best);

              float burst = max(ring * 0.85, sparks) * fade * vBurstOn * vFocus;
              if (burst > alpha) color = uStatusColor[5];
              alpha = max(alpha, burst);
            }

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
      uGlyph: { value: MARK_GLYPH_RADIUS },
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
        (child.overflow > 0 ? DELEGATION_OVERFLOW_SCALE : 1);
      // The DRAWN slot, one fifth further out than the packed one, so the
      // lineage spoke has a run and two siblings do not merge (W13).
      const slot = heroDelegationPosition(capture, index);
      scratch.position.set(slot.x - center.x, 0.035, slot.y - center.y);
      scratch.scale.set(quad, 1, quad);
      scratch.updateMatrix();
      mesh.current!.setMatrixAt(index, scratch.matrix);

      const owner = capture.units[child.parent];
      parent.setXY(
        index,
        (owner?.x ?? slot.x) - slot.x,
        (owner?.y ?? slot.y) - slot.y
      );
      // THE SPOKE RUNS BETWEEN THE MARKS THAT ARE PAINTED (W13). The capture's
      // own tether endpoints are the parent's and the child's LAYOUT edges,
      // which is a different pair of circles from the ones the shader draws:
      // the parent's ink started over its own end of the spoke and the spoke
      // stopped short of the child. Derived from the drawn radii instead, so
      // lineage is exactly the clear gap between the two bodies and cannot
      // drift if either mark's glyph radius changes.
      const dx = slot.x - (owner?.x ?? slot.x);
      const dy = slot.y - (owner?.y ?? slot.y);
      const run = Math.hypot(dx, dy) || 1;
      const ux = dx / run;
      const uy = dy / run;
      const parentEdge =
        MARK_GLYPH_RADIUS * (owner?.size ?? child.size) * MARK_SCALE;
      const childEdge =
        MARK_GLYPH_RADIUS *
        child.size *
        MARK_SCALE *
        (child.overflow > 0 ? DELEGATION_OVERFLOW_SCALE : 1);
      // Endpoints in the quad's own normalized space, so the fragment shader
      // draws lineage without knowing anything about the board.
      tetherA.setXY(index, (-ux * childEdge) / quad, (-uy * childEdge) / quad);
      tetherB.setXY(
        index,
        (-ux * (run - parentEdge)) / quad,
        (-uy * (run - parentEdge)) / quad
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
          uniform float uGlyph;
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
            // THE UNIT FIELD'S OWN GLYPH RADIUS (ENG-031 W13). Every mark on
            // this board is drawn at 0.30 of its footprint; the child was at
            // 0.27, so a child came out at 0.83 of its parent where the board
            // model's D3c ratio says 0.92. One number, read from the same
            // place the unit shader reads it.
            float radius = uGlyph / uQuad;
            float d = length(vUv) - radius;
            float w = fwidth(d);
            float mark = 1.0 - smoothstep(-w, w, d);

            // A hairline, but a hairline that survives a 26px-per-unit
            // framing. Lineage only: it implies no message flow (ENG-023 D3c).
            float line = sdSegment(vUv, vTetherA, vTetherB) - 0.03 / uQuad;
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
  /**
   * THE POINTER LEAN (ENG-031 W9). Two damped angles, in radians, composed on
   * top of whatever framing the scroll has reached.
   *
   * `damp` is the right tool here and the guide says why (rule 4b): the target
   * is still moving, because it is a mouse. It is NOT a semantic transition,
   * so it needs no duration and no shared clock, and it re-aims every frame
   * rather than restarting. The one thing it must do that `damp` does not is
   * ARRIVE: the lean settles to exactly zero below a threshold, because a
   * camera asymptotically approaching zero would keep the whole board
   * repainting for nobody and spend an idle budget the page has to pass.
   */
  const lean = useRef({ azimuth: 0, polar: 0 });

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
      /** One representative mark radius, for the reference projection. */
      medianUnitRadius:
        capture.units.length > 0
          ? ([...capture.units.map(unit => (unit.size * MARK_SCALE) / 2)].sort(
              (a, b) => a - b
            )[Math.floor(capture.units.length / 2)] ?? 0)
          : 0,
    };
  }, [capture]);
  const projected = useRef(new THREE.Vector3());
  const offset = useRef(new THREE.Vector3());
  const right = useRef(new THREE.Vector3());
  /** Scratch for the one reference projection that sizes DOM hit testing. */
  const reference = useRef(new THREE.Vector3());
  const referenceAnchor = useRef<HeroAnchor>({
    x: 0,
    y: 0,
    radius: 0,
    onScreen: false,
  });

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
    // The planted three-quarter view, plus however far the reader's mouse has
    // leaned it. Angles only: the lean can never touch distance, so it cannot
    // reverse the run's monotonic zoom, and it can never touch progress, so it
    // cannot change which step the reader is on.
    rig.rotateTo(
      BASE_AZIMUTH + lean.current.azimuth,
      BASE_POLAR + lean.current.polar,
      false
    );
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
    // HOW BIG A MARK IS RIGHT NOW, in one projection (ENG-031 W10). The
    // overlay's delegated hit testing needs a mark's on-screen radius to
    // decide whether the pointer is on one, and every mark in the capture is
    // the same world size on one plane, so the camera's own target is the
    // right place to measure it. One projection a frame rather than 173.
    const rig = controls.current;
    if (rig) {
      rig.getTarget(reference.current, true);
      project(
        reference.current,
        anchors.medianUnitRadius,
        referenceAnchor.current
      );
      bridge.markRadius = referenceAnchor.current.radius;
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
      // The lean follows the pointer and unwinds to rest when it leaves.
      const pointer = getBridge().pointer;
      const wantAzimuth = pointer.active
        ? -THREE.MathUtils.clamp(pointer.x, -1, 1) *
          POINTER_LEAN_AZIMUTH_DEG *
          DEG
        : 0;
      const wantPolar = pointer.active
        ? THREE.MathUtils.clamp(pointer.y, -1, 1) * POINTER_LEAN_POLAR_DEG * DEG
        : 0;
      const current = lean.current;
      current.azimuth = THREE.MathUtils.damp(
        current.azimuth,
        wantAzimuth,
        POINTER_LEAN_LAMBDA,
        step
      );
      current.polar = THREE.MathUtils.damp(
        current.polar,
        wantPolar,
        POINTER_LEAN_LAMBDA,
        step
      );
      // ARRIVE, rather than approach forever. Below the settle floor the lean
      // is set to the target outright, so a board nobody is touching is
      // pixel-identical to the board the idle budget was measured on.
      if (Math.abs(current.azimuth - wantAzimuth) < POINTER_LEAN_SETTLE) {
        current.azimuth = wantAzimuth;
      }
      if (Math.abs(current.polar - wantPolar) < POINTER_LEAN_SETTLE) {
        current.polar = wantPolar;
      }
      applyProgress(progress.current);
      getBridge().progress = progress.current;
      // camera-controls writes the camera on its own update() at priority -1,
      // which is next frame. Flush it now so the marks and their labels are
      // one composition rather than two a frame apart.
      rig.update(0);
      // Park when the camera has caught up with the scroll position AND the
      // lean has finished unwinding. Either one still moving is a reason to
      // keep painting; both settled is a reason to stop.
      if (
        Math.abs(progress.current - target) > 0.0004 ||
        current.azimuth !== wantAzimuth ||
        current.polar !== wantPolar
      ) {
        state.invalidate();
      }
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
  /**
   * The working-to-done celebration (ENG-031 W10). False under reduced motion,
   * where the crossfade stays and the pop and the burst do not (guide rule
   * 12), and exposed so the study can price it against the idle budget.
   */
  transitionBurst?: boolean;
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
  transitionBurst = true,
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
        transitionBurst={transitionBurst}
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
