'use client';

/**
 * Option A, Crust (ENG-031 W15, operator brief 2026-10-08).
 *
 * "A section of a 3D sphere, like a section of Earth's crust. Still 3D and
 * spherical but not the entire sphere. A much smaller slice that can expand
 * over time to take over more territory of the surface. A little geometric,
 * like hex tiles. If there is only one agent, a little surrounding territory
 * and some ghost agents you can click to expand."
 *
 * Every tile is one instance of one prism on the tile outline of the chosen
 * shape (W15g, `crust-shape.ts`): territory in the ground material, agents
 * in the body material of the chosen option (W15c, `crust-materials.ts`).
 * An agent carries its status as colour and rise, a lamp on top or a glow
 * under it or a lit rim (W15d, `crust-signal.ts`), in the translucent
 * options a lit cap of light inside the body, its harness as the vendor's
 * own mark extruded on the face in the vendor's own colours whatever its
 * status (W15f to W15i, `crust-marks.ts`), turned to face the camera, and,
 * while it works, any of three lights and one lift (W15i, `crust-motion.ts`).
 * The sheen and the breath are drawn by the body itself
 * (`crust-surface-light.ts`), so they cover the visible surface exactly.
 * The ring beyond the territory is drawn as ghost outlines; in the material
 * study a lone agent's slots answer the pointer and a click on one fills the
 * cluster. The sphere body underneath is a dark globe with faint graticule
 * so even a one-agent slice reads as a piece of something round.
 *
 * An agent answers the pointer as a key does (W15i, operator 2026-10-13:
 * "There should be a mouse-down effect on the agent object, in addition to
 * mouseover and selection states. Make it all feel holistic and expected
 * and delightful"): hover lifts it a little and lights it, a press pushes it
 * down and squeezes it with the keyswitch study's click, the release springs
 * it up to its selected height with the product's ring easing in. Rise and
 * squeeze are damped springs, settled quickly with a hint of overshoot; on
 * Gummy they are looser, so the jelly wobbles.
 *
 * What changes does so continuously (W15h): an agent arriving or leaving
 * fades between agent and ground, a status change cross-fades its colour, a
 * lift springs; nothing pops. Only what is drawn is submitted: tiles are
 * packed into the instance buffers each frame, and only the packed range is
 * uploaded, so ten agents cost ten agents.
 *
 * Per-frame work mutates preallocated arrays and writes instance buffers.
 * Nothing of ours allocates in `useFrame`; three keeps a small record per
 * uploaded range, which it clears on upload.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { StatusLightState } from '@/components/status-light/protocol';
import { fleetAt, sourceAdapterId, type FleetModel } from '../fleet-model';
import { isNarrow } from '../narrow';
import { planeToSphere, SPHERE_CENTER, SPHERE_RADIUS } from '../sphere';
import { facingFade, nameShown, nameStyleOf } from '../names';
import { stageBlend, STAGES } from '../stages';
import { BORDER_SAMPLES, writeBorder } from '../territory';
import { usePressSound } from '../use-press-sound';
import type { LabelAnchor, VisualProps } from '../visual-contract';
import { makeMarkParts, markIndexFor } from './crust-marks';
import { disposeCrustMaterial, makeCrustMaterial } from './crust-materials';
import {
  shapeCorner,
  tileBandGeometry,
  tileFaceGeometry,
  tilePrismGeometry,
  tileRingGeometry,
  tileSlabGeometry,
} from './crust-shape';
import { crustSignal } from './crust-signal';
import {
  addWorkAttributes,
  makeSurfaceLightUniforms,
  sheenPhase,
  turnSurfaceLight,
  withSurfaceLight,
} from './crust-surface-light';
import { keepPickable } from './pick-bounds';
import { useRoomEnvironment } from './environment';
import { GlobeBody } from './globe-body';
import {
  BORDER_LIFT,
  centerTiles,
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
  type TilePlacement,
} from './shared';

/** Circumradius of a tile on a grid of circumradius 1: the gap between
 *  tiles is what is left (operator 2026-10-12: "a little bit more spacing
 *  between all the hex tiles"). */
const TILE_RADIUS = 0.82;
const TILE_HEIGHT = 0.42;
/** Width of a harness mark on the face, and its depth by treatment. Relief
 *  is a touch thinner since W15i (operator 2026-10-13: "Make the harness
 *  relief slightly thinner (less thick) but only slightly"). */
const MARK_SIZE = 0.78;
const MARK_DEPTH = { lit: 0.05, relief: 0.075, coin: 0.07 } as const;
/** How far a part one layer up stands above the layer below, in mark depths.
 *  Layers never share a plane; this is what keeps overlapping parts from
 *  z-fighting. */
const LAYER_STEP = 0.4;
const COIN_RADIUS = 0.5;
const COIN_HEIGHT = 0.08;
/** The lit cap in the translucent options: the share of the body the light
 *  fills below the face, and how far it stands proud of it. Fixed, so a mark
 *  sits on the cap at every lift (it floated over lifted tiles before). */
const CAP_SHARE = 0.6;
const CAP_PROUD = 0.06;
/** Clearance between a surface and the thing standing on it. */
const LIFT_OFF = 0.004;
/** How a tile answers the pointer, in lift units: hover raises it, the open
 *  agent stands taller, and a press pushes it down from wherever it was,
 *  never below the ground it stands in. */
const HOVER_LIFT = 0.1;
const SELECT_LIFT = 0.26;
const PRESS_DEPTH = 0.13;
/** A press that travels this far, in pixels, was a drag: the key comes back
 *  up and nothing is selected. */
const DRAG_PX = 6;
/** On glass a press shows only once it has held this long, so the start of
 *  a scroll never dips the tile it began on. */
const TOUCH_PRESS_S = 0.07;

interface Spring {
  /** Natural frequency, radians per second. */
  omega: number;
  /** Damping ratio: 1 never overshoots, lower wobbles. */
  zeta: number;
}

/** Rise and squeeze. Snappy, settled in about a quarter of a second with a
 *  few percent of overshoot (operator 2026-10-13: "Dampen the expansion
 *  spring for selecting agents a bit. But still should feel snappy and
 *  responsive when changing states"). Gummy is looser on purpose: a jelly
 *  that wobbles when it is pressed, let go of, or changes its mind. */
const LIFT_SPRING: Spring = { omega: 24, zeta: 0.74 };
const SQUASH_SPRING: Spring = { omega: 30, zeta: 0.72 };
const JELLY_LIFT_SPRING: Spring = { omega: 19, zeta: 0.42 };
const JELLY_SQUASH_SPRING: Spring = { omega: 16, zeta: 0.2 };
/** How far a press squeezes the tile (height share; the width gives back the
 *  volume), and the jolt a jelly gets when something happens to it. */
const PRESS_SQUASH = 0.06;
const JELLY_PRESS_SQUASH = 0.17;
const JELLY_KICK = { hover: 1.3, select: 2.2, status: 1.6 } as const;
const FIRM_KICK = { hover: 0, select: 0.5, status: 0.3 } as const;
/** Sub-step for the springs, seconds: a slow frame can never blow one up. */
const SPRING_STEP = 1 / 120;

/** How fast a tile answers, per second: status weight, arrival, being an
 *  agent at all, the colour of its status, a slot's hover and press, the
 *  open agent's ring. Quick, so a click lands and a hover answers at once
 *  (operator 2026-10-12: "more snappy and less mushy"), yet nothing is a
 *  cut. */
const WEIGHT_RATE = 9;
const ARRIVE_RATE = 11;
const AGENT_RATE = 8;
const STATUS_RATE = 14;
const SLOT_HOVER_RATE = 16;
const SLOT_PRESS_RATE = 30;
const RING_RATE = 14;
/** Working motion. Breathe: one breath every few seconds, the light inside
 *  swelling by about a third, the tile drawing in a breath of width and
 *  height (operator 2026-10-13: "I can't tell what working breathe does").
 *  Bob and Wave: lift. Wave travels with distance across the cluster and is
 *  stronger since W15i ("Make the wave effect a bit more pronounced").
 *  Pulse: a faint ring from the top edge that fades before it reaches a
 *  neighbour ("Make pulse more subtle; also the pulses... disappear in the
 *  walls like a glitch"): at most 1.3 of the tile, where the nearest
 *  neighbour's wall starts past 1.4. */
