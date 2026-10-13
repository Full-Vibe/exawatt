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
 * own mark extruded on the face in the vendor's own tones (W15f/g,
 * `crust-marks.ts`), turned to face the camera, and, while it works, one of
 * five motions (W15g, `crust-motion.ts`). The ring beyond the territory is
 * drawn as ghost outlines; in the material study a click on one adds an
 * agent. The sphere body underneath is a dark globe with faint graticule so
 * even a one-agent slice reads as a piece of something round.
 *
 * What changes does so continuously (W15h): an agent arriving or leaving
 * fades between agent and ground, a status change cross-fades its colour, a
 * lift eases; nothing pops. Only what is drawn is submitted: tiles are packed
 * into the instance buffers each frame, and only the packed range is
 * uploaded, so ten agents cost ten agents.
 *
 * Per-frame work mutates preallocated arrays and writes instance buffers.
 * Nothing of ours allocates in `useFrame`; three keeps a small record per
 * uploaded range, which it clears on upload.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt, sourceAdapterId } from '../fleet-model';
import { SPHERE_CENTER } from '../sphere';
import { stageBlend } from '../stages';
import type { VisualProps } from '../visual-contract';
import { makeMarkParts, markIndexFor } from './crust-marks';
import { disposeCrustMaterial, makeCrustMaterial } from './crust-materials';
import { sheenPhase, makeSheenMaterial } from './crust-sheen';
import {
  shapeCorner,
  tileBandGeometry,
  tileFaceGeometry,
  tilePrismGeometry,
  tileRingGeometry,
  tileSlabGeometry,
} from './crust-shape';
import { crustSignal } from './crust-signal';
import { keepPickable } from './pick-bounds';
import { useRoomEnvironment } from './environment';
import { GlobeBody } from './globe-body';
import {
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
} from './shared';

/** Circumradius of a tile on a grid of circumradius 1: the gap between
 *  tiles is what is left (operator 2026-10-12: "a little bit more spacing
 *  between all the hex tiles"). */
const TILE_RADIUS = 0.82;
const TILE_HEIGHT = 0.42;
/** Width of a harness mark on the face, and its depth by treatment. */
const MARK_SIZE = 0.78;
const MARK_DEPTH = { lit: 0.05, relief: 0.09, coin: 0.07 } as const;
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
/** How fast a tile answers, per second: rise, status weight, arrival, being
 *  an agent at all, and the colour of its status. Quick, so a click lands and
 *  a hover answers at once (operator 2026-10-12: "more snappy and less
 *  mushy"), yet nothing is a cut. */
const LIFT_RATE = 13;
const WEIGHT_RATE = 9;
const ARRIVE_RATE = 9;
const AGENT_RATE = 8;
const STATUS_RATE = 14;
/** Below this an agent is drawn as ground; a tile this small is not drawn. */
const AGENT_MIN = 0.02;
const SCALE_MIN = 0.004;

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const statusColor = new THREE.Color();
const groundColor = new THREE.Color();
const tmp = new THREE.Vector3();
const normal = new THREE.Vector3();
const side = new THREE.Vector3();
const forward = new THREE.Vector3();
const yaw = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
const point = { x: 0, y: 0 };
const WHITE = new THREE.Color(0xffffff);
/** Neutral body for the metal option; the status lives on the lamp. */
const METAL = new THREE.Color(0x8a9199);
/** Frosted clear ground for the acrylic option. */
const FROST = new THREE.Color(0xb9d2e4);
/** A light coin, and the dark ink a mark takes on any bright face: the
 *  coin, a lit translucent body, a body painted in its status colour. On a
 *  dark neutral body the ink is the label's light. */
