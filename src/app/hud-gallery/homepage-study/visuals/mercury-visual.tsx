'use client';

/**
 * Option E, Mercury (ENG-031 W15b, operator 2026-10-08: "metallic / liquid
 * metal to represent agents and agent world").
 *
 * Each Project is one volume of liquid metal on the sphere: a thin chrome
 * pool over its territory, and every agent a droplet standing out of it.
 * Droplets are metaballs, so two agents side by side merge into one body
 * and a dense Project reads as a single living pool while a sparse one is
 * scattered beads. Status tints the metal; an agent that needs you swells
 * and breathes. Children are beads orbiting the parent.
 *
 * Marching cubes per Project (three's own), re-polygonised round-robin so
 * ten pools cost a few per frame, not all ten. Reflections come from a
 * procedural room, never a fetched HDR.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import { axialToPlane, fleetAt, type FleetModel } from '../fleet-model';
import {
  SPHERE_CENTER,
  SPHERE_RADIUS,
  planeToSphere,
  tileQuaternion,
} from '../sphere';
import type { VisualProps } from '../visual-contract';
import { CameraRig } from './camera-rig';
import { useRoomEnvironment } from './environment';
import {
  clearPoolField,
  makePoolField,
  splatBump,
  splatSheet,
  writeVolume,
} from './mercury-field';
import {
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
  type Palette,
} from './shared';

const RESOLUTION = 56;
const POOL_FLOOR = 0.5;
const SHEET_HEIGHT = 0.28;
const sheetColor = new THREE.Color();
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const point = { x: 0, y: 0 };

interface Pool {
  project: number;
  mesh: MarchingCubes;
  /** World scale of the volume: the cube spans -scale..scale. */
  scale: number;
  /** Planar centre, tile units. */
  cx: number;
  cy: number;
  /** Tile indices in this Project. */
  tiles: number[];
}

function makePools(model: FleetModel, material: THREE.Material): Pool[] {
  return model.projects.map(project => {
    const [cx, cy] = axialToPlane(project.center);
    const scale = (project.rings + 1.3) * Math.sqrt(3) + 0.6;
    const mesh = new MarchingCubes(RESOLUTION, material, false, true, 24000);
    mesh.isolation = 80;
    mesh.frustumCulled = false;
    planeToSphere(cx, cy, mesh.position, undefined, 0.02);
    tileQuaternion(cx, cy, mesh.quaternion);
    mesh.scale.setScalar(scale);
    const tiles: number[] = [];
    model.tiles.forEach((tile, i) => {
      if (tile.project === project.id) tiles.push(i);
    });
    return { project: project.id, mesh, scale, cx, cy, tiles };
  });
}

function showPool(pool: Pool, visible: boolean) {
  pool.mesh.visible = visible;
}

function makeAnim(agentCount: number, pipCount: number) {
  return {
    scale: new Float32Array(agentCount),
    weight: new Float32Array(agentCount).fill(1),
    pipScale: new Float32Array(pipCount),
    pulse: 0,
    hover: -1,
    roundRobin: 0,
  };
}