const BREATH_SECONDS = 3.8;
const BREATH_GLOW = 0.32;
const BREATH_SWELL = 0.03;
const BREATH_LIFT = 0.035;
const BOB_RATE = 1.7;
const BOB_LIFT = 0.06;
const WAVE_RATE = 1.3;
const WAVE_LIFT = 0.085;
const WAVE_GLOW = 0.12;
const PULSE_PER_SECOND = 0.36;
const PULSE_REACH = 0.36;
/** Arriving and leaving (W15j, operator 2026-10-13, on the move from ten
 *  agents to one: "the hex tiles kind of diminishing and getting really
 *  small. They turn into dots. That kind of looks bad and takes too long"):
 *  a tile rises out of the globe and sinks back into it, giving up only a
 *  little of its width, instead of shrinking to a dot; the globe hides what
 *  has sunk. `SINK_CLEAR` takes the tallest mark below the surface. */
const FOOT_MIN = 0.72;
const SINK_CLEAR = 0.3;
/** Wander (W15j): the light inside goes round the tile about once in five
 *  seconds, out between the lit cap and the wall where a clear body shows
 *  it, drifting a little in and out as it goes, and lights the surface
 *  nearest it; the cap and the body give up some of their own light so the
 *  moving one reads. Under the Lamp signal the glow under the tile goes
 *  round with it. */
const WANDER_TURN = 1.25;
const WANDER_REACH = 0.55;
const WANDER_GLOW = 1;
const WANDER_CAP = 0.85;
const WANDER_SPILL = 1.4;
/** The wandering light's own size and brightness, in tile units. */
const ORB_RADIUS = 0.16;
const ORB_GLOW = 2.4;
/** Spin (W15j): the harness mark turns once in about five seconds, and when
 *  the agent stops working it comes back to face the reader. */
const SPIN_RATE = 1.25;
const SPIN_SETTLE = 5;
/** Below this an agent is drawn as ground; a tile this small is not drawn. */
const AGENT_MIN = 0.02;
const SCALE_MIN = 0.004;

const STATUS_KEY: Record<StatusLightState, number> = {
  active: 1,
  'needs-you': 2,
  result: 3,
  off: 4,
  fault: 5,
};

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const statusColor = new THREE.Color();
const groundColor = new THREE.Color();
const tmp = new THREE.Vector3();
const normal = new THREE.Vector3();
const side = new THREE.Vector3();
const forward = new THREE.Vector3();
const yaw = new THREE.Quaternion();
const spinTurn = new THREE.Quaternion();
const origin = new THREE.Vector3();
const yAxis = new THREE.Vector3(0, 1, 0);
const point = { x: 0, y: 0 };
const WHITE = new THREE.Color(0xffffff);
/** Neutral body for the metal option; the status lives on the lamp. */
const METAL = new THREE.Color(0x8a9199);
/** Frosted clear ground for the acrylic option. */
const FROST = new THREE.Color(0xb9d2e4);
/** A light coin, and the two inks of the vendors whose marks are black or
 *  white: dark on any bright face (the coin, a lit translucent body, a body
 *  painted in its status colour), light on a dark one. A mark is its
 *  vendor's own colours whatever the agent's status (operator 2026-10-13:
 *  "they should always keep their canonical logo color regardless of the
 *  status or at maximum be slightly colored by the status"): an ink takes
 *  a hint of the status and no more. */
const COIN = new THREE.Color(0xd9dde3);
const INK = new THREE.Color(0x1b2027);
const PAPER = new THREE.Color(0xf2f4f7);
const INK_TINT = 0.1;
const blendScratch = { from: 0, to: 0, t: 0 };

/** A soft radial falloff, drawn once, for light under a tile. */
function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(
      size / 2,
      size / 2,
      size * 0.18,
      size / 2,
      size / 2,
      size / 2
    );
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeAnim(tileCount: number, partCount: number) {
  return {
    scale: new Float32Array(tileCount),
    lift: new Float32Array(tileCount),
    liftVelocity: new Float32Array(tileCount),
    /** How far a working agent's mark has turned (Spin), radians. */
    spin: new Float32Array(tileCount),
    /** Height share the tile is squeezed (below 0) or stretched (above). */
    squash: new Float32Array(tileCount),
    squashVelocity: new Float32Array(tileCount),
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    /** A slot's answer to the pointer, eased: hovered, pressed. */
    slotHover: new Float32Array(tileCount),
    slotPress: new Float32Array(tileCount),
    /** 0 a tile of ground, 1 an agent; eases, so arriving and leaving fade. */
    agentness: new Float32Array(tileCount),
    /** The eased colour of the status, linear rgb per tile. */
    status: new Float32Array(tileCount * 3),
    statusReady: new Uint8Array(tileCount),
    /** The status a tile last showed, so a change can jolt a jelly. */
    statusKey: new Uint8Array(tileCount),
    partCount: new Int32Array(partCount),
    /** Which tile each packed slot draws, for picking. */
    agentTile: new Int32Array(tileCount),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    /** Agents in the fleet right now: an agent past this is leaving. */
    agents: 0,
    clock: 0,
    /** The agent under the pointer, the agent held down, the slot under
     *  the pointer and the slot held down, or -1. */
    hover: -1,
    press: -1,
    slotHovered: -1,
    slotPressed: -1,
    pressX: 0,
    pressY: 0,
    pressTouch: false,
    pressClock: 0,
    /** The open agent's ring: its tile, and how far it has eased in; and
     *  the ring it moved from, easing out where it was. */
    ringTile: -1,
    ring: 0,
    fadingTile: -1,
    fading: 0,
  };
}

type Anim = ReturnType<typeof makeAnim>;

/** Step a damped spring toward `target`, sub-stepped so a slow frame can
 *  never blow it up. */
function stepSpring(
  position: Float32Array,
  velocity: Float32Array,
  i: number,
  target: number,
  spring: Spring,
  delta: number
) {
  const steps = Math.max(1, Math.ceil(delta / SPRING_STEP));
  const h = delta / steps;
  const k = spring.omega * spring.omega;
  const c = 2 * spring.zeta * spring.omega;
  let x = position[i];
  let v = velocity[i];
  for (let n = 0; n < steps; n += 1) {
    v += (k * (target - x) - c * v) * h;
    x += v * h;
  }
  position[i] = x;
  velocity[i] = v;
}

/** One breath, 0 to 1 and back, soft at both ends. */
function breathAt(angle: number): number {
  const b = 0.5 - 0.5 * Math.cos(angle);
  return b * b * (3 - 2 * b);
}

/** Let go of whatever is held: a click on the way up from a mouse, nothing
 *  from glass (a tap clicks once, on the tap). */
function letGo(anim: Anim, play: (phase: 'press' | 'release') => void) {
  if (anim.press < 0 && anim.slotPressed < 0) return;
  if (!anim.pressTouch) play('release');
  anim.press = -1;
  anim.slotPressed = -1;
}

/** Submit only what was packed, and upload only that. */
function flush(mesh: THREE.InstancedMesh, count: number) {
  mesh.count = count;
  if (count === 0) return;
  mesh.instanceMatrix.addUpdateRange(0, count * 16);
  mesh.instanceMatrix.needsUpdate = true;
  const colors = mesh.instanceColor;
  if (colors) {
    colors.addUpdateRange(0, count * 3);
    colors.needsUpdate = true;
  }
}

function flushWork(attribute: THREE.InstancedBufferAttribute, count: number) {
  if (count === 0) return;
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
}

/** A Project's border (names: Border): how bright, how wide on screen, how
 *  fast it grows with its Project and fades in or out. */
const BORDER_ALPHA = 0.36;
const BORDER_WIDTH = 0.0011;
const BORDER_RATE = 8;

/** One ribbon per Project around its land, on the globe's skin. */
function makeBorderGeometry(projects: number): THREE.BufferGeometry {
  const vertices = projects * BORDER_SAMPLES * 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  g.setAttribute(
    'color',
    new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
      THREE.DynamicDrawUsage
    )
  );
  const index: number[] = [];
  for (let p = 0; p < projects; p += 1) {
    const base = p * BORDER_SAMPLES * 2;
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const a = base + i * 2;
      const c = base + ((i + 1) % BORDER_SAMPLES) * 2;
      index.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  g.setIndex(index);
  return g;
}

const borderPlane = new Float32Array(BORDER_SAMPLES * 2);
const borderNormals = new Float32Array(BORDER_SAMPLES * 2);
const borderPoint = new THREE.Vector3();