const COIN = new THREE.Color(0xd9dde3);
const INK = new THREE.Color(0x1b2027);
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
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    /** 0 a tile of ground, 1 an agent; eases, so arriving and leaving fade. */
    agentness: new Float32Array(tileCount),
    /** The eased colour of the status, linear rgb per tile. */
    status: new Float32Array(tileCount * 3),
    statusReady: new Uint8Array(tileCount),
    punch: new Float32Array(tileCount),
    partCount: new Int32Array(partCount),
    /** Which tile each packed slot draws, for picking. */
    agentTile: new Int32Array(tileCount),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    /** Agents in the fleet right now: an agent past this is leaving. */
    agents: 0,
    clock: 0,
    hover: -1,
    lastSelected: -1,
  };
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
  onHoverChange,
  onSelect,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileCount = model.tiles.length;
  const spec = useMemo(() => makeCrustMaterial(material), [material]);
  const sig = useMemo(() => crustSignal(signal), [signal]);
  const corner = shapeCorner(shape);
  useEffect(() => () => disposeCrustMaterial(spec), [spec]);
  useRoomEnvironment(spec.environment, light);

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
  const rimsRef = useRef<THREE.InstancedMesh>(null);
  const glowsRef = useRef<THREE.InstancedMesh>(null);
  const sheensRef = useRef<THREE.InstancedMesh>(null);
  const pulsesRef = useRef<THREE.InstancedMesh>(null);
  const selectionRef = useRef<THREE.Mesh>(null);

  // Per-tile animated state, preallocated once and mutated in place. It
  // outlives a change of model (the material study swaps the hero's status
  // in place), so a tile keeps its rise and its weight across the swap.
  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
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

  const geometry = useMemo(
    () => tilePrismGeometry(TILE_RADIUS, TILE_HEIGHT, corner, spec.edge),
    [spec.edge, corner]
  );
  const coreGeometry = useMemo(
    () => tilePrismGeometry(0.42, 1, corner, null),
    [corner]
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
  // A mark in a colour of its own (Claude's terracotta, the mascot's coral)
  // is solid paint, lit like a stamped enamel, so its colour is the vendor's
  // and not the vendor's blended with the glass it stands on.
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
  // Working motion: a ring that leaves the tile, and the sheen's face, which
  // carries one phase per instance.
  const pulseGeometry = useMemo(
    () => tileRingGeometry(TILE_RADIUS + 0.02, TILE_RADIUS - 0.07, corner),
    [corner]
  );
  const sheenGeometry = useMemo(() => {
    const g = tileFaceGeometry(TILE_RADIUS * 0.97, corner);
    g.setAttribute(
      'aPhase',
      new THREE.InstancedBufferAttribute(new Float32Array(tileCount), 1)
    );
    return g;
  }, [corner, tileCount]);
  const sheenMaterial = useMemo(() => makeSheenMaterial(), []);

  useEffect(
    () => () => {
      geometry.dispose();
    },
    [geometry]
  );
  useEffect(
    () => () => {
      coreGeometry.dispose();
      ghostGeometry.dispose();
      rimGeometry.dispose();
      selectionGeometry.dispose();
      pulseGeometry.dispose();
      sheenGeometry.dispose();
      lampGeometry.dispose();
    },
    [
      coreGeometry,
      ghostGeometry,
      rimGeometry,
      selectionGeometry,
      pulseGeometry,
      sheenGeometry,
      lampGeometry,
    ]
  );
  useEffect(
    () => () => {
      parts.forEach(part => part.geometry.dispose());
      coinGeometry.dispose();
      coinMaterial.dispose();
      paintMaterial.dispose();
      glowGeometry.dispose();
      glowTexture.dispose();
      sheenMaterial.dispose();
    },
    [
      parts,
      coinGeometry,
      coinMaterial,
      paintMaterial,
      glowGeometry,
      glowTexture,
      sheenMaterial,
    ]
  );

  // Hover and click on the packed agent instances: the instance id is a
  // slot, and the slot names its tile.
  const agentAt = (e: ThreeEvent<PointerEvent | MouseEvent>): number => {
    const slot = e.instanceId ?? -1;
    if (slot < 0) return -1;
    const agent = model.tiles[anim.agentTile[slot]]?.agent ?? -1;
    return agent >= 0 && agent < anim.agents ? agent : -1;
  };
  const hoverTile = (e: ThreeEvent<PointerEvent>) => {
    const agent = agentAt(e);
    if (agent !== anim.hover) {
      anim.hover = agent;
      gl.domElement.style.setProperty('cursor', agent >= 0 ? 'pointer' : '');
      onHoverChange?.(agent);
    }
  };
  const leaveTile = () => {
    if (anim.hover !== -1) {
      anim.hover = -1;
      gl.domElement.style.setProperty('cursor', '');
      onHoverChange?.(-1);
    }
  };
  // A click is a press that did not travel; a drag turned the world.
  const clickTile = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    const agent = agentAt(e);
    if (agent < 0) return;
    e.stopPropagation();
    onSelect?.(agent);
  };
  const missTile = () => onSelect?.(-1);
  const clickGhost = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 6) return;
    const id = e.instanceId ?? -1;
    if (id >= 0 && anim.tileOfGhost[id] >= 0) {
      e.stopPropagation();
      onExpand?.();
    }
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
    const rims = rimsRef.current;
    const glows = glowsRef.current;
    const sheens = sheensRef.current;
    const pulses = pulsesRef.current;
    const selection = selectionRef.current;
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
      !sheens ||
      !pulses ||
      !selection
    )
      return;
    for (let p = 0; p < parts.length; p += 1) if (!partMeshes[p]) return;
    const phaseAttr = sheens.geometry.getAttribute(
      'aPhase'
    ) as THREE.InstancedBufferAttribute;

    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.agents = at.count;
    keepPickable(agents);
    keepPickable(ghosts);
    anim.clock += delta;
    const clock = anim.clock;
    const attention = reducedMotion ? 0 : (Math.sin(clock * 2.2) + 1) * 0.5;
    const recede = d.recede;
    // Stage states blend on the rail, with the camera.
    const b = stageBlend(d.rail, undefined, blendScratch);
    const h0 = d.highlights[b.from] ?? null;
    const h1 = d.highlights[b.to] ?? null;
    const lifted = THREE.MathUtils.lerp(h0 ? 1 : 0, h1 ? 1 : 0, b.t);
    // Marks face the camera: turned about the tile normal so the page's up
    // is away from the viewer and its right is the viewer's right.
    state.camera.getWorldDirection(forward);
    yaw.setFromAxisAngle(yAxis, Math.atan2(-forward.x, -forward.z));
    const marked = mark !== 'off';
    const markDepth = marked ? MARK_DEPTH[mark] : 0;
    // A bright top face takes dark ink; a dark one takes light.
    const brightFace = spec.core || sig.bodyStatus === 1;
    const moving = !reducedMotion;
    const colorRate = reducedMotion ? 1 : 1 - Math.exp(-STATUS_RATE * delta);

    let agentCount = 0;
    let groundCount = 0;
    let ghostCount = 0;
    let coreCount = 0;
    let lampCount = 0;
    let coinCount = 0;
    let rimCount = 0;
    let glowCount = 0;
    let sheenCount = 0;
    let pulseCount = 0;
    selection.visible = false;
    // A click lands with a short bounce.
    if (d.selected !== anim.lastSelected) {
      anim.lastSelected = d.selected;
      const t = d.selected >= 0 ? tileOfAgent[d.selected] : -1;
      if (t >= 0) anim.punch[t] = 1;
    }
    anim.partCount.fill(0);
    for (let i = 0; i < tileCount; i += 1) {
      const tile = model.tiles[i];
      const place = placements[i];
      const present = at.tilePresent(tile);
      const isAgent = tile.agent >= 0 && tile.agent < at.count;

      // Targets, eased: arriving, being an agent, rising, the stage's weight.
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
      // An agent that is leaving keeps drawing as one while it fades.
      const known = tile.agent >= 0 ? model.agents[tile.agent] : null;
      if (reducedMotion) {
        anim.scale[i] = scaleTarget;
        anim.agentness[i] = agentTarget;
        anim.weight[i] = weightTarget;
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
      }
      const s = anim.scale[i];
      const a = anim.agentness[i];
      const w = anim.weight[i];
      const agent = known !== null && a > AGENT_MIN ? known : null;
      const working =
        agent !== null && agent.status === 'active' && moving && a > 0.5;
      const phase = agent ? agent.id * 0.9 : 0;

      let liftTarget = 0;
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
        if (tile.agent === d.exemplar) liftTarget += 0.2;
        if (tile.agent === anim.hover) liftTarget += 0.12;
        if (tile.agent === d.selected) liftTarget += 0.3;
        liftTarget *= spec.liftScale * sig.liftScale;
        if (working && motion === 'bob')
          liftTarget += (Math.sin(clock * 1.7 + phase) + 1) * 0.06;
        if (working && motion === 'wave')
          liftTarget +=
            (Math.sin(clock * 1.5 - (place.x * 0.5 + place.y * 0.32)) + 1) *
            0.05;
        if (anim.punch[i] > 0) {
          anim.punch[i] = Math.max(0, anim.punch[i] - delta * 4);
          liftTarget += Math.sin(anim.punch[i] * Math.PI) * 0.3;
        }
        liftTarget *= a;
      }
      anim.lift[i] = reducedMotion
        ? liftTarget
        : THREE.MathUtils.damp(anim.lift[i], liftTarget, LIFT_RATE, delta);

      // The ghost ring: the next slots out, drawn as outlines.
      const ghostTarget = at.tileGhost(tile) ? 1 : 0;
      anim.ghost[i] = reducedMotion
        ? ghostTarget
        : THREE.MathUtils.damp(anim.ghost[i], ghostTarget, 7, delta);
      normal.copy(place.position).sub(SPHERE_CENTER).normalize();
      if (anim.ghost[i] > 0.02) {
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, present ? TILE_HEIGHT / 2 + 0.04 : 0.04);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(anim.ghost[i], 1, anim.ghost[i]);
        dummy.updateMatrix();
        ghosts.setMatrixAt(ghostCount, dummy.matrix);
        color.copy(palette.ghost).multiplyScalar(0.55 + 0.45 * anim.ghost[i]);
        color.lerp(palette.body, recede * 0.8);
        ghosts.setColorAt(ghostCount, color);
        anim.tileOfGhost[ghostCount] = i;
        ghostCount += 1;
      }

      if (s < SCALE_MIN) {
        anim.statusReady[i] = 0;
        continue;
      }

      // The body: territory in the ground mesh, agents in the body mesh,
      // lifted along the normal so the tile grows outward from the sphere.
      const thickness = 1 + anim.lift[i] * 2.4;
      const bodyHeight = TILE_HEIGHT * thickness;
      const bodyTop = bodyHeight - TILE_HEIGHT / 2;
      dummy.position
        .copy(place.position)
        .addScaledVector(normal, (TILE_HEIGHT * (thickness - 1)) / 2);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(s, s * thickness, s);
      dummy.updateMatrix();

      if (!agent) {
        anim.statusReady[i] = 0;
        ground.setMatrixAt(groundCount, dummy.matrix);
        color.copy(palette.ground);
        // Territory tiles nearest the agents are a touch brighter.
        color.lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12);
        color.lerp(FROST, spec.groundPale);
        color.lerp(palette.body, recede * 0.7);
        ground.setColorAt(groundCount, color);
        groundCount += 1;
        continue;
      }

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
      // that stands on it.
      const sa = s * a;
      const breathe =
        working && (motion === 'breathe' || motion === 'wave') && w > 0.5
          ? (Math.sin(
              motion === 'wave'
                ? clock * 1.5 - (place.x * 0.5 + place.y * 0.32)
                : clock * 1.6 + phase
            ) +
              1) *
            0.5
          : 0;

      agents.setMatrixAt(agentCount, dummy.matrix);
      anim.agentTile[agentCount] = i;
      color.copy(statusColor);
      color.lerp(WHITE, spec.pastel);
      color.lerp(METAL, 1 - spec.bodyTint);
      color.lerp(palette.neutral, 1 - sig.bodyStatus);
      color.lerp(palette.dim, (1 - w) * (sig.bodyStatus ? 0.78 : 0.45));
      if (tile.agent === anim.hover || tile.agent === d.selected)
        color.lerp(palette.label, 0.12);
      color.lerp(palette.label, breathe * 0.14);
      color.lerp(palette.body, recede * 0.7);
      // fade to ground as the agent leaves, toward the ground's own colour
      if (a < 1) {
        groundColor
          .copy(palette.ground)
          .lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12)
          .lerp(FROST, spec.groundPale)
          .lerp(palette.body, recede * 0.7);
        color.lerp(groundColor, 1 - a);
      }
      agents.setColorAt(agentCount, color);
      agentCount += 1;

      // Where things stand: the face the marks and lamps sit on. In the
      // translucent options that is the lit cap, which is fixed above the
      // body's top at every lift.
      const faceTop = spec.core ? bodyTop + CAP_PROUD : bodyTop;

      // The lit cap of light inside the body.
      if (spec.core) {
        const capHeight = bodyHeight * CAP_SHARE + CAP_PROUD;
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, bodyTop + CAP_PROUD - capHeight / 2);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(sa * 0.9, sa * capHeight, sa * 0.9);
        dummy.updateMatrix();
        cores.setMatrixAt(coreCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          (0.9 +
            1.1 * w +
            (agent.status === 'needs-you' ? attention * 0.8 * w : 0) +
            breathe * 0.5) *
            (1 - recede * 0.6)
        );
        cores.setColorAt(coreCount, color);
        coreCount += 1;
      }

      // The harness mark, facing the camera, part by part.
      const markIndex = marked ? markOfAgent[agent.id] : -1;
      if (markIndex >= 0) {
        const onCoin = mark === 'coin';
        dummy.quaternion.copy(place.quaternion).multiply(yaw);
        const ms = sa * (onCoin ? MARK_SIZE * 0.78 : MARK_SIZE);
        for (let p = 0; p < parts.length; p += 1) {
          const part = parts[p];
          if (part.mark !== markIndex) continue;
          const mesh = partMeshes[p] as THREE.InstancedMesh;
          const slot = anim.partCount[p];
          anim.partCount[p] = slot + 1;
          dummy.position
            .copy(place.position)
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
          // Tone: the vendor's colour, the artwork's own, or the ink.
          const tone = part.tone;
          if (tone === 'ink') {
            if (mark === 'lit') {
              if (brightFace) color.copy(INK);
              else
                color
                  .copy(palette.label)
                  .multiplyScalar((0.55 + 0.4 * w) * (1 - recede * 0.6));
            } else if (onCoin) {
              color.copy(INK);
            } else {
              color.copy(statusColor).lerp(WHITE, spec.pastel);
              color.lerp(METAL, 1 - spec.bodyTint);
              color.lerp(palette.neutral, 1 - sig.bodyStatus);
              if (brightFace) color.lerp(INK, 0.35);
              else color.lerp(palette.label, 0.45);
            }
          } else {
            color.copy(tone);
          }
          // a mark steps back with its agent, and with the world behind type
          color.lerp(palette.dim, Math.min(1, (1 - w) * 0.5 + recede * 0.5));
          mesh.setColorAt(slot, color);
        }
        if (onCoin) {
          dummy.position
            .copy(place.position)
            .addScaledVector(normal, faceTop + LIFT_OFF + COIN_HEIGHT / 2);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(sa, sa, sa);
          dummy.updateMatrix();
          coins.setMatrixAt(coinCount, dummy.matrix);
          color.copy(COIN).lerp(palette.dim, (1 - w) * 0.5);
          color.lerp(palette.body, recede * 0.7);
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
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, faceTop + LIFT_OFF);
        dummy.quaternion.copy(place.quaternion).multiply(yaw);
        if (beside) {
          side.set(0, 0, 0.6).applyQuaternion(dummy.quaternion);
          dummy.position.add(side);
        }
        const ls =
          sa * (beside ? 0.2 : (0.75 + 0.25 * w) * sig.glyphScale * 1.12);
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
        color.multiplyScalar((0.75 + 0.35 * w) * (1 - recede * 0.6));
        // a quiet mark when the signal lives elsewhere on the tile
        if (sig.glyphStatus < 1)
          color.copy(palette.neutral).lerp(palette.label, 0.22 + 0.1 * w);
        lamps.setColorAt(lampCount, color);
        lampCount += 1;
      }

      // Rim: the status as a lit band around the top edge.
      if (sig.rim) {
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, bodyTop - 0.09);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(sa, 1, sa);
        dummy.updateMatrix();
        rims.setMatrixAt(rimCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          (0.45 +
            0.55 * w +
            (agent.status === 'needs-you' ? attention * 0.35 * w : 0)) *
            (1 - recede * 0.6)
        );
        color.lerp(palette.dim, (1 - w) * 0.6);
        rims.setColorAt(rimCount, color);
        rimCount += 1;
      }

      // Lamp: a glow under the tile.
      if (sig.underglow) {
        dummy.position.copy(place.position).addScaledVector(normal, 0.06);
        dummy.quaternion.copy(place.quaternion);
        const gs = sa * (0.8 + 0.3 * w + attention * 0.08 * w);
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        glows.setMatrixAt(glowCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          (0.2 +
            0.5 * w +
            (agent.status === 'needs-you' ? attention * 0.3 * w : 0)) *
            (1 - recede * 0.7)
        );
        glows.setColorAt(glowCount, color);
        glowCount += 1;
      }

      // Working motion: a soft band of light that sweeps the face.
      if (working && motion === 'sheen') {
        // on the face the marks stand on: in the translucent options that is
        // the lit cap, which is proud of the body and would hide a sweep laid
        // on the body's own top
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, faceTop + LIFT_OFF * 2);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(sa, 1, sa);
        dummy.updateMatrix();
        sheens.setMatrixAt(sheenCount, dummy.matrix);
        color.copy(statusColor).lerp(WHITE, 0.55);
        color.multiplyScalar(0.4 * (1 - recede * 0.7));
        sheens.setColorAt(sheenCount, color);
        phaseAttr.setX(sheenCount, sheenPhase(clock, agent.id * 0.173));
        sheenCount += 1;
      }
      // Working motion: a ring that leaves the tile and fades.
      if (working && motion === 'pulse') {
        const ph = (clock * 0.42 + phase * 0.37) % 1;
        dummy.position
          .copy(place.position)
          .addScaledVector(normal, TILE_HEIGHT / 2 + 0.03);
        dummy.quaternion.copy(place.quaternion);
        const ps = sa * (1 + ph * 0.9);
        dummy.scale.set(ps, 1, ps);
        dummy.updateMatrix();
        pulses.setMatrixAt(pulseCount, dummy.matrix);
        color.copy(statusColor);
        color.multiplyScalar(
          (1 - ph) * (1 - ph) * (0.35 + 0.4 * w) * (1 - recede * 0.7)
        );
        pulses.setColorAt(pulseCount, color);
        pulseCount += 1;
      }

      // Selection: the product's ring on the ground around the tile.
      if (tile.agent === d.selected && isAgent) {
        selection.visible = true;
        selection.position
          .copy(place.position)
          .addScaledVector(normal, TILE_HEIGHT / 2 + 0.05);
        selection.quaternion.copy(place.quaternion);
        selection.scale.set(s, 1, s);
      }
    }
    for (let g = ghostCount; g < tileCount; g += 1) anim.tileOfGhost[g] = -1;

    flush(ground, groundCount);
    flush(agents, agentCount);
    flush(ghosts, ghostCount);
    flush(cores, coreCount);
    flush(lamps, lampCount);
    flush(coins, coinCount);
    flush(rims, rimCount);
    flush(glows, glowCount);
    flush(sheens, sheenCount);
    flush(pulses, pulseCount);
    if (sheenCount > 0) {
      phaseAttr.addUpdateRange(0, sheenCount);
      phaseAttr.needsUpdate = true;
    }
    for (let p = 0; p < parts.length; p += 1)
      flush(partMeshes[p] as THREE.InstancedMesh, anim.partCount[p]);

    // Anchors for the DOM overlay: the selected agent, while it is here.
    const a = anchor;
    const selectedTile = d.selected >= 0 ? tileOfAgent[d.selected] : -1;
    if (
      selectedTile >= 0 &&
      d.selected < at.count &&
      anim.agentness[selectedTile] > 0.5 &&
      anim.scale[selectedTile] > 0.5
    ) {
      const place = placements[selectedTile];
      normal.copy(place.position).sub(SPHERE_CENTER).normalize();
      const top =
        TILE_HEIGHT * (1 + anim.lift[selectedTile] * 2.4) - TILE_HEIGHT / 2;
      tmp.copy(place.position).addScaledVector(normal, top + 0.3);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setFocus(d.selected, point.x, point.y);
      } else a.clearFocus();
    } else a.clearFocus();
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      a,
      // clear of a lifted agent, which stands three tile heights tall
      TILE_HEIGHT + 1.4
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
        args={[geometry, spec.agent, tileCount]}
        onPointerMove={hoverTile}
        onPointerOut={leaveTile}
        onClick={clickTile}
        onPointerMissed={missTile}
        frustumCulled={false}
      />

      <instancedMesh
        ref={coresRef}
        args={[coreGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

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
              ? part.tone === 'ink'
                ? spec.agent
                : paintMaterial
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
        onClick={onExpand ? clickGhost : undefined}
        raycast={onExpand ? undefined : () => null}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={0.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

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
        ref={sheensRef}
        args={[sheenGeometry, sheenMaterial, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      />

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
    </>
  );
}
