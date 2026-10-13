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
 * options a light inside the body, its harness as the vendor's own mark
 * extruded on the tile in the vendor's own tones (W15f/g,
 * `crust-marks.ts`), turned to face the camera, and, while it works, one
 * of five motions (W15g, `crust-motion.ts`). The ring beyond the territory
 * is drawn as ghost outlines; in the material study a click on one adds an
 * agent. The sphere body underneath is a dark globe with faint graticule so
 * even a one-agent slice reads as a piece of something round.
 *
 * Per-frame work mutates preallocated arrays and writes instance buffers.
 * Nothing allocates in `useFrame`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt, sourceAdapterId } from '../fleet-model';
import { SPHERE_CENTER } from '../sphere';
import { stageBlend } from '../stages';
import type { VisualProps } from '../visual-contract';
import {
  makeMarkParts,
  markBrand,
  markIndexFor,
  MARK_COUNT,
} from './crust-marks';
import { disposeCrustMaterial, makeCrustMaterial } from './crust-materials';
import {
  shapeCorner,
  tileBandGeometry,
  tilePrismGeometry,
  tileRingGeometry,
} from './crust-shape';
import { crustSignal } from './crust-signal';
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
/** Width of a harness mark on the tile, and its depth by treatment. */
const MARK_SIZE = 0.78;
const MARK_DEPTH = { lit: 0.05, relief: 0.09, coin: 0.07 } as const;
const COIN_RADIUS = 0.5;
const COIN_HEIGHT = 0.08;
/** How fast a tile answers: rise, status weight, arrival. Quick, so a
 *  click lands and a hover answers at once (operator 2026-10-12: "more
 *  snappy and less mushy"). */
const LIFT_RATE = 13;
const WEIGHT_RATE = 9;
const ARRIVE_RATE = 9;

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const tmp3 = new THREE.Vector3();
const yaw = new THREE.Quaternion();
const spin = new THREE.Quaternion();
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

/** The status lamp: a flat hexagon, the tile's own shape. */
function makeLampGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let k = 0; k < 6; k += 1) {
    const a = Math.PI / 2 + (k * Math.PI * 2) / 6;
    const x = Math.cos(a) * 0.5;
    const y = Math.sin(a) * 0.5;
    if (k === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    curveSegments: 1,
  });
  g.rotateX(Math.PI / 2);
  g.translate(0, 1, 0);
  g.computeVertexNormals();
  return g;
}