/** Ease each Project's border toward the land it holds now. */
function easeBorders(
  model: FleetModel,
  count: number,
  rings: Float32Array,
  fades: Float32Array,
  delta: number,
  reducedMotion: boolean,
  /** How much the borders show: while they cannot be seen they take their
   *  new size at once, so a border never morphs on screen (W15j). */
  shown: number
) {
  for (const project of model.projects) {
    const present = project.first < count;
    const p = project.id;
    if (present) {
      const last = Math.min(count, project.first + project.count) - 1;
      const target = model.agents[last].ring + 1;
      rings[p] =
        reducedMotion || fades[p] < 0.01 || shown < 0.02
          ? target
          : THREE.MathUtils.damp(rings[p], target, BORDER_RATE, delta);
    }
    fades[p] = reducedMotion
      ? present
        ? 1
        : 0
      : THREE.MathUtils.damp(fades[p], present ? 1 : 0, BORDER_RATE, delta);
  }
}

/** Write every Project's border ribbon for this frame; nothing is written
 *  or uploaded while every border is out and was already out. */
function drawBorders(
  geometry: THREE.BufferGeometry,
  model: FleetModel,
  placements: TilePlacement[],
  centres: number[],
  rings: Float32Array,
  fades: Float32Array,
  shown: number,
  labels: LabelAnchor[],
  camera: THREE.Camera,
  ink: THREE.Color,
  drawn: { any: boolean }
) {
  const visible = shown > 0 && fades.some(fade => fade > 0);
  if (!visible && !drawn.any) return;
  drawn.any = visible;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors = geometry.getAttribute('color') as THREE.BufferAttribute;
  const pos = position.array as Float32Array;
  const col = colors.array as Float32Array;
  for (const project of model.projects) {
    const p = project.id;
    const base = p * BORDER_SAMPLES * 2;
    const alpha =
      BORDER_ALPHA * fades[p] * shown * facingFade(labels[p]?.facing ?? 0);
    const r = ink.r * alpha;
    const g = ink.g * alpha;
    const b = ink.b * alpha;
    for (let v = base; v < base + BORDER_SAMPLES * 2; v += 1) {
      col[v * 3] = r;
      col[v * 3 + 1] = g;
      col[v * 3 + 2] = b;
    }
    if (alpha <= 0) continue;
    const place = placements[centres[p]];
    // about two pixels wide at any distance
    const half = Math.min(
      0.5,
      Math.max(0.012, camera.position.distanceTo(place.position) * BORDER_WIDTH)
    );
    writeBorder(place.x, place.y, rings[p], borderPlane, borderNormals);
    for (let i = 0; i < BORDER_SAMPLES; i += 1) {
      const x = borderPlane[i * 2];
      const y = borderPlane[i * 2 + 1];
      const nx = borderNormals[i * 2] * half;
      const ny = borderNormals[i * 2 + 1] * half;
      const v = (base + i * 2) * 3;
      planeToSphere(x - nx, y - ny, borderPoint, SPHERE_RADIUS, BORDER_LIFT);
      pos[v] = borderPoint.x;
      pos[v + 1] = borderPoint.y;
      pos[v + 2] = borderPoint.z;
      planeToSphere(x + nx, y + ny, borderPoint, SPHERE_RADIUS, BORDER_LIFT);
      pos[v + 3] = borderPoint.x;
      pos[v + 4] = borderPoint.y;
      pos[v + 5] = borderPoint.z;
    }
  }
  position.needsUpdate = true;
  colors.needsUpdate = true;
}