export function MercuryVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  onExpand,
  onHoverChange,
}: VisualProps) {
  useRoomEnvironment(1.3);
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const pips = useMemo(() => {
    const out: { agent: number; angle: number }[] = [];
    model.agents.forEach(agent => {
      for (let c = 0; c < agent.children; c += 1)
        out.push({
          agent: agent.id,
          angle: ((c + 0.5) / agent.children) * Math.PI * 2 + agent.id,
        });
    });
    return out;
  }, [model]);

  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  if (materialRef.current === null)
    materialRef.current = new THREE.MeshStandardMaterial({
      color: 0xc3cad6,
      metalness: 1,
      roughness: 0.14,
      envMapIntensity: 0.9,
      vertexColors: true,
    });
  const material = materialRef.current;
  const poolsRef = useRef<Pool[] | null>(null);
  if (poolsRef.current === null) poolsRef.current = makePools(model, material);
  const pools = poolsRef.current;
  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
  if (animRef.current === null)
    animRef.current = makeAnim(model.agents.length, pips.length);
  const anim = animRef.current;
  const fieldRef = useRef(makePoolField(RESOLUTION));
  const field = fieldRef.current;
  const shownRef = useRef(1);
  const { size, gl } = useThree();
  const pipsRef = useRef<THREE.InstancedMesh>(null);
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const ghostOfIndex = useRef(new Int32Array(model.tiles.length).fill(-1));
  const ghostAnim = useRef(new Float32Array(model.tiles.length));

  const pipGeometry = useMemo(() => new THREE.SphereGeometry(0.26, 16, 12), []);
  const ghostGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.76, 0.86, 6, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 6);
    return g;
  }, []);
  useEffect(
    () => () => {
      pools.forEach(pool => pool.mesh.geometry.dispose());
      material.dispose();
    },
    [pools, material]
  );

  // Hover: nearest present droplet to the pointer in screen space.
  const hoverPointerRef = useRef({ x: 0, y: 0, active: false });
  useEffect(() => {
    const el = gl.domElement;
    const move = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      hoverPointerRef.current.x = e.clientX - rect.left;
      hoverPointerRef.current.y = e.clientY - rect.top;
      hoverPointerRef.current.active = true;
    };
    const leave = () => {
      hoverPointerRef.current.active = false;
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [gl]);

  const clickGhost = (e: {
    instanceId?: number;
    stopPropagation: () => void;
  }) => {
    const id = e.instanceId ?? -1;
    if (id >= 0 && ghostOfIndex.current[id] >= 0) {
      e.stopPropagation();
      onExpand?.();
    }
  };

  const statusColor = (
    pal: Palette,
    status: keyof Palette['status'],
    w: number
  ) => color.copy(pal.status[status]).lerp(pal.label, 0.35 + (1 - w) * 0.45);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = drive.current;
    const at = fleetAt(model, Math.round(shownRef.current));
    anim.pulse += delta;
    const breathe = reducedMotion
      ? 0.5
      : (Math.sin(anim.pulse * 2.4) + 1) * 0.5;
    const recede = d.recede;

    for (let i = 0; i < model.agents.length; i += 1) {
      const agent = model.agents[i];
      const present = i < at.count ? 1 : 0;
      const weight = present ? highlightWeight(agent.status, d.highlight) : 1;
      if (reducedMotion) {
        anim.scale[i] = present;
        anim.weight[i] = weight;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(anim.scale[i], present, 5, delta);
        anim.weight[i] = THREE.MathUtils.damp(anim.weight[i], weight, 5, delta);
      }
    }

    // Re-polygonise one pool per frame, round-robin over the present ones:
    // a sheet over the territory, a bump per agent, bent with the sphere.
    const presentPools = pools.filter(pool =>
      at.projects.some(p => p.id === pool.project)
    );
    if (presentPools.length > 0) {
      const pool = presentPools[anim.roundRobin % presentPools.length];
      const mc = pool.mesh;
      const worldPerUnit = pool.scale * 2;
      const toUnit = (v: number) => v / worldPerUnit;
      clearPoolField(field);
      // the sheet: every present territory tile, soft-edged, combined by max
      sheetColor.copy(palette.label).lerp(palette.body, 0.55 + recede * 0.35);
      for (const ti of pool.tiles) {
        const tile = model.tiles[ti];
        if (!at.tilePresent(tile)) continue;
        const [x, y] = axialToPlane(tile.axial);
        splatSheet(
          field,
          toUnit(x - pool.cx) + 0.5,
          toUnit(y - pool.cy) + 0.5,
          toUnit(1.45),
          toUnit(SHEET_HEIGHT),
          sheetColor.r,
          sheetColor.g,
          sheetColor.b
        );
      }
      // the droplets: every present agent, a bump sized and tinted by status
      for (const ti of pool.tiles) {
        const tile = model.tiles[ti];
        if (!at.tileAgent(tile)) continue;
        const agent = model.agents[tile.agent];
        const sc = anim.scale[tile.agent];
        const w = anim.weight[tile.agent];
        if (sc < 0.02) continue;
        const [x, y] = axialToPlane(tile.axial);
        const lead =
          tile.agent === d.exemplar || tile.agent === anim.hover ? 1.35 : 1;
        const rise =
          agent.status === 'needs-you'
            ? 1.05 + breathe * 0.25
            : agent.status === 'active'
              ? 0.72 + agent.burn * 0.2
              : agent.status === 'result'
                ? 0.6
                : agent.status === 'fault'
                  ? 0.5
                  : 0.32;
        statusColor(palette, agent.status, w).lerp(palette.body, recede * 0.6);
        splatBump(
          field,
          toUnit(x - pool.cx) + 0.5,
          toUnit(y - pool.cy) + 0.5,
          toUnit(0.82 * lead),
          toUnit(rise * sc * lead * (0.6 + 0.4 * w)),
          color.r,
          color.g,
          color.b
        );
      }
      mc.reset();
      writeVolume(
        field,
        mc.field,
        mc.palette,
        POOL_FLOOR,
        mc.isolation,
        worldPerUnit,
        toUnit(0.55),
        toUnit(SHEET_HEIGHT)
      );
      mc.update();
      anim.roundRobin = (anim.roundRobin + 1) % presentPools.length;
    }
    for (const pool of pools) showPool(pool, presentPools.includes(pool));

    // Children beads and ghost outlines.
    const pipMesh = pipsRef.current;
    const ghosts = ghostsRef.current;
    if (pipMesh) {
      for (let p = 0; p < pips.length; p += 1) {
        const pip = pips[p];
        const place = placements[tileOfAgent[pip.agent]];
        const target = anim.scale[pip.agent];
        anim.pipScale[p] = reducedMotion
          ? target
          : THREE.MathUtils.damp(anim.pipScale[p], target, 6, delta);
        const ps = anim.pipScale[p] * (0.6 + 0.4 * anim.weight[pip.agent]);
        tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
        const orbit = pip.angle + (reducedMotion ? 0 : anim.pulse * 0.5);
        tmp.set(Math.cos(orbit) * 1.35, 0, Math.sin(orbit) * 1.35);
        tmp
          .applyQuaternion(place.quaternion)
          .add(place.position)
          .addScaledVector(tmp2, 0.45);
        dummy.position.copy(tmp);
        dummy.quaternion.copy(place.quaternion);
        dummy.scale.set(ps, ps, ps);
        dummy.updateMatrix();
        pipMesh.setMatrixAt(p, dummy.matrix);
      }
      pipMesh.instanceMatrix.needsUpdate = true;
    }
    if (ghosts) {
      let ghostCount = 0;
      for (let i = 0; i < model.tiles.length; i += 1) {
        const tile = model.tiles[i];
        const target = at.tileGhost(tile) ? 1 : 0;
        ghostAnim.current[i] = reducedMotion
          ? target
          : THREE.MathUtils.damp(ghostAnim.current[i], target, 5, delta);
        if (ghostAnim.current[i] < 0.02) continue;
        const place = placements[i];
        tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
        dummy.position.copy(place.position).addScaledVector(tmp2, 0.12);
        dummy.quaternion.copy(place.quaternion);
        const gs = ghostAnim.current[i] * 0.98;
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        ghosts.setMatrixAt(ghostCount, dummy.matrix);
        color
          .copy(palette.label)
          .multiplyScalar(0.3 + 0.3 * ghostAnim.current[i])
          .lerp(palette.body, recede * 0.8);
        ghosts.setColorAt(ghostCount, color);
        ghostOfIndex.current[ghostCount] = i;
        ghostCount += 1;
      }
      for (let g = ghostCount; g < model.tiles.length; g += 1)
        ghostOfIndex.current[g] = -1;
      ghosts.count = ghostCount;
      ghosts.instanceMatrix.needsUpdate = true;
      if (ghosts.instanceColor) ghosts.instanceColor.needsUpdate = true;
    }

    // Hover.
    let best = -1;
    const pointer = hoverPointerRef.current;
    if (pointer.active) {
      let bestD = 26 * 26;
      for (let i = 0; i < at.count; i += 1) {
        const place = placements[tileOfAgent[i]];
        tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
        tmp.copy(place.position).addScaledVector(tmp2, 0.6);
        if (!projectToCanvas(tmp, state.camera, size.width, size.height, point))
          continue;
        const dx = point.x - pointer.x;
        const dy = point.y - pointer.y;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    if (best !== anim.hover) {
      anim.hover = best;
      onHoverChange?.(best);
    }

    const a = anchor;
    if (d.exemplar >= 0 && d.exemplar < at.count) {
      const place = placements[tileOfAgent[d.exemplar]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 1.6);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point))
        a.setExemplar(point.x, point.y);
      else a.clearExemplar();
    } else a.clearExemplar();
    if (anim.hover >= 0) {
      const place = placements[tileOfAgent[anim.hover]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 1.4);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point))
        a.setHover(anim.hover, point.x, point.y);
      else a.clearHover();
    } else a.clearHover();
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      a,
      2.6
    );
  });

  return (
    <>
      <CameraRig
        model={model}
        drive={drive}
        reducedMotion={reducedMotion}
        shownRef={shownRef}
      />
      <color attach="background" args={[theme.canvas]} />
      <fog attach="fog" args={[theme.canvas, 70, 170]} />
      <directionalLight position={[30, 60, 20]} intensity={1.4} />
      <directionalLight
        position={[-40, 20, -30]}
        intensity={0.5}
        color={0xbcd7ff}
      />

      {/* A dark brushed-metal globe: the pools have a world to lie on and reflect. */}
      <mesh position={SPHERE_CENTER} raycast={() => null}>
        <sphereGeometry args={[SPHERE_RADIUS - 0.25, 96, 64]} />
        <meshStandardMaterial
          color={palette.body}
          roughness={0.5}
          metalness={0.85}
          envMapIntensity={0.5}
        />
      </mesh>

      {pools.map(pool => (
        <primitive key={pool.project} object={pool.mesh} />
      ))}

      <instancedMesh
        ref={pipsRef}
        args={[pipGeometry, undefined, Math.max(1, pips.length)]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshStandardMaterial
          color={0xe6ebf2}
          metalness={1}
          roughness={0.1}
          envMapIntensity={1.6}
        />
      </instancedMesh>

      <instancedMesh
        ref={ghostsRef}
        args={[ghostGeometry, undefined, model.tiles.length]}
        onClick={clickGhost}
        frustumCulled={false}
      >
        <meshBasicMaterial
          transparent
          opacity={0.5}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </>
  );
}
