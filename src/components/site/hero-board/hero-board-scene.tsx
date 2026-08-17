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
const FRAMING_TIGHTNESS = { fleet: 0.74, team: 0.86, agent: 0.95 } as const;

const MARK_SCALE = 1.7;
const STATUS_TRANSITION_SECONDS = 0.85;

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
}

/** Fleet, then one real Project, then one Agent inside it that needs a human —
 *  the altitude ladder the page's spine is built on. */
export function heroBoardFramings(
  capture: HeroBoardCapture
): HeroBoardFraming[] {
  const center = boardCenter(capture);
  const fleet = new THREE.Vector3(0, 0, 0);
  const fleetRadius =
    Math.hypot(capture.bounds.width, capture.bounds.height) / 2;

  let teamIndex = 0;
  for (let index = 0; index < capture.zones.length; index += 1) {
    if (capture.zones[index]!.agentCount > capture.zones[teamIndex]!.agentCount)
      teamIndex = index;
  }
  const zone = capture.zones[teamIndex]!;
  const team = new THREE.Vector3(zone.x - center.x, 0, zone.y - center.y);

  const needsYou = HERO_STATUS_ORDER.indexOf('blocked');
  const agentUnit =
    capture.units.find(
      unit => unit.zone === teamIndex && unit.status === needsYou
    ) ?? capture.units.find(unit => unit.zone === teamIndex)!;
  const agent = new THREE.Vector3(
    agentUnit.x - center.x,
    0,
    agentUnit.y - center.y
  );

  return [
    { center: fleet, radius: fleetRadius, tightness: FRAMING_TIGHTNESS.fleet },
    {
      center: team,
      radius: zone.radius * 1.5,
      tightness: FRAMING_TIGHTNESS.team,
    },
    { center: agent, radius: 4.4, tightness: FRAMING_TIGHTNESS.agent },
  ];
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
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const center = useMemo(() => boardCenter(capture), [capture]);

  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.rotateX(-Math.PI / 2);
    return next;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      uZone: { value: new THREE.Color(theme.zone) },
      uRim: { value: new THREE.Color(theme.grid) },
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

  return (
    <instancedMesh
      ref={mesh}
      args={[geometry, undefined, capture.zones.length]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={1}
    >
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        vertexShader={`
          varying vec2 vUv;
          void main() {
            vUv = uv - 0.5;
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform vec3 uZone;
          uniform vec3 uRim;
          varying vec2 vUv;
          void main() {
            float d = length(vUv) * 2.0;
            float w = fwidth(d);
            float disc = 1.0 - smoothstep(1.0 - w, 1.0 + w, d);
            float rim = 1.0 - smoothstep(0.0, w * 1.6, abs(d - 1.0 + w));
            vec3 color = mix(uZone, uRim, rim * 0.85);
            float alpha = max(disc * 0.92, rim * 0.9);
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

function HeroUnits({
  theme,
  capture,
  animating,
  statusProtocolMotion,
  statusChanges,
  getBridge,
}: {
  theme: SpatialThemeSnapshot;
  capture: HeroBoardCapture;
  animating: boolean;
  statusProtocolMotion: boolean;
  statusChanges: boolean;
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
    return next;
  }, [count]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(() => {
    const colors = HERO_STATUS_ORDER.map(
      status =>
        new THREE.Color(theme.status[statusLightStateForAgentStatus(status)])
    );
    return {
      uTime: { value: 0 },
      uSpin: { value: 0 },
      uTransition: { value: STATUS_TRANSITION_SECONDS },
      uStatusColor: { value: colors },
    };
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

  function changeOneUnit(): void {
    const bridge = getBridge();
    const index = Math.floor(random() * count);
    const from = bridge.statuses[index]!;
    const options = STATUS_TRANSITIONS[from]!;
    const next = options[Math.floor(random() * options.length)]!;
    if (next === from) return;
    bridge.statuses[index] = next;
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
          uniform float uTime;
          uniform float uTransition;
          uniform vec3 uStatusColor[6];
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;
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
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={`
          uniform float uSpin;
          varying vec2 vUv;
          varying vec3 vColor;
          varying float vMark;
          varying float vFlash;

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
              // Off: a quiet open ring.
              sdf = ring;
              weight = 0.62;
            } else if (vMark < 1.5) {
              // Active: the ring plus a half fill that turns once per rotation
              // period. The only mark that moves, in DOM and here alike.
              vec2 dir = vec2(cos(uSpin), sin(uSpin));
              float half_ = max(d - (R + T), -dot(p, dir));
              sdf = min(ring, half_);
            } else if (vMark < 2.5) {
              // Result: a check.
              sdf = min(
                sdSegment(p, vec2(-0.22, 0.0), vec2(-0.05, -0.17), T * 0.92),
                sdSegment(p, vec2(-0.05, -0.17), vec2(0.24, 0.19), T * 0.92)
              );
            } else if (vMark < 3.5) {
              // Needs you: a dot inside a ring. Static, never a pulse.
              sdf = min(ring, d - T * 1.5);
            } else {
              // Fault: a cross.
              sdf = min(
                sdSegment(p, vec2(-0.19, -0.19), vec2(0.19, 0.19), T * 0.92),
                sdSegment(p, vec2(-0.19, 0.19), vec2(0.19, -0.19), T * 0.92)
              );
            }

            // Analytic coverage: this is the shader paying back antialias:false.
            float coverage = 1.0 - smoothstep(-fwidth(sdf), fwidth(sdf), sdf);
            float alpha = coverage * weight;
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
  getBridge,
}: {
  capture: HeroBoardCapture;
  animating: boolean;
  progressRef: RefObject<number>;
  getBridge: HeroBridgeAccess;
}) {
  const controls = useRef<CameraControlsImpl>(null);
  const camera = useThree(state => state.camera);
  const size = useThree(state => state.size);
  const invalidate = useThree(state => state.invalidate);
  const framings = useMemo(() => heroBoardFramings(capture), [capture]);
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
    const segment = clamped < 0.5 ? 0 : 1;
    const local = segment === 0 ? clamped * 2 : (clamped - 0.5) * 2;
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
    // The floor is a property of the lens, not of the board, so it is computed
    // once here and applied to every keyframe AND to the rig itself: the
    // scroll cannot ask for a closer distance, and nothing else can either.
    const floor = maxZoomDistance(camera, markWorldSize);
    rig.minDistance = Math.max(4, floor);
    framings.forEach((framing, index) => {
      rig.rotateTo(BASE_AZIMUTH, BASE_POLAR, false);
      rig.moveTo(framing.center.x, framing.center.y, framing.center.z, false);
      rig.dollyTo(
        Math.max(
          floor,
          rig.getDistanceToFitSphere(framing.radius) * framing.tightness
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
      <HeroZones theme={theme} capture={capture} />
      <HeroUnits
        theme={theme}
        capture={capture}
        animating={animating}
        statusProtocolMotion={statusProtocolMotion}
        statusChanges={statusChanges}
        getBridge={getBridge}
      />
      <HeroCameraRig
        capture={capture}
        animating={animating}
        progressRef={progressRef}
        getBridge={getBridge}
      />
      {onReady ? <FirstFrame onReady={onReady} /> : null}
    </Canvas>
  );
}