export function CrustVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  shownRef,
  material,
  mark,
  shape,
  motion,
  signal,
  light = 'room',
  onExpand,
  expandable = true,
  sound = false,
  names = 'float',
  closeUp = false,
  onHoverChange,
  onSelect,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileCount = model.tiles.length;
  const surface = useMemo(() => makeSurfaceLightUniforms(), []);
  const spec = useMemo(() => {
    const made = makeCrustMaterial(material);
    withSurfaceLight(made.agent, surface, 1);
    return made;
  }, [material, surface]);
  const sig = useMemo(() => crustSignal(signal), [signal]);
  const corner = shapeCorner(shape);
  useEffect(() => () => disposeCrustMaterial(spec), [spec]);
  useRoomEnvironment(spec.environment, light);
  const jelly = material === 'gummy';
  const kicks = jelly ? JELLY_KICK : FIRM_KICK;
  const play = usePressSound(sound);
  const slotsLive = onExpand !== undefined && expandable;

  const groundRef = useRef<THREE.InstancedMesh>(null);
  const agentsRef = useRef<THREE.InstancedMesh>(null);
  const coresRef = useRef<THREE.InstancedMesh>(null);
  const lampsRef = useRef<THREE.InstancedMesh>(null);
  const parts = useMemo(() => makeMarkParts(), []);
  const partRefs = useRef<(THREE.InstancedMesh | null)[]>(
    Array.from({ length: parts.length }, () => null)
  );
  const coinsRef = useRef<THREE.InstancedMesh>(null);
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const slotsRef = useRef<THREE.InstancedMesh>(null);
  const rimsRef = useRef<THREE.InstancedMesh>(null);
  const glowsRef = useRef<THREE.InstancedMesh>(null);
  const pulsesRef = useRef<THREE.InstancedMesh>(null);
  const orbsRef = useRef<THREE.InstancedMesh>(null);
  const selectionRef = useRef<THREE.Mesh>(null);
  const fadingRingRef = useRef<THREE.Mesh>(null);
  const bordersRef = useRef<THREE.Mesh>(null);

  // Per-tile animated state, preallocated once and mutated in place. It
  // outlives a change of model (the material study swaps the hero's status
  // in place), so a tile keeps its rise and its weight across the swap.
  const animRef = useRef<Anim | null>(null);
  if (animRef.current === null || animRef.current.scale.length !== tileCount)
    animRef.current = makeAnim(tileCount, parts.length);
  const anim = animRef.current;
  const { size, gl } = useThree();
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const markOfAgent = useMemo(
    () =>
      Int8Array.from(model.agents, a =>
        markIndexFor(sourceAdapterId(a.source))
      ),
    [model]
  );

  // Territory and agents share an outline; the agents' copy carries the
  // per-instance work (sheen, breath) its material reads.
  const geometry = useMemo(
    () => tilePrismGeometry(TILE_RADIUS, TILE_HEIGHT, corner, spec.edge),
    [spec.edge, corner]
  );
  const agentGeometry = useMemo(() => {
    const g = tilePrismGeometry(TILE_RADIUS, TILE_HEIGHT, corner, spec.edge);
    addWorkAttributes(g, tileCount);
    return g;
  }, [spec.edge, corner, tileCount]);
  const coreGeometry = useMemo(() => {
    const g = tilePrismGeometry(0.42, 1, corner, null);
    addWorkAttributes(g, tileCount);
    return g;
  }, [corner, tileCount]);
  const coreMaterial = useMemo(
    () =>
      withSurfaceLight(
        new THREE.MeshBasicMaterial({ toneMapped: false }),
        surface,
        0.9
      ),
    [surface]
  );
  const lampGeometry = useMemo(() => tileSlabGeometry(0.5, corner), [corner]);
  const coinGeometry = useMemo(
    () =>
      new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, COIN_HEIGHT, 32, 1),
    []
  );
  const coinMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.38,
        metalness: 0.55,
        envMapIntensity: 0.9,
      }),
    []
  );
  // A mark is solid paint in its vendor's colours, lit like stamped enamel,
  // so it is the vendor's colour and not the vendor's blended with the glass
  // it stands on. Black-and-white marks too, in their ink.
  const paintMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.42,
        metalness: 0,
        envMapIntensity: 0.9,
      }),
    []
  );
  const ghostGeometry = useMemo(
    () => tileRingGeometry(TILE_RADIUS - 0.04, TILE_RADIUS - 0.14, corner),
    [corner]
  );
  // The slot itself: the whole face inside the outline, dark until the
  // pointer finds it, and what the pointer finds (the outline alone is a
  // thin ring a pointer slips through).
  const slotGeometry = useMemo(
    () => tileFaceGeometry(TILE_RADIUS - 0.04, corner),
    [corner]
  );
  // Rim: a thin lit band around the top edge, so the status is light on
  // the side of the tile, not a line drawn on top of it.
  const rimGeometry = useMemo(
    () => tileBandGeometry(TILE_RADIUS, 0.07, corner),
    [corner]
  );
  // Lamp: light spilling under the tile, a soft radial falloff on a quad.
  const glowGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(3.0, 3.0);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const selectionGeometry = useMemo(
    () => tileRingGeometry(TILE_RADIUS + 0.11, TILE_RADIUS + 0.06, corner),
    [corner]
  );
  // Project borders, and each Project's eased size and presence.
  const borderGeometry = useMemo(
    () => makeBorderGeometry(model.projects.length),
    [model]
  );
  const borderState = useMemo(() => {
    const rings = new Float32Array(model.projects.length);
    return {
      rings,
      fades: new Float32Array(model.projects.length),
      drawn: { any: true },
      /** The names are pinned to the borders as drawn. */
      rim: { rings },
    };
  }, [model]);
  // Pulse: a thin ring that leaves the top edge.
  // Wander's light, a small bright orb that drifts inside a clear body: the
  // glass refracts it, so it reads as a glow moving about within the tile.
  const orbGeometry = useMemo(() => new THREE.SphereGeometry(1, 16, 12), []);
  const pulseGeometry = useMemo(
    () => tileRingGeometry(TILE_RADIUS + 0.02, TILE_RADIUS - 0.05, corner),
    [corner]
  );

  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry]
  );
  useEffect(
    () => () => {
      agentGeometry.dispose();
    },
    [agentGeometry]
  );
  useEffect(
    () => () => {
      borderGeometry.dispose();
    },
    [borderGeometry]
  );
  useEffect(
    () => () => {
      coreGeometry.dispose();
      ghostGeometry.dispose();
      slotGeometry.dispose();
      rimGeometry.dispose();
      selectionGeometry.dispose();
      pulseGeometry.dispose();
      orbGeometry.dispose();
      lampGeometry.dispose();
    },
    [
      coreGeometry,
      ghostGeometry,
      slotGeometry,
      rimGeometry,
      selectionGeometry,
      pulseGeometry,
      orbGeometry,
      lampGeometry,
    ]
  );
  useEffect(
    () => () => {
      parts.forEach(part => part.geometry.dispose());
      coinGeometry.dispose();
      coinMaterial.dispose();
      paintMaterial.dispose();
      coreMaterial.dispose();
      glowGeometry.dispose();
      glowTexture.dispose();
    },
    [
      parts,
      coinGeometry,
      coinMaterial,
      paintMaterial,
      coreMaterial,
      glowGeometry,
      glowTexture,
    ]
  );

  // A press is let go wherever the pointer comes up, and dropped silently
  // when the browser takes the gesture (a scroll on glass) or the window
  // loses focus.
  useEffect(() => {
    const up = () => letGo(anim, play);
    const drop = () => {
      anim.press = -1;
      anim.slotPressed = -1;
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', drop);
    window.addEventListener('blur', drop);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', drop);
      window.removeEventListener('blur', drop);
    };
  }, [anim, play]);

  const setCursor = (pointing: boolean) =>
    gl.domElement.style.setProperty('cursor', pointing ? 'pointer' : '');
  // measured as R3F measures a click's travel, so the two always agree
  const travelled = (e: ThreeEvent<PointerEvent>) =>
    Math.hypot(
      e.nativeEvent.clientX - anim.pressX,
      e.nativeEvent.clientY - anim.pressY
    );
  const hold = (e: ThreeEvent<PointerEvent>) => {
    anim.pressX = e.nativeEvent.clientX;
    anim.pressY = e.nativeEvent.clientY;
    // a pen, like a finger, may be starting a scroll
    anim.pressTouch = e.pointerType !== 'mouse';
    anim.pressClock = anim.clock;
    // a key clicks on the way down; on glass a tap clicks once, on the tap
    if (!anim.pressTouch) play('press');
  };
  /** The pointer came up over what it pressed: a tap on glass clicks now. */
  const release = (e: ThreeEvent<PointerEvent>) => {
    const tap = travelled(e) <= DRAG_PX;
    if (anim.pressTouch && tap) play('press');
    letGo(anim, play);
    // glass has no hover: what a finger touched is not left lit
    if (e.pointerType === 'touch') {
      if (anim.hover !== -1) onHoverChange?.(-1);
      anim.hover = -1;
      anim.slotHovered = -1;
      setCursor(false);
    }
  };

  // Hover, press and click on the packed agent instances: the instance id
  // is a slot, and the slot names its tile.
  const agentAt = (e: ThreeEvent<PointerEvent | MouseEvent>): number => {
    const slot = e.instanceId ?? -1;
    if (slot < 0) return -1;
    const agent = model.tiles[anim.agentTile[slot]]?.agent ?? -1;
    return agent >= 0 && agent < anim.agents ? agent : -1;
  };
  const hoverTile = (e: ThreeEvent<PointerEvent>) => {
    const agent = agentAt(e);
    if (agent >= 0) e.stopPropagation();
    // a press that travels is a drag turning the world: the key comes up
    if (anim.press >= 0 && travelled(e) > DRAG_PX) letGo(anim, play);
    if (agent !== anim.hover) {
      anim.hover = agent;
      setCursor(agent >= 0 || anim.slotHovered >= 0);
      if (agent >= 0 && e.pointerType !== 'touch') {
        const t = tileOfAgent[agent];
        if (t >= 0) anim.squashVelocity[t] += kicks.hover;
      }
      onHoverChange?.(agent);
    }
  };
  const leaveTile = () => {
    // pressed and slid off: the key comes back up
    if (anim.press >= 0) letGo(anim, play);
    if (anim.hover !== -1) {
      anim.hover = -1;
      setCursor(anim.slotHovered >= 0);
      onHoverChange?.(-1);
    }
  };
  const pressTile = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    const agent = agentAt(e);
    if (agent < 0) return;
    e.stopPropagation();
    anim.press = agent;
    hold(e);
  };
  const releaseTile = (e: ThreeEvent<PointerEvent>) => {
    if (anim.press >= 0) release(e);
  };
  // A click is a press that did not travel; a drag turned the world.
  const clickTile = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > DRAG_PX) return;
    const agent = agentAt(e);
    if (agent < 0) return;
    e.stopPropagation();
    // a click lands with a jolt, which a jelly feels most; a focus that
    // moves by itself (a new scene, Escape) does not
    const t = tileOfAgent[agent];
    if (t >= 0) anim.squashVelocity[t] += kicks.select;
    onSelect?.(agent);
  };
  const missTile = () => onSelect?.(-1);

  // The slots around a lone agent in the material study: they answer the
  // pointer like an agent does, and a click fills the cluster.
  const slotAt = (e: ThreeEvent<PointerEvent | MouseEvent>): number => {
    const id = e.instanceId ?? -1;
    return id >= 0 ? anim.tileOfGhost[id] : -1;
  };
  const hoverSlot = (e: ThreeEvent<PointerEvent>) => {
    if (!slotsLive) return;
    const tile = slotAt(e);
    if (tile >= 0) e.stopPropagation();
    if (anim.slotPressed >= 0 && travelled(e) > DRAG_PX) letGo(anim, play);
    if (tile !== anim.slotHovered) {
      anim.slotHovered = tile;
      setCursor(tile >= 0 || anim.hover >= 0);
    }
  };
  const leaveSlot = () => {
    if (anim.slotPressed >= 0) letGo(anim, play);
    if (anim.slotHovered !== -1) {
      anim.slotHovered = -1;
      setCursor(anim.hover >= 0);
    }
  };
  const pressSlot = (e: ThreeEvent<PointerEvent>) => {
    if (!slotsLive || e.button !== 0) return;
    const tile = slotAt(e);
    if (tile < 0) return;
    e.stopPropagation();
    anim.slotPressed = tile;
    hold(e);
  };
  const releaseSlot = (e: ThreeEvent<PointerEvent>) => {
    if (anim.slotPressed >= 0) release(e);
  };
  const clickSlot = (e: ThreeEvent<MouseEvent>) => {
    if (!slotsLive || e.delta > DRAG_PX) return;
    if (slotAt(e) < 0) return;
    e.stopPropagation();
    anim.slotHovered = -1;
    setCursor(anim.hover >= 0);
    onExpand?.();
  };

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    // The rig moved the camera this frame; refresh its matrices so every anchor
    // projected below lands on this frame's picture, not the last one's.
    state.camera.updateMatrixWorld();
    const d = drive.current;
    const ground = groundRef.current;
    const agents = agentsRef.current;
    const cores = coresRef.current;
    const lamps = lampsRef.current;
    const coins = coinsRef.current;
    const ghosts = ghostsRef.current;
    // only the material study has slots to press
    const slots = slotsRef.current;
    const rims = rimsRef.current;
    const glows = glowsRef.current;
    const pulses = pulsesRef.current;
    const orbs = orbsRef.current;
    const selection = selectionRef.current;
    const fadingRing = fadingRingRef.current;
    const partMeshes = partRefs.current;
    if (
      !ground ||
      !agents ||
      !cores ||
      !lamps ||
      !coins ||
      !ghosts ||
      !rims ||
      !glows ||
      !pulses ||
      !orbs ||
      !selection ||
      !fadingRing
    )
      return;
    for (let p = 0; p < parts.length; p += 1) if (!partMeshes[p]) return;
    const work = agents.geometry.getAttribute(
      'aWork'
    ) as THREE.InstancedBufferAttribute;
    const coreWork = cores.geometry.getAttribute(
      'aWork'
    ) as THREE.InstancedBufferAttribute;
    const wanderLight = agents.geometry.getAttribute(
      'aWander'
    ) as THREE.InstancedBufferAttribute;
    const coreWander = cores.geometry.getAttribute(
      'aWander'
    ) as THREE.InstancedBufferAttribute;

    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.agents = at.count;
    keepPickable(agents);
    if (slots) keepPickable(slots);
    anim.clock += delta;
    const clock = anim.clock;
    const attention = reducedMotion ? 0 : (Math.sin(clock * 2.2) + 1) * 0.5;
    // Stage states blend on the rail, with the camera.
    const b = stageBlend(d.rail, undefined, blendScratch);
    // Where a border is drawn the ring of slots beyond each Project would sit
    // across it, so only the slots inside the land are drawn there.
    const outlined =
      nameStyleOf(
        names,
        STAGES[b.t < 0.5 ? b.from : b.to],
        isNarrow(size.width, size.height)
      ) === 'border';
    const h0 = d.highlights[b.from] ?? null;
    const h1 = d.highlights[b.to] ?? null;
    const lifted = THREE.MathUtils.lerp(h0 ? 1 : 0, h1 ? 1 : 0, b.t);
    // Marks face the camera: turned about the tile normal so the page's up
    // is away from the viewer and its right is the viewer's right. The
    // sheen crosses the screen the same way on every tile.
    state.camera.getWorldDirection(forward);
    const facing = Math.atan2(-forward.x, -forward.z);
    yaw.setFromAxisAngle(yAxis, facing);
    turnSurfaceLight(surface, facing);
    const marked = mark !== 'off';
    const markDepth = marked ? MARK_DEPTH[mark] : 0;
    // A bright top face takes dark ink; a dark one takes light.
    const brightFace = spec.core || sig.bodyStatus === 1;
    const moving = !reducedMotion;
    const colorRate = reducedMotion ? 1 : 1 - Math.exp(-STATUS_RATE * delta);
    const liftSpring = jelly ? JELLY_LIFT_SPRING : LIFT_SPRING;
    const squashSpring = jelly ? JELLY_SQUASH_SPRING : SQUASH_SPRING;
    const pressSquash = jelly ? JELLY_PRESS_SQUASH : PRESS_SQUASH;
    // On glass a press shows once it has held a moment.
    const pressShown =
      anim.press >= 0 &&
      (!anim.pressTouch || clock - anim.pressClock >= TOUCH_PRESS_S)
        ? anim.press
        : -1;
    const slotPressShown =
      anim.slotPressed >= 0 &&
      (!anim.pressTouch || clock - anim.pressClock >= TOUCH_PRESS_S)
        ? anim.slotPressed
        : -1;

    let agentCount = 0;
    let groundCount = 0;
    let ghostCount = 0;
    let coreCount = 0;
    let lampCount = 0;
    let coinCount = 0;
    let rimCount = 0;
    let glowCount = 0;
    let pulseCount = 0;
    let orbCount = 0;
    // The open agent's ring eases in where it opened and out where it
    // closed; when the focus moves, the old ring eases out where it was.
    const selectedTile =
      d.selected >= 0 && d.selected < at.count ? tileOfAgent[d.selected] : -1;
    if (selectedTile >= 0 && selectedTile !== anim.ringTile) {
      if (anim.ringTile >= 0 && anim.ring > 0.02) {
        anim.fadingTile = anim.ringTile;
        anim.fading = anim.ring;
      }
      anim.ringTile = selectedTile;
      anim.ring = 0;
    }
    anim.fading = reducedMotion
      ? 0
      : THREE.MathUtils.damp(anim.fading, 0, RING_RATE, delta);
    anim.ring = reducedMotion
      ? selectedTile >= 0
        ? 1
        : 0
      : THREE.MathUtils.damp(
          anim.ring,
          selectedTile >= 0 ? 1 : 0,
          RING_RATE,
          delta
        );
    selection.visible = false;
    fadingRing.visible = false;
    anim.partCount.fill(0);
    for (let i = 0; i < tileCount; i += 1) {
      const tile = model.tiles[i];
      const place = placements[i];
      const present = at.tilePresent(tile);
      const isAgent = tile.agent >= 0 && tile.agent < at.count;
      const isGhost = at.tileGhost(tile);

      // Targets, eased: arriving, being an agent, the stage's weight.
      const scaleTarget = present ? 1 : 0;
      const agentTarget = isAgent ? 1 : 0;
      const weightTarget =
        isAgent && tile.agent >= 0
          ? THREE.MathUtils.lerp(
              highlightWeight(model.agents[tile.agent].status, h0),
              highlightWeight(model.agents[tile.agent].status, h1),
              b.t
            )
          : 1;
      const slotHoverTarget = slotsLive && isGhost && anim.slotHovered === i;
      const slotPressTarget = slotsLive && isGhost && slotPressShown === i;
      // An agent that is leaving keeps drawing as one while it fades.
      const known = tile.agent >= 0 ? model.agents[tile.agent] : null;
      if (reducedMotion) {
        anim.scale[i] = scaleTarget;
        anim.agentness[i] = agentTarget;
        anim.weight[i] = weightTarget;
        anim.slotHover[i] = slotHoverTarget ? 1 : 0;
        anim.slotPress[i] = slotPressTarget ? 1 : 0;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(
          anim.scale[i],
          scaleTarget,
          ARRIVE_RATE,
          delta
        );
        anim.agentness[i] = THREE.MathUtils.damp(
          anim.agentness[i],
          agentTarget,
          AGENT_RATE,
          delta
        );
        anim.weight[i] = THREE.MathUtils.damp(
          anim.weight[i],
          weightTarget,
          WEIGHT_RATE,
          delta
        );
        anim.slotHover[i] = THREE.MathUtils.damp(
          anim.slotHover[i],
          slotHoverTarget ? 1 : 0,
          SLOT_HOVER_RATE,
          delta
        );
        anim.slotPress[i] = THREE.MathUtils.damp(
          anim.slotPress[i],
          slotPressTarget ? 1 : 0,
          SLOT_PRESS_RATE,
          delta
        );
      }
      const s = anim.scale[i];
      const a = anim.agentness[i];
      const w = anim.weight[i];
      const slotHover = anim.slotHover[i];
      const slotPress = anim.slotPress[i];
      const agent = known !== null && a > AGENT_MIN ? known : null;
      const working =
        agent !== null && agent.status === 'active' && moving && a > 0.5;
      const phase = agent ? agent.id * 0.9 : 0;
      // Wander: where the light inside is, in the tile's own plane.
      const wandering = working && motion.wander;
      const wanderAngle = clock * WANDER_TURN + phase * 2.1;
      const wanderReach =
        WANDER_REACH * (0.86 + 0.14 * Math.sin(clock * 0.83 + phase));
      const lightX = wandering ? Math.cos(wanderAngle) * wanderReach : 0;
      const lightY = wandering ? Math.sin(wanderAngle) * wanderReach : 0;
      // Spin: the mark turns while it works and comes home after.
      if (working && motion.spin)
        anim.spin[i] = (anim.spin[i] + delta * SPIN_RATE) % (Math.PI * 2);
      else if (anim.spin[i] !== 0) {
        const home = Math.round(anim.spin[i] / (Math.PI * 2)) * (Math.PI * 2);
        anim.spin[i] = reducedMotion
          ? home
          : THREE.MathUtils.damp(anim.spin[i], home, SPIN_SETTLE, delta);
        if (Math.abs(anim.spin[i] - home) < 1e-3) anim.spin[i] = 0;
      }
      // Wave's phase is where the tile sits, so it travels; with Wave on,
      // a breath rides it.
      const wavePhase = clock * WAVE_RATE - (place.x * 0.5 + place.y * 0.32);
      const breath =
        working && motion.breathe
          ? breathAt(
              motion.lift === 'wave'
                ? wavePhase
                : (clock * Math.PI * 2) / BREATH_SECONDS + phase
            )
          : 0;
      const waveLight =
        working && motion.lift === 'wave' && !motion.breathe
          ? (Math.sin(wavePhase) + 1) * 0.5
          : 0;

      // A jelly jolts when its status changes.
      if (agent) {
        const key = STATUS_KEY[agent.status];
        if (anim.statusKey[i] !== 0 && anim.statusKey[i] !== key)
          anim.squashVelocity[i] += kicks.status;
        anim.statusKey[i] = key;
      } else anim.statusKey[i] = 0;

      let liftTarget = 0;
      let squashTarget = 0;
      if (agent) {
        liftTarget =
          agent.status === 'needs-you'
            ? 0.55
            : agent.status === 'active'
              ? 0.28
              : agent.status === 'result'
                ? 0.2
                : 0.08;
        liftTarget *= 0.4 + 0.6 * weightTarget;
        liftTarget += 0.25 * lifted * weightTarget;
        // the stage's exemplar stands up; the agent in focus stands taller
        // (and is often the exemplar: the two do not stack)
        liftTarget += Math.max(
          tile.agent === d.exemplar ? 0.2 : 0,
          tile.agent === d.selected ? SELECT_LIFT : 0
        );
        if (tile.agent === anim.hover) liftTarget += HOVER_LIFT;
        // a key goes down from wherever it stood, and bottoms out
        if (tile.agent === pressShown) {
          liftTarget = Math.max(0, liftTarget - PRESS_DEPTH);
          squashTarget = -pressSquash;
        }
        liftTarget *= spec.liftScale * sig.liftScale;
        if (working && motion.lift === 'bob')
          liftTarget += (Math.sin(clock * BOB_RATE + phase) + 1) * BOB_LIFT;
        if (working && motion.lift === 'wave')
          liftTarget += (Math.sin(wavePhase) + 1) * WAVE_LIFT;
        liftTarget += breath * BREATH_LIFT;
        liftTarget *= a;
      } else if (present && slotsLive) {
        // a slot on territory leans up toward the pointer, and gives under it
        liftTarget = 0.07 * slotHover - 0.05 * slotPress;
      }
      if (reducedMotion) {
        anim.lift[i] = liftTarget;
        anim.liftVelocity[i] = 0;
        anim.squash[i] = squashTarget;
        anim.squashVelocity[i] = 0;
      } else {
        stepSpring(
          anim.lift,
          anim.liftVelocity,
          i,
          liftTarget,
          liftSpring,
          delta
        );
        stepSpring(
          anim.squash,
          anim.squashVelocity,
          i,
          squashTarget,
          squashSpring,
          delta
        );
      }

      // The body's height and width: the lift raises it along the normal,
      // a squeeze trades height for width at the same volume, a breath
      // draws in a little of both.
      const stretch = Math.max(0.5, 1 + anim.squash[i]);
      const pinch = (1 / Math.sqrt(stretch)) * (1 + breath * BREATH_SWELL);
      const thickness = Math.max(0.6, 1 + anim.lift[i] * 2.4) * stretch;
      const bodyHeight = TILE_HEIGHT * thickness;
      const bodyTop = bodyHeight - TILE_HEIGHT / 2;

      // The ghost ring: the next slots out, drawn as outlines, each with its
      // face (dark until the pointer finds it).
      // Under Border the outline is the Project's edge; the ring of slots
      // beyond it would sit across the line, so only the slots inside it
      // are drawn.
      const ghostTarget = isGhost && (present || !outlined) ? 1 : 0;
      anim.ghost[i] = reducedMotion
        ? ghostTarget
        : THREE.MathUtils.damp(anim.ghost[i], ghostTarget, 7, delta);
      normal.copy(place.position).sub(SPHERE_CENTER).normalize();
      // Arriving and leaving: the tile rises out of the globe or sinks into
      // it, everything that stands on it with it.
      const foot = FOOT_MIN + (1 - FOOT_MIN) * s;
      origin
        .copy(place.position)
        .addScaledVector(normal, -(1 - s) * (bodyHeight + SINK_CLEAR));
      if (anim.ghost[i] > 0.02) {
        const g = anim.ghost[i];
        dummy.position
          .copy(present ? origin : place.position)
          .addScaledVector(normal, present ? bodyTop + 0.04 : 0.04);
        dummy.quaternion.copy(place.quaternion);
        const gs = g * (1 + 0.05 * slotHover - 0.05 * slotPress);
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        ghosts.setMatrixAt(ghostCount, dummy.matrix);
        color
          .copy(palette.ghost)
          .multiplyScalar(
            (0.55 + 0.45 * g) * (1 + 0.9 * slotHover + 0.4 * slotPress)
          );
        ghosts.setColorAt(ghostCount, color);
        if (slots) {
          slots.setMatrixAt(ghostCount, dummy.matrix);
          color
            .copy(palette.ghost)
            .multiplyScalar(0.16 * slotHover + 0.12 * slotPress);
          slots.setColorAt(ghostCount, color);
        }
        anim.tileOfGhost[ghostCount] = i;
        ghostCount += 1;
      }

      if (s < SCALE_MIN) {
        anim.statusReady[i] = 0;
        continue;
      }

      // The body: territory in the ground mesh, agents in the body mesh,
      // lifted along the normal so the tile grows outward from the sphere.
      dummy.position
        .copy(origin)
        .addScaledVector(normal, (bodyHeight - TILE_HEIGHT) / 2);
      dummy.quaternion.copy(place.quaternion);

      if (!agent) {
        anim.statusReady[i] = 0;
        dummy.scale.set(foot, thickness, foot);
        dummy.updateMatrix();
        ground.setMatrixAt(groundCount, dummy.matrix);
        color.copy(palette.ground);
        // Territory tiles nearest the agents are a touch brighter.
        color.lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12);
        color.lerp(FROST, spec.groundPale);
        color.lerp(palette.label, 0.08 * slotHover);
        ground.setColorAt(groundCount, color);
        groundCount += 1;
        continue;
      }

      const wide = foot * pinch;
      dummy.scale.set(wide, thickness, wide);
      dummy.updateMatrix();

      // An agent. Its status colour eases toward the new one on a change.
      const target = palette.status[agent.status];
      const si = i * 3;
      if (!anim.statusReady[i]) {
        anim.status[si] = target.r;
        anim.status[si + 1] = target.g;
        anim.status[si + 2] = target.b;
        anim.statusReady[i] = 1;
      } else {
        anim.status[si] += (target.r - anim.status[si]) * colorRate;
        anim.status[si + 1] += (target.g - anim.status[si + 1]) * colorRate;
        anim.status[si + 2] += (target.b - anim.status[si + 2]) * colorRate;
      }
      statusColor.setRGB(
        anim.status[si],
        anim.status[si + 1],
        anim.status[si + 2]
      );

      // How alive the tile is: arrival and being an agent, for everything
      // that stands on it; and how wide it stands this frame.
      const sa = foot * a;
      const sw = sa * pinch;

      agents.setMatrixAt(agentCount, dummy.matrix);
      anim.agentTile[agentCount] = i;
      color.copy(statusColor);
      color.lerp(WHITE, spec.pastel);
      color.lerp(METAL, 1 - spec.bodyTint);
      color.lerp(palette.neutral, 1 - sig.bodyStatus);
      color.lerp(palette.dim, (1 - w) * (sig.bodyStatus ? 0.78 : 0.45));
      // lit by the pointer: a hover lights it, the open agent stays lit, and
      // a key held down sits a shade under the light
      if (tile.agent === pressShown) color.lerp(palette.label, 0.05);
      else if (tile.agent === anim.hover || tile.agent === d.selected)
        color.lerp(palette.label, 0.12);
      // fade to ground as the agent leaves, toward the ground's own colour
      if (a < 1) {
        groundColor
          .copy(palette.ground)
          .lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12)
          .lerp(FROST, spec.groundPale);
        color.lerp(groundColor, 1 - a);
      }
      agents.setColorAt(agentCount, color);
      // the light on its surface: the sheen's phase and strength, and the
      // glow of its own colour a breath or a wave gives it
      const sheenStrength = working && motion.sheen ? 0.9 * (0.5 + 0.5 * w) : 0;
      const sheenAt =
        sheenStrength > 0 ? sheenPhase(clock, agent.id * 0.173) : 0;
      const glow = (breath * BREATH_GLOW + waveLight * WAVE_GLOW) * w;
      work.setXYZW(agentCount, sheenAt, sheenStrength, glow, 0);
      const lightGlow = wandering ? WANDER_GLOW * (0.5 + 0.5 * w) : 0;
      wanderLight.setXYZ(agentCount, lightX, lightY, lightGlow);
      agentCount += 1;

      // Where things stand: the face the marks and lamps sit on. In the
      // translucent options that is the lit cap, which is fixed above the
      // body's top at every lift.
      const faceTop = spec.core ? bodyTop + CAP_PROUD : bodyTop;

      // The lit cap of light inside the body.
      if (spec.core) {
        const capHeight = bodyHeight * CAP_SHARE + CAP_PROUD;
        dummy.position
          .copy(origin)
          .addScaledVector(normal, bodyTop + CAP_PROUD - capHeight / 2);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(sw * 0.9, sa * capHeight, sw * 0.9);
        dummy.updateMatrix();
        cores.setMatrixAt(coreCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          (0.9 +
            1.1 * w +
            (agent.status === 'needs-you' ? attention * 0.8 * w : 0) +
            breath * 0.6 +
            waveLight * 0.25) *
            (wandering ? WANDER_CAP : 1)
        );
        cores.setColorAt(coreCount, color);
        coreWork.setXYZW(coreCount, sheenAt, sheenStrength, 0, 0);
        coreWander.setXYZ(coreCount, lightX, lightY, lightGlow);
        coreCount += 1;
        // the wandering light itself, inside the clear body, beside the cap
        if (wandering) {
          side.set(lightX, 0, lightY).applyQuaternion(place.quaternion);
          dummy.position
            .copy(origin)
            .add(side)
            .addScaledVector(normal, bodyTop - bodyHeight * 0.42);
          const r = sa * ORB_RADIUS;
          dummy.scale.set(r, r, r);
          dummy.updateMatrix();
          orbs.setMatrixAt(orbCount, dummy.matrix);
          color.copy(statusColor).lerp(WHITE, 0.35);
          color.multiplyScalar(ORB_GLOW * (0.5 + 0.5 * w));
          orbs.setColorAt(orbCount, color);
          orbCount += 1;
        }
      }

      // The harness mark, facing the camera, part by part.
      const markIndex = marked ? markOfAgent[agent.id] : -1;
      if (markIndex >= 0) {
        const onCoin = mark === 'coin';
        dummy.quaternion.copy(place.quaternion).multiply(yaw);
        if (anim.spin[i] !== 0)
          dummy.quaternion.multiply(
            spinTurn.setFromAxisAngle(yAxis, anim.spin[i])
          );
        const ms = sw * (onCoin ? MARK_SIZE * 0.78 : MARK_SIZE);
        for (let p = 0; p < parts.length; p += 1) {
          const part = parts[p];
          if (part.mark !== markIndex) continue;
          const mesh = partMeshes[p] as THREE.InstancedMesh;
          const slot = anim.partCount[p];
          anim.partCount[p] = slot + 1;
          dummy.position
            .copy(origin)
            .addScaledVector(
              normal,
              faceTop +
                LIFT_OFF +
                (onCoin ? COIN_HEIGHT : 0) +
                part.layer * LAYER_STEP * markDepth
            );
          dummy.scale.set(ms, sa * markDepth, ms);
          dummy.updateMatrix();
          mesh.setMatrixAt(slot, dummy.matrix);
          // Tone: the vendor's colour, the artwork's own, or the vendor's
          // black or white ink, never the status.
          const tone = part.tone;
          if (tone === 'ink') {
            color.copy(onCoin || brightFace ? INK : PAPER);
            color.lerp(statusColor, INK_TINT);
            if (mark === 'lit' && !onCoin && !brightFace)
              color.multiplyScalar(0.62 + 0.38 * w);
          } else {
            color.copy(tone);
          }
          // a mark steps back with its agent, and with the world behind type
          color.lerp(palette.dim, (1 - w) * 0.5);
          mesh.setColorAt(slot, color);
        }
        if (onCoin) {
          dummy.position
            .copy(origin)
            .addScaledVector(normal, faceTop + LIFT_OFF + COIN_HEIGHT / 2);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(sw, sa, sw);
          dummy.updateMatrix();
          coins.setMatrixAt(coinCount, dummy.matrix);
          color.copy(COIN).lerp(palette.dim, (1 - w) * 0.5);
          coins.setColorAt(coinCount, color);
          coinCount += 1;
        }
      }

      // The status lamp: the whole top when there is no mark, a small
      // light below the mark (toward the viewer) when there is one. The
      // rim treatment carries the status on the edge and shows no lamp
      // beside a mark.
      const lampOn = !(marked && markIndex >= 0 && (sig.rim || sig.bodyStatus));
      if (lampOn) {
        const beside = marked && markIndex >= 0;
        dummy.position.copy(origin).addScaledVector(normal, faceTop + LIFT_OFF);
        dummy.quaternion.copy(place.quaternion).multiply(yaw);
        if (beside) {
          side.set(0, 0, 0.6 * pinch).applyQuaternion(dummy.quaternion);
          dummy.position.add(side);
        }
        const ls =
          sw * (beside ? 0.2 : (0.75 + 0.25 * w) * sig.glyphScale * 1.12);
        dummy.scale.set(ls, sa * 0.05, ls);
        dummy.updateMatrix();
        lamps.setMatrixAt(lampCount, dummy.matrix);
        // A lit lamp: the status hue carried toward white, never past it,
        // so amber stays amber instead of clipping to cream.
        color.copy(statusColor);
        const lit =
          0.22 +
          0.2 * w +
          (agent.status === 'needs-you' ? attention * 0.25 * w : 0);
        color.lerp(WHITE, Math.min(0.6, lit * spec.inlayGlow));
        color.multiplyScalar(0.75 + 0.35 * w + breath * 0.25);
        // a quiet mark when the signal lives elsewhere on the tile
        if (sig.glyphStatus < 1)
          color.copy(palette.neutral).lerp(palette.label, 0.22 + 0.1 * w);
        lamps.setColorAt(lampCount, color);
        lampCount += 1;
      }

      // Rim: the status as a lit band around the top edge.
      if (sig.rim) {
        dummy.position.copy(origin).addScaledVector(normal, bodyTop - 0.09);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(sw, 1, sw);
        dummy.updateMatrix();
        rims.setMatrixAt(rimCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          0.45 +
            0.55 * w +
            (agent.status === 'needs-you' ? attention * 0.35 * w : 0) +
            breath * 0.3
        );
        color.lerp(palette.dim, (1 - w) * 0.6);
        rims.setColorAt(rimCount, color);
        rimCount += 1;
      }

      // Lamp: a glow under the tile.
      if (sig.underglow) {
        dummy.position.copy(origin).addScaledVector(normal, 0.06);
        dummy.quaternion.copy(place.quaternion);
        // under Wander the light under the tile goes round with the one in it
        if (wandering) {
          side
            .set(lightX * WANDER_SPILL, 0, lightY * WANDER_SPILL)
            .applyQuaternion(place.quaternion);
          dummy.position.add(side);
        }
        const gs = sa * (0.8 + 0.3 * w + attention * 0.08 * w + breath * 0.1);
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        glows.setMatrixAt(glowCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          0.2 +
            0.5 * w +
            (agent.status === 'needs-you' ? attention * 0.3 * w : 0) +
            breath * 0.25 +
            (wandering ? 0.2 * w : 0)
        );
        glows.setColorAt(glowCount, color);
        glowCount += 1;
      }

      // Pulse: a faint ring leaves the top edge and is gone before it
      // reaches a neighbour.
      if (working && motion.pulse) {
        const ph = (clock * PULSE_PER_SECOND + phase * 0.37) % 1;
        dummy.position
          .copy(origin)
          .addScaledVector(normal, faceTop + LIFT_OFF * 3);
        dummy.quaternion.copy(place.quaternion);
        const ps = sw * (0.94 + ph * PULSE_REACH);
        dummy.scale.set(ps, 1, ps);
        dummy.updateMatrix();
        pulses.setMatrixAt(pulseCount, dummy.matrix);
        const fade = (1 - ph) * (1 - ph);
        color.copy(statusColor).lerp(WHITE, 0.3);
        color.multiplyScalar(fade * Math.min(1, ph * 8) * (0.1 + 0.12 * w));
        pulses.setColorAt(pulseCount, color);
        pulseCount += 1;
      }

      // Selection: the product's ring on the ground around the tile, easing
      // in where it opened and out where it closed.
      if (i === anim.ringTile && anim.ring > 0.01 && isAgent) {
        selection.visible = true;
        selection.position
          .copy(origin)
          .addScaledVector(normal, TILE_HEIGHT / 2 + 0.05);
        selection.quaternion.copy(place.quaternion);
        const rs = foot * (0.9 + 0.1 * anim.ring);
        selection.scale.set(rs, 1, rs);
        (selection.material as THREE.MeshBasicMaterial).opacity = anim.ring;
      }
      if (i === anim.fadingTile && anim.fading > 0.01 && isAgent) {
        fadingRing.visible = true;
        fadingRing.position
          .copy(origin)
          .addScaledVector(normal, TILE_HEIGHT / 2 + 0.05);
        fadingRing.quaternion.copy(place.quaternion);
        fadingRing.scale.set(foot, 1, foot);
        (fadingRing.material as THREE.MeshBasicMaterial).opacity = anim.fading;
      }
    }
    for (let g = ghostCount; g < tileCount; g += 1) anim.tileOfGhost[g] = -1;

    flush(ground, groundCount);
    flush(agents, agentCount);
    flush(ghosts, ghostCount);
    if (slots) flush(slots, ghostCount);
    flush(cores, coreCount);
    flush(lamps, lampCount);
    flush(coins, coinCount);
    flush(rims, rimCount);
    flush(glows, glowCount);
    flush(pulses, pulseCount);
    flush(orbs, orbCount);
    flushWork(work, agentCount);
    flushWork(coreWork, coreCount);
    flushWork(wanderLight, agentCount);
    flushWork(coreWander, coreCount);
    for (let p = 0; p < parts.length; p += 1)
      flush(partMeshes[p] as THREE.InstancedMesh, anim.partCount[p]);

    // Anchors for the DOM overlay: the selected agent, while it is here.
    const anchors = anchor;
    if (
      selectedTile >= 0 &&
      anim.agentness[selectedTile] > 0.5 &&
      anim.scale[selectedTile] > 0.5
    ) {
      const place = placements[selectedTile];
      normal.copy(place.position).sub(SPHERE_CENTER).normalize();
      const top =
        TILE_HEIGHT * (1 + anim.lift[selectedTile] * 2.4) - TILE_HEIGHT / 2;
      tmp.copy(place.position).addScaledVector(normal, top + 0.3);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        anchors.setFocus(d.selected, point.x, point.y);
      } else anchors.clearFocus();
    } else anchors.clearFocus();
    // Each Project's land, eased as the fleet grows; the names pinned to it
    // and, under Border, the outline itself.
    // The borders show on the stages that draw them, and step aside while
    // the camera moves between stages: a border that shrank or grew on
    // screen as the fleet changed size was most of what made a move busy
    // (operator 2026-10-13: "Too many things are happening with the
    // circle").
    const still = 1 - 4 * b.t * (1 - b.t);
    const borderShown =
      nameShown(names, 'border', d.rail, isNarrow(size.width, size.height)) *
      still *
      still;
    easeBorders(
      model,
      // the size of the land at the nearer end of the move: it changes at
      // the middle, where the border is out of sight, not on screen as the
      // agents arrive
      closeUp ? at.count : STAGES[b.t < 0.5 ? b.from : b.to].count,
      borderState.rings,
      borderState.fades,
      delta,
      reducedMotion,
      borderShown
    );
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      anchors,
      // clear of a lifted agent, which stands three tile heights tall
      TILE_HEIGHT + 1.4,
      names === 'float' ? null : borderState.rim
    );
    const borders = bordersRef.current;
    if (borders)
      drawBorders(
        borders.geometry,
        model,
        placements,
        centerTiles(model),
        borderState.rings,
        borderState.fades,
        borderShown,
        anchors.labels,
        state.camera,
        palette.label,
        borderState.drawn
      );
  });

  return (
    <>
      <color attach="background" args={[theme.canvas]} />
      <fog attach="fog" args={[theme.canvas, 60, 160]} />
      <hemisphereLight args={[0xcfe6ff, 0x101420, 0.9 * spec.lightScale]} />
      <directionalLight
        position={[30, 60, 20]}
        intensity={1.6 * spec.lightScale}
      />
      <directionalLight
        position={[-40, 20, -30]}
        intensity={0.35 * spec.lightScale}
      />

      <GlobeBody palette={palette} graticule={0.1} />

      <instancedMesh
        ref={groundRef}
        args={[geometry, spec.ground, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      />

      <instancedMesh
        ref={agentsRef}
        args={[agentGeometry, spec.agent, tileCount]}
        onPointerMove={hoverTile}
        onPointerOut={leaveTile}
        onPointerDown={pressTile}
        onPointerUp={releaseTile}
        onClick={clickTile}
        onPointerMissed={missTile}
        frustumCulled={false}
      />

      <instancedMesh
        ref={coresRef}
        args={[coreGeometry, coreMaterial, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      />

      {/* The lamp is drawn after the translucent bodies, so a bright lamp
          never refracts through a neighbour as a trail of dots. */}
      <instancedMesh
        ref={lampsRef}
        args={[lampGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} transparent />
      </instancedMesh>

      {parts.map((part, p) => (
        <instancedMesh
          key={p}
          ref={el => {
            partRefs.current[p] = el;
          }}
          args={[
            part.geometry,
            mark === 'relief'
              ? paintMaterial
              : mark === 'coin'
                ? part.tone === 'ink'
                  ? coinMaterial
                  : paintMaterial
                : undefined,
            tileCount,
          ]}
          raycast={() => null}
          frustumCulled={false}
        >
          {mark === 'relief' || mark === 'coin' ? null : (
            <meshBasicMaterial toneMapped={false} />
          )}
        </instancedMesh>
      ))}

      <instancedMesh
        ref={coinsRef}
        args={[coinGeometry, coinMaterial, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      />

      <instancedMesh
        ref={ghostsRef}
        args={[ghostGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={0.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {onExpand ? (
        <instancedMesh
          ref={slotsRef}
          args={[slotGeometry, undefined, tileCount]}
          onPointerMove={hoverSlot}
          onPointerOut={leaveSlot}
          onPointerDown={pressSlot}
          onPointerUp={releaseSlot}
          onClick={clickSlot}
          frustumCulled={false}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </instancedMesh>
      ) : null}

      <instancedMesh
        ref={rimsRef}
        args={[rimGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
      </instancedMesh>

      <instancedMesh
        ref={glowsRef}
        args={[glowGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial
          map={glowTexture}
          toneMapped={false}
          transparent
          opacity={0.7}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      <instancedMesh
        ref={orbsRef}
        args={[orbGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={pulsesRef}
        args={[pulseGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial
          toneMapped={false}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {names === 'border' || names === 'auto' ? (
        <mesh
          ref={bordersRef}
          geometry={borderGeometry}
          raycast={() => null}
          frustumCulled={false}
        >
          <meshBasicMaterial
            vertexColors
            toneMapped={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}

      {/* Drawn after the glass, like the lamps, so the ring never refracts
          through the lifted body above it as a trail of dots. */}
      <mesh
        ref={selectionRef}
        geometry={selectionGeometry}
        raycast={() => null}
        frustumCulled={false}
        visible={false}
      >
        <meshBasicMaterial
          color={palette.selection}
          toneMapped={false}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        ref={fadingRingRef}
        geometry={selectionGeometry}
        raycast={() => null}
        frustumCulled={false}
        visible={false}
      >
        <meshBasicMaterial
          color={palette.selection}
          toneMapped={false}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}
