'use client';

/**
 * Option D, Prism (ENG-031 W15b, operator 2026-10-08: "crystalline / prism /
 * glass like the Framer branding").
 *
 * The same hex territory on the same sphere, but every agent is a crystal:
 * a tall glass prism with a status-coloured light inside it, so the status
 * reads as light refracted and dispersed through glass rather than as a
 * painted surface. Territory tiles are low frosted glass; the ring beyond is
 * thin glass outlines a click fills. Reflections come from a procedural
 * room, never a fetched HDR. Transmission and dispersion are three's own
 * physical material, one pass for the whole instanced set.
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt } from '../fleet-model';
import { SPHERE_CENTER, SPHERE_RADIUS } from '../sphere';
import { stageAt } from '../stages';
import type { VisualProps } from '../visual-contract';
import { CameraRig } from './camera-rig';
import { useRoomEnvironment } from './environment';
import {
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
} from './shared';

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const point = { x: 0, y: 0 };

function makeAnim(tileCount: number, pipCount: number) {
  return {
    scale: new Float32Array(tileCount),
    height: new Float32Array(tileCount),
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    present: new Uint8Array(tileCount),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    pipScale: new Float32Array(pipCount),
    pulse: 0,
    hover: -1,
  };
}

export function PrismVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  onExpand,
  onHoverChange,
}: VisualProps) {
  useRoomEnvironment(1.1);
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileCount = model.tiles.length;
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const pips = useMemo(() => {
    const out: { tile: number; angle: number; parent: number }[] = [];
    model.agents.forEach(agent => {
      if (!agent.children) return;
      const tileIndex = model.tiles.findIndex(t => t.agent === agent.id);
      for (let c = 0; c < agent.children; c += 1)
        out.push({
          tile: tileIndex,
          angle: ((c + 0.5) / agent.children) * Math.PI * 2 + agent.id,
          parent: agent.id,
        });
    });
    return out;
  }, [model]);

  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
  if (animRef.current === null)
    animRef.current = makeAnim(tileCount, pips.length);
  const anim = animRef.current;
  const shownRef = useRef(1);
  const { size } = useThree();

  const crystalsRef = useRef<THREE.InstancedMesh>(null);
  const coresRef = useRef<THREE.InstancedMesh>(null);
  const groundRef = useRef<THREE.InstancedMesh>(null);
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const pipsRef = useRef<THREE.InstancedMesh>(null);

  const crystalGeometry = useMemo(() => {
    // unit-height prism, base at y = 0, so a scale on y is a height
    const g = new THREE.CylinderGeometry(0.62, 0.78, 1, 6, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const coreGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.22, 0.3, 1, 6, 1);
    g.translate(0, 0.5, 0);
    return g;
  }, []);
  const groundGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.88, 0.88, 0.22, 6, 1),
    []
  );
  const ghostGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.76, 0.86, 6, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 6);
    return g;
  }, []);
  const pipGeometry = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.22, 0);
    return g;
  }, []);

  const hoverTile = (e: ThreeEvent<PointerEvent>) => {
    const id = e.instanceId ?? -1;
    const agent = id >= 0 && anim.present[id] ? model.tiles[id].agent : -1;
    if (agent !== anim.hover) {
      anim.hover = agent;
      onHoverChange?.(agent);
    }
  };
  const leaveTile = () => {
    if (anim.hover !== -1) {
      anim.hover = -1;
      onHoverChange?.(-1);
    }
  };
  const clickGhost = (e: ThreeEvent<MouseEvent>) => {
    const id = e.instanceId ?? -1;
    if (id >= 0 && anim.tileOfGhost[id] >= 0) {
      e.stopPropagation();
      onExpand?.();
    }
  };

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = drive.current;
    const crystals = crystalsRef.current;
    const cores = coresRef.current;
    const ground = groundRef.current;
    const ghosts = ghostsRef.current;
    const pipMesh = pipsRef.current;
    if (!crystals || !cores || !ground || !ghosts || !pipMesh) return;

    const at = fleetAt(model, Math.round(shownRef.current));
    anim.pulse += delta;
    const breathe = reducedMotion
      ? 0.5
      : (Math.sin(anim.pulse * 2.2) + 1) * 0.5;
    const recede = d.recede;

    let ghostCount = 0;
    for (let i = 0; i < tileCount; i += 1) {
      const tile = model.tiles[i];
      const place = placements[i];
      const present = at.tilePresent(tile);
      anim.present[i] = present ? 1 : 0;
      const agent = at.tileAgent(tile) ? model.agents[tile.agent] : null;
      const weightTarget = agent
        ? highlightWeight(agent.status, d.highlights[stageAt(d.rail)] ?? null)
        : 1;
      let heightTarget = 0;
      if (agent) {
        heightTarget =
          agent.status === 'needs-you'
            ? 3.1 + breathe * 0.25
            : agent.status === 'active'
              ? 2.0 + agent.burn * 0.9
              : agent.status === 'result'
                ? 1.7
                : agent.status === 'fault'
                  ? 1.4
                  : 0.9;
        heightTarget *= 0.55 + 0.45 * weightTarget;
        if (tile.agent === d.exemplar || tile.agent === anim.hover)
          heightTarget += 0.5;
      }
      if (reducedMotion) {
        anim.scale[i] = present ? 1 : 0;
        anim.height[i] = heightTarget;
        anim.weight[i] = weightTarget;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(
          anim.scale[i],
          present ? 1 : 0,
          6,
          delta
        );
        anim.height[i] = THREE.MathUtils.damp(
          anim.height[i],
          heightTarget,
          5,
          delta
        );
        anim.weight[i] = THREE.MathUtils.damp(
          anim.weight[i],
          weightTarget,
          5,
          delta
        );
      }
      const s = anim.scale[i];
      const w = anim.weight[i];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();

      // Frosted ground tile on every present tile.
      dummy.position.copy(place.position);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(s * 0.96, s, s * 0.96);
      dummy.updateMatrix();
      ground.setMatrixAt(i, dummy.matrix);
      color
        .copy(palette.ground)
        .lerp(palette.label, tile.ring === 0 ? 0.18 : 0.08);
      color.lerp(palette.body, recede * 0.7);
      ground.setColorAt(i, color);

      // Crystal and its light.
      const h = agent ? anim.height[i] * s : 0;
      dummy.position.copy(place.position).addScaledVector(tmp2, 0.11);
      // an empty tile has no crystal at all, not a flat one: a flat glass
      // hex still refracts, and a flat black core reads as a stain
      if (agent && h > 0.01) dummy.scale.set(s, h, s);
      else dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      crystals.setMatrixAt(i, dummy.matrix);
      if (agent) {
        // the glass itself is nearly clear; the tint is the light inside
        color.copy(palette.status[agent.status]).lerp(palette.label, 0.75);
        color.lerp(palette.dim, (1 - w) * 0.5);
      } else color.setScalar(0);
      crystals.setColorAt(i, color);

      if (agent && h > 0.01) dummy.scale.set(s, h * 0.82, s);
      else dummy.scale.setScalar(0.0001);
      dummy.updateMatrix();
      cores.setMatrixAt(i, dummy.matrix);
      if (agent) {
        color.copy(palette.status[agent.status]);
        const glow =
          1.2 +
          1.8 * w +
          (agent.status === 'needs-you' ? breathe * 0.9 * w : 0);
        color.multiplyScalar(glow * (1 - recede * 0.6));
      } else color.setScalar(0);
      cores.setColorAt(i, color);

      // Ghost outlines.
      const ghostTarget = at.tileGhost(tile) ? 1 : 0;
      anim.ghost[i] = reducedMotion
        ? ghostTarget
        : THREE.MathUtils.damp(anim.ghost[i], ghostTarget, 5, delta);
      if (anim.ghost[i] > 0.02) {
        dummy.position
          .copy(place.position)
          .addScaledVector(tmp2, present ? 0.14 : 0.04);
        dummy.quaternion.copy(place.quaternion);
        const gs = anim.ghost[i] * 0.98;
        dummy.scale.set(gs, 1, gs);
        dummy.updateMatrix();
        ghosts.setMatrixAt(ghostCount, dummy.matrix);
        color.copy(palette.label).multiplyScalar(0.35 + 0.35 * anim.ghost[i]);
        color.lerp(palette.body, recede * 0.8);
        ghosts.setColorAt(ghostCount, color);
        anim.tileOfGhost[ghostCount] = i;
        ghostCount += 1;
      }
    }
    for (let g = ghostCount; g < tileCount; g += 1) anim.tileOfGhost[g] = -1;
    ghosts.count = ghostCount;

    // Children as small floating shards around the parent crystal.
    for (let p = 0; p < pips.length; p += 1) {
      const pip = pips[p];
      const place = placements[pip.tile];
      const parentHere = pip.parent < at.count ? anim.scale[pip.tile] : 0;
      anim.pipScale[p] = reducedMotion
        ? parentHere
        : THREE.MathUtils.damp(anim.pipScale[p], parentHere, 6, delta);
      const ps = anim.pipScale[p] * (0.6 + 0.4 * anim.weight[pip.tile]);
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      const orbit = pip.angle + (reducedMotion ? 0 : anim.pulse * 0.6);
      tmp.set(Math.cos(orbit) * 1.2, 0, Math.sin(orbit) * 1.2);
      tmp.applyQuaternion(place.quaternion).add(place.position);
      tmp.addScaledVector(
        tmp2,
        0.6 + anim.height[pip.tile] * 0.5 + Math.sin(orbit * 2) * 0.15
      );
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(ps, ps, ps);
      dummy.updateMatrix();
      pipMesh.setMatrixAt(p, dummy.matrix);
      color
        .copy(palette.status.active)
        .multiplyScalar(1.4)
        .lerp(palette.body, recede * 0.7);
      pipMesh.setColorAt(p, color);
    }

    crystals.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
    ground.instanceMatrix.needsUpdate = true;
    ghosts.instanceMatrix.needsUpdate = true;
    pipMesh.instanceMatrix.needsUpdate = true;
    if (crystals.instanceColor) crystals.instanceColor.needsUpdate = true;
    if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
    if (ghosts.instanceColor) ghosts.instanceColor.needsUpdate = true;
    if (pipMesh.instanceColor) pipMesh.instanceColor.needsUpdate = true;

    const a = anchor;
    const exemplarTile = d.exemplar >= 0 ? tileOfAgent[d.exemplar] : -1;
    if (exemplarTile >= 0 && anim.present[exemplarTile]) {
      const place = placements[exemplarTile];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp
        .copy(place.position)
        .addScaledVector(tmp2, anim.height[exemplarTile] + 0.3);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point))
        a.setExemplar(point.x, point.y);
      else a.clearExemplar();
    } else a.clearExemplar();
    if (d.selected >= 0 && tileOfAgent[d.selected] >= 0) {
      const ti = tileOfAgent[d.selected];
      const place = placements[ti];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, anim.height[ti] + 0.5);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point))
        a.setFocus(d.selected, point.x, point.y);
      else a.clearFocus();
    } else a.clearFocus();
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      a,
      2.2
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
      <directionalLight
        position={[40, 70, 10]}
        intensity={1.2}
        color={0xffffff}
      />
      <directionalLight
        position={[-50, 30, -40]}
        intensity={0.8}
        color={0x9fd8ff}
      />
      <pointLight
        position={[0, 18, 0]}
        intensity={30}
        distance={60}
        color={0xffe9c4}
      />

      {/* A black lacquer globe underneath: nearly no reflection, so the crystals carry the light. */}
      <mesh position={SPHERE_CENTER} raycast={() => null}>
        <sphereGeometry args={[SPHERE_RADIUS - 0.25, 96, 64]} />
        <meshStandardMaterial
          color={0x04060b}
          roughness={0.92}
          metalness={0}
          envMapIntensity={0.08}
        />
      </mesh>

      <instancedMesh
        ref={groundRef}
        args={[groundGeometry, undefined, tileCount]}
        onPointerMove={hoverTile}
        onPointerOut={leaveTile}
        frustumCulled={false}
      >
        <meshPhysicalMaterial
          roughness={0.8}
          metalness={0}
          transmission={0.35}
          thickness={0.3}
          ior={1.3}
          envMapIntensity={0.15}
        />
      </instancedMesh>

      <instancedMesh
        ref={coresRef}
        args={[coreGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>

      <instancedMesh
        ref={crystalsRef}
        args={[crystalGeometry, undefined, tileCount]}
        onPointerMove={hoverTile}
        onPointerOut={leaveTile}
        frustumCulled={false}
      >
        <meshPhysicalMaterial
          roughness={0.04}
          metalness={0}
          transmission={1}
          thickness={1.6}
          ior={1.9}
          dispersion={8}
          iridescence={0.7}
          iridescenceIOR={1.35}
          clearcoat={1}
          clearcoatRoughness={0.05}
          specularIntensity={1.2}
          envMapIntensity={1.4}
          attenuationDistance={2.5}
          attenuationColor={new THREE.Color(0xdff3ff)}
        />
      </instancedMesh>

      <instancedMesh
        ref={ghostsRef}
        args={[ghostGeometry, undefined, tileCount]}
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

      <instancedMesh
        ref={pipsRef}
        args={[pipGeometry, undefined, Math.max(1, pips.length)]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </>
  );
}