function makeAnim(tileCount: number, partCount: number) {
  return {
    scale: new Float32Array(tileCount),
    lift: new Float32Array(tileCount),
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    present: new Uint8Array(tileCount),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    partCount: new Int32Array(partCount),
    pulse: 0,
    hover: -1,
    lastSelected: -1,
    punch: new Float32Array(tileCount),
  };
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
  const brands = useMemo(
    () => Array.from({ length: MARK_COUNT }, (_, m) => markBrand(m)),
    []
  );
  const partRefs = useRef<(THREE.InstancedMesh | null)[]>(
    Array.from({ length: parts.length }, () => null)
  );
  const coinsRef = useRef<THREE.InstancedMesh>(null);
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const rimsRef = useRef<THREE.InstancedMesh>(null);
  const glowsRef = useRef<THREE.InstancedMesh>(null);
  const orbitsRef = useRef<THREE.InstancedMesh>(null);
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
  const lampGeometry = useMemo(() => makeLampGeometry(), []);
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
  // Working motion: a light that circles the tile, and a ring that leaves it.
  const orbitGeometry = useMemo(
    () => new THREE.SphereGeometry(0.075, 12, 8),
    []
  );
  const pulseGeometry = useMemo(
    () => tileRingGeometry(TILE_RADIUS + 0.02, TILE_RADIUS - 0.07, corner),
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
      coreGeometry.dispose();
      ghostGeometry.dispose();
      rimGeometry.dispose();
      selectionGeometry.dispose();
      pulseGeometry.dispose();
    },
    [coreGeometry, ghostGeometry, rimGeometry, selectionGeometry, pulseGeometry]
  );
  useEffect(
    () => () => {
      lampGeometry.dispose();
      parts.forEach(part => part.geometry.dispose());
      coinGeometry.dispose();
      coinMaterial.dispose();
      glowGeometry.dispose();
      glowTexture.dispose();
      orbitGeometry.dispose();
    },
    [
      lampGeometry,
      parts,
      coinGeometry,
      coinMaterial,
      glowGeometry,
      glowTexture,
      orbitGeometry,
    ]
  );

  // Hover and click on the instanced tiles.
  const hoverTile = (e: ThreeEvent<PointerEvent>) => {
    const id = e.instanceId ?? -1;
    const agent = id >= 0 && anim.present[id] ? model.tiles[id].agent : -1;
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
    const id = e.instanceId ?? -1;
    const agent = id >= 0 && anim.present[id] ? model.tiles[id].agent : -1;
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
    const d = drive.current;
    const ground = groundRef.current;
    const agents = agentsRef.current;
    const cores = coresRef.current;
    const lamps = lampsRef.current;
    const coins = coinsRef.current;
    const ghosts = ghostsRef.current;
    const rims = rimsRef.current;
    const glows = glowsRef.current;
    const orbits = orbitsRef.current;
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
      !orbits ||
      !pulses ||
      !selection
    )
      return;
    for (let p = 0; p < parts.length; p += 1) if (!partMeshes[p]) return;

    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.pulse += delta;
    const clock = anim.pulse;
    const attention = reducedMotion ? 0 : (Math.sin(clock * 2.2) + 1) * 0.5;
    const recede = d.recede;
    // Stage states blend on the rail, with the camera.
    const b = stageBlend(d.rail, undefined, blendScratch);
    const h0 = d.highlights[b.from] ?? null;
    const h1 = d.highlights[b.to] ?? null;
    const lifted = THREE.MathUtils.lerp(h0 ? 1 : 0, h1 ? 1 : 0, b.t);
    // Marks face the camera: turned about the tile normal so the page's up
    // is away from the viewer and its right is the viewer's right.
    state.camera.getWorldDirection(tmp3);
    yaw.setFromAxisAngle(yAxis, Math.atan2(-tmp3.x, -tmp3.z));
    const marked = mark !== 'off';
    const markDepth = marked ? MARK_DEPTH[mark] : 0;
    // A bright top face takes dark ink; a dark one takes light.
    const brightFace = spec.core || sig.bodyStatus === 1;
    const moving = !reducedMotion;

    let ghostCount = 0;
    let coreCount = 0;
    let lampCount = 0;
    let coinCount = 0;
    let rimCount = 0;
    let glowCount = 0;
    let orbitCount = 0;
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
      anim.present[i] = present ? 1 : 0;
      const isAgent = tile.agent >= 0 && tile.agent < at.count;
      const agent = isAgent ? model.agents[tile.agent] : null;
      const working = agent !== null && agent.status === 'active' && moving;
      const phase = agent ? agent.id * 0.9 : 0;

      // Targets.
      const scaleTarget = present ? 1 : 0;
      const weightTarget = agent
        ? THREE.MathUtils.lerp(
            highlightWeight(agent.status, h0),
            highlightWeight(agent.status, h1),
            b.t
          )
        : 1;
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
        if (anim.punch[i] > 0) {
          anim.punch[i] = Math.max(0, anim.punch[i] - delta * 4);
          liftTarget += Math.sin(anim.punch[i] * Math.PI) * 0.3;
        }
      }

      if (reducedMotion) {
        anim.scale[i] = scaleTarget;
        anim.lift[i] = liftTarget;
        anim.weight[i] = weightTarget;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(
          anim.scale[i],
          scaleTarget,
          ARRIVE_RATE,
          delta
        );
        anim.lift[i] = THREE.MathUtils.damp(
          anim.lift[i],
          liftTarget,
          LIFT_RATE,
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
      const w = anim.weight[i];
      const breathe =
        working && motion === 'breathe' && w > 0.5
          ? (Math.sin(clock * 1.6 + phase) + 1) * 0.5
          : 0;

      // Tile body: territory in the ground mesh, agents in the body mesh.
      const thickness = 1 + anim.lift[i] * 2.4;
      tmp.copy(place.position);
      // lift along the normal so the tile grows outward from the sphere
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.addScaledVector(tmp2, (TILE_HEIGHT * (thickness - 1)) / 2);
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(s, s * thickness, s);
      dummy.updateMatrix();
      if (agent) {
        agents.setMatrixAt(i, dummy.matrix);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        ground.setMatrixAt(i, dummy.matrix);
      } else {
        ground.setMatrixAt(i, dummy.matrix);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        agents.setMatrixAt(i, dummy.matrix);
      }

      if (agent) {
        color.copy(palette.status[agent.status]);
        color.lerp(WHITE, spec.pastel);
        color.lerp(METAL, 1 - spec.bodyTint);
        color.lerp(palette.neutral, 1 - sig.bodyStatus);
        color.lerp(palette.dim, (1 - w) * (sig.bodyStatus ? 0.78 : 0.45));
        if (tile.agent === anim.hover || tile.agent === d.selected)
          color.lerp(palette.label, 0.12);
        color.lerp(palette.label, breathe * 0.14);
        color.lerp(palette.body, recede * 0.7);
        agents.setColorAt(i, color);
      } else {
        color.copy(palette.ground);
        // Territory tiles nearest the agents are a touch brighter.
        color.lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12);
        color.lerp(FROST, spec.groundPale);
        color.lerp(palette.body, recede * 0.7);
        ground.setColorAt(i, color);
      }

      if (agent) {
        // The top face, where the lamp and the mark sit. In the translucent
        // options the light inside the body stands a little proud of the
        // face as a lit cap, and the mark sits on that cap.
        tmp.addScaledVector(tmp2, (TILE_HEIGHT * thickness) / 2 + 0.01);
        const coreHeight = TILE_HEIGHT * thickness * 0.6;
        const capLift = spec.core ? coreHeight / 2 + 0.004 : 0;

        // The harness mark, facing the camera, part by part.
        const markIndex = marked ? markOfAgent[agent.id] : -1;
        if (markIndex >= 0) {
          const onCoin = mark === 'coin';
          const brand = brands[markIndex];
          dummy.quaternion.copy(place.quaternion).multiply(yaw);
          if (working && motion === 'spin') {
            spin.setFromAxisAngle(yAxis, clock * 0.55 + phase);
            dummy.quaternion.multiply(spin);
          }
          const ms = s * (onCoin ? MARK_SIZE * 0.78 : MARK_SIZE);
          for (let p = 0; p < parts.length; p += 1) {
            const part = parts[p];
            if (part.mark !== markIndex) continue;
            const mesh = partMeshes[p] as THREE.InstancedMesh;
            const slot = anim.partCount[p];
            anim.partCount[p] = slot + 1;
            dummy.position
              .copy(tmp)
              .addScaledVector(
                tmp2,
                capLift +
                  (onCoin ? COIN_HEIGHT : 0) +
                  part.raise * markDepth * 0.6
              );
            dummy.scale.set(ms, s * markDepth, ms);
            dummy.updateMatrix();
            mesh.setMatrixAt(slot, dummy.matrix);
            // Tone: the vendor's colour, the artwork's own, or the ink.
            const tone = part.tone === 'brand' ? brand : part.tone;
            if (tone === 'ink' || tone === null) {
              if (mark === 'lit') {
                if (brightFace)
                  color.copy(INK).lerp(palette.dim, (1 - w) * 0.5);
                else
                  color
                    .copy(palette.label)
                    .multiplyScalar((0.55 + 0.4 * w) * (1 - recede * 0.6));
              } else if (onCoin) {
                color.copy(INK);
              } else {
                agents.getColorAt(i, color);
                if (brightFace) color.lerp(INK, 0.35);
                else color.lerp(palette.label, 0.45);
              }
            } else if (mark === 'relief') {
              // the tile's own body, carried most of the way to the colour
              agents.getColorAt(i, color);
              color.lerp(tone, 0.75);
            } else {
              color.copy(tone);
              if (mark === 'lit')
                color.lerp(palette.dim, (1 - w) * 0.4 + recede * 0.5);
            }
            mesh.setColorAt(slot, color);
          }
          if (onCoin) {
            dummy.position
              .copy(tmp)
              .addScaledVector(tmp2, capLift + COIN_HEIGHT / 2);
            dummy.quaternion.copy(place.quaternion);
            dummy.scale.set(s, s, s);
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
        const lampOn = !(
          marked &&
          markIndex >= 0 &&
          (sig.rim || sig.bodyStatus)
        );
        if (lampOn) {
          const beside = marked && markIndex >= 0;
          dummy.position.copy(tmp);
          dummy.quaternion.copy(place.quaternion).multiply(yaw);
          if (beside) {
            tmp3.set(0, 0, 0.6).applyQuaternion(dummy.quaternion);
            dummy.position.add(tmp3);
          }
          const ls =
            s * (beside ? 0.2 : (0.75 + 0.25 * w) * sig.glyphScale * 1.12);
          dummy.scale.set(ls, s * 0.05, ls);
          dummy.updateMatrix();
          lamps.setMatrixAt(lampCount, dummy.matrix);
          // A lit lamp: the status hue carried toward white, never past it,
          // so amber stays amber instead of clipping to cream.
          color.copy(palette.status[agent.status]);
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
          dummy.position.copy(tmp).addScaledVector(tmp2, -0.1);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(s, 1, s);
          dummy.updateMatrix();
          rims.setMatrixAt(rimCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
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
          dummy.position.copy(place.position).addScaledVector(tmp2, 0.06);
          dummy.quaternion.copy(place.quaternion);
          const gs = s * (0.8 + 0.3 * w + attention * 0.08 * w);
          dummy.scale.set(gs, 1, gs);
          dummy.updateMatrix();
          glows.setMatrixAt(glowCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
          color.multiplyScalar(
            (0.2 +
              0.5 * w +
              (agent.status === 'needs-you' ? attention * 0.3 * w : 0)) *
              (1 - recede * 0.7)
          );
          glows.setColorAt(glowCount, color);
          glowCount += 1;
        }

        // Working motion: a light that circles the edge.
        if (working && motion === 'orbit') {
          const a = clock * 1.6 + phase;
          tmp3
            .set(
              Math.cos(a) * TILE_RADIUS * 0.84,
              0,
              Math.sin(a) * TILE_RADIUS * 0.84
            )
            .applyQuaternion(place.quaternion);
          dummy.position.copy(tmp).add(tmp3).addScaledVector(tmp2, 0.06);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.setScalar(s * (0.8 + 0.4 * w));
          dummy.updateMatrix();
          orbits.setMatrixAt(orbitCount, dummy.matrix);
          color.copy(palette.status.active).lerp(WHITE, 0.45);
          color.multiplyScalar((0.7 + 0.5 * w) * (1 - recede * 0.6));
          orbits.setColorAt(orbitCount, color);
          orbitCount += 1;
        }
        // Working motion: a ring that leaves the tile and fades.
        if (working && motion === 'pulse') {
          const ph = (clock * 0.42 + phase * 0.37) % 1;
          dummy.position
            .copy(place.position)
            .addScaledVector(tmp2, TILE_HEIGHT / 2 + 0.03);
          dummy.quaternion.copy(place.quaternion);
          const ps = s * (1 + ph * 0.9);
          dummy.scale.set(ps, 1, ps);
          dummy.updateMatrix();
          pulses.setMatrixAt(pulseCount, dummy.matrix);
          color.copy(palette.status.active);
          color.multiplyScalar(
            (1 - ph) * (1 - ph) * (0.35 + 0.4 * w) * (1 - recede * 0.7)
          );
          pulses.setColorAt(pulseCount, color);
          pulseCount += 1;
        }

        // Selection: the product's ring on the ground around the tile.
        if (tile.agent === d.selected) {
          selection.visible = true;
          selection.position
            .copy(place.position)
            .addScaledVector(tmp2, TILE_HEIGHT / 2 + 0.05);
          selection.quaternion.copy(place.quaternion);
          selection.scale.set(s, 1, s);
        }

        if (spec.core) {
          dummy.position
            .copy(place.position)
            .addScaledVector(tmp2, (TILE_HEIGHT * thickness) / 2);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(s * 0.9, s * coreHeight, s * 0.9);
          dummy.updateMatrix();
          cores.setMatrixAt(coreCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
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
      }

      // Ghosts: the next ring out, drawn as outlines.
      const ghost = at.tileGhost(tile);
      const ghostTarget = ghost ? 1 : 0;
      anim.ghost[i] = reducedMotion
        ? ghostTarget
        : THREE.MathUtils.damp(anim.ghost[i], ghostTarget, 7, delta);
      if (anim.ghost[i] > 0.02) {
        dummy.position
          .copy(place.position)
          .addScaledVector(tmp2, present ? TILE_HEIGHT / 2 + 0.04 : 0.04);
        dummy.quaternion.copy(place.quaternion);
        const gs = anim.ghost[i];
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        ghosts.setMatrixAt(ghostCount, dummy.matrix);
        color.copy(palette.ghost).multiplyScalar(0.55 + 0.45 * anim.ghost[i]);
        color.lerp(palette.body, recede * 0.8);
        ghosts.setColorAt(ghostCount, color);
        anim.tileOfGhost[ghostCount] = i;
        ghostCount += 1;
      }
    }
    for (let g = ghostCount; g < tileCount; g += 1) anim.tileOfGhost[g] = -1;
    ghosts.count = ghostCount;
    cores.count = coreCount;
    lamps.count = lampCount;
    coins.count = coinCount;
    rims.count = rimCount;
    glows.count = glowCount;
    orbits.count = orbitCount;
    pulses.count = pulseCount;
    for (let p = 0; p < parts.length; p += 1) {
      const mesh = partMeshes[p] as THREE.InstancedMesh;
      mesh.count = anim.partCount[p];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    for (const mesh of [
      ground,
      agents,
      cores,
      lamps,
      coins,
      ghosts,
      rims,
      glows,
      orbits,
      pulses,
    ]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // Anchors for the DOM overlay.
    const a = anchor;
    const exemplarTile = d.exemplar >= 0 ? tileOfAgent[d.exemplar] : -1;
    if (exemplarTile >= 0 && anim.present[exemplarTile]) {
      const place = placements[exemplarTile];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp
        .copy(place.position)
        .addScaledVector(
          tmp2,
          TILE_HEIGHT + anim.lift[exemplarTile] * 1.2 + 0.2
        );
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setExemplar(point.x, point.y);
      } else a.clearExemplar();
    } else a.clearExemplar();

    const selectedTile = d.selected >= 0 ? tileOfAgent[d.selected] : -1;
    if (selectedTile >= 0 && anim.present[selectedTile]) {
      const place = placements[selectedTile];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp
        .copy(place.position)
        .addScaledVector(
          tmp2,
          TILE_HEIGHT + anim.lift[selectedTile] * 1.2 + 0.3
        );
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
      // clear of a lifted exemplar, which stands three tile heights tall
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
              ? spec.agent
              : mark === 'coin'
                ? coinMaterial
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
        ref={orbitsRef}
        args={[orbitGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} transparent />
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
