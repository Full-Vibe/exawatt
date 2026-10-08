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
 * Every tile is one instance of one hex prism. An agent tile carries its
 * status colour and a raised emissive cap; a territory tile is ground; the
 * ring beyond the territory is drawn as ghost outlines and a click on one
 * adds an agent. Delegated children sit as small pips on the parent's
 * vertices with hairline tethers. The sphere body underneath is a dark globe
 * with faint graticule so even a one-agent slice reads as a piece of
 * something round.
 *
 * Per-frame work mutates preallocated arrays and writes instance buffers.
 * Nothing allocates in `useFrame`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt } from '../fleet-model';
import { SPHERE_CENTER } from '../sphere';
import type { VisualProps } from '../visual-contract';
import { CameraRig } from './camera-rig';
import { GlobeBody } from './globe-body';
import {
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
} from './shared';

const TILE_HEIGHT = 0.42;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const point = { x: 0, y: 0 };

function makeAnim(tileCount: number, pipCount: number) {
  return {
    scale: new Float32Array(tileCount),
    lift: new Float32Array(tileCount),
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    present: new Uint8Array(tileCount),
    ghostIndex: new Int32Array(tileCount).fill(-1),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    pulse: 0,
    shown: 1,
    hover: -1,
    pipScale: new Float32Array(pipCount),
  };
}

export function CrustVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  onExpand,
  onHoverChange,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileCount = model.tiles.length;

  // Children: pips on the parent's vertices.
  const pips = useMemo(() => {
    const out: { tile: number; angle: number; parent: number }[] = [];
    model.agents.forEach(agent => {
      if (!agent.children) return;
      const tileIndex = model.tiles.findIndex(t => t.agent === agent.id);
      for (let c = 0; c < agent.children; c += 1) {
        out.push({
          tile: tileIndex,
          angle: ((c + 0.5) / agent.children) * Math.PI * 2 + agent.id,
          parent: agent.id,
        });
      }
    });
    return out;
  }, [model]);

  const tilesRef = useRef<THREE.InstancedMesh>(null);
  const capsRef = useRef<THREE.InstancedMesh>(null);
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const pipsRef = useRef<THREE.InstancedMesh>(null);
  const tethersRef = useRef<THREE.LineSegments>(null);

  // Per-tile animated state, preallocated once and mutated in place.
  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
  if (animRef.current === null)
    animRef.current = makeAnim(tileCount, pips.length);
  const anim = animRef.current;
  const shownRef = useRef(1);
  const { size } = useThree();
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);

  const geometry = useMemo(
    () => new THREE.CylinderGeometry(0.9, 0.9, TILE_HEIGHT, 6, 1),
    []
  );
  const capGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.56, 0.56, 0.1, 6, 1),
    []
  );
  const ghostGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.76, 0.86, 6, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 6);
    return g;
  }, []);
  const pipGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.2, 0.2, 0.12, 6, 1),
    []
  );
  const tetherGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(pips.length * 6), 3)
    );
    return g;
  }, [pips.length]);

  useEffect(
    () => () => {
      geometry.dispose();
      capGeometry.dispose();
      ghostGeometry.dispose();
      pipGeometry.dispose();
      tetherGeometry.dispose();
    },
    [geometry, capGeometry, ghostGeometry, pipGeometry, tetherGeometry]
  );

  // Hover and click on the instanced tiles.
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
    const tiles = tilesRef.current;
    const caps = capsRef.current;
    const ghosts = ghostsRef.current;
    const pipMesh = pipsRef.current;
    const tethers = tethersRef.current;
    if (!tiles || !caps || !ghosts || !pipMesh || !tethers) return;

    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.pulse += delta;
    const breathe = reducedMotion ? 0 : (Math.sin(anim.pulse * 2.2) + 1) * 0.5;
    const recede = d.recede;

    let ghostCount = 0;
    for (let i = 0; i < tileCount; i += 1) {
      const tile = model.tiles[i];
      const place = placements[i];
      const present = at.tilePresent(tile);
      anim.present[i] = present ? 1 : 0;
      const isAgent = tile.agent >= 0 && tile.agent < at.count;
      const agent = isAgent ? model.agents[tile.agent] : null;

      // Targets.
      const scaleTarget = present ? 1 : 0;
      const weightTarget = agent
        ? highlightWeight(agent.status, d.highlight)
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
        if (d.highlight && weightTarget === 1) liftTarget += 0.25;
        if (tile.agent === d.exemplar) liftTarget += 0.2;
        if (tile.agent === anim.hover) liftTarget += 0.15;
      }

      if (reducedMotion) {
        anim.scale[i] = scaleTarget;
        anim.lift[i] = liftTarget;
        anim.weight[i] = weightTarget;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(
          anim.scale[i],
          scaleTarget,
          6,
          delta
        );
        anim.lift[i] = THREE.MathUtils.damp(anim.lift[i], liftTarget, 5, delta);
        anim.weight[i] = THREE.MathUtils.damp(
          anim.weight[i],
          weightTarget,
          5,
          delta
        );
      }
      const s = anim.scale[i];
      const w = anim.weight[i];

      // Tile body.
      const thickness = 1 + anim.lift[i] * 2.4;
      tmp.copy(place.position);
      // lift along the normal so the tile grows outward from the sphere
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.addScaledVector(tmp2, (TILE_HEIGHT * (thickness - 1)) / 2);
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(s * 0.97, s * thickness, s * 0.97);
      dummy.updateMatrix();
      tiles.setMatrixAt(i, dummy.matrix);

      if (agent) {
        color.copy(palette.status[agent.status]);
        color.lerp(palette.dim, (1 - w) * 0.78);
        if (agent.status === 'active' && w > 0.5)
          color.lerp(palette.label, breathe * 0.08);
      } else {
        color.copy(palette.ground);
        // Territory tiles nearest the agents are a touch brighter.
        color.lerp(palette.groundEdge, tile.ring === 0 ? 0.3 : 0.12);
      }
      color.lerp(palette.body, recede * 0.7);
      tiles.setColorAt(i, color);

      // Emissive cap on agent tiles.
      const capScale = agent ? s * (0.75 + 0.25 * w) : 0;
      tmp.addScaledVector(tmp2, (TILE_HEIGHT * thickness) / 2 + 0.05);
      dummy.position.copy(tmp);
      dummy.scale.set(capScale, capScale > 0 ? 1 : 0, capScale);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
      if (agent) {
        color.copy(palette.status[agent.status]);
        const glow =
          0.55 +
          0.9 * w +
          (agent.status === 'needs-you' ? breathe * 0.5 * w : 0);
        color.multiplyScalar(glow * (1 - recede * 0.6));
      } else color.setScalar(0);
      caps.setColorAt(i, color);

      // Ghosts: the next ring out, drawn as outlines, clickable.
      const ghost = at.tileGhost(tile);
      const ghostTarget = ghost ? 1 : 0;
      anim.ghost[i] = reducedMotion
        ? ghostTarget
        : THREE.MathUtils.damp(anim.ghost[i], ghostTarget, 5, delta);
      if (anim.ghost[i] > 0.02) {
        dummy.position
          .copy(place.position)
          .addScaledVector(tmp2, present ? TILE_HEIGHT / 2 + 0.04 : 0.04);
        dummy.quaternion.copy(place.quaternion);
        const gs = anim.ghost[i] * 0.98;
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

    // Children pips and tethers.
    const positions = tethers.geometry.attributes
      .position as THREE.BufferAttribute;
    for (let p = 0; p < pips.length; p += 1) {
      const pip = pips[p];
      const place = placements[pip.tile];
      const parentHere = pip.parent < at.count ? anim.scale[pip.tile] : 0;
      anim.pipScale[p] = reducedMotion
        ? parentHere
        : THREE.MathUtils.damp(anim.pipScale[p], parentHere, 6, delta);
      const parentScale = anim.pipScale[p];
      const w = anim.weight[pip.tile];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      // vertex direction in tile-local XZ, rotated into world
      tmp.set(Math.cos(pip.angle) * 1.1, 0, Math.sin(pip.angle) * 1.1);
      tmp.applyQuaternion(place.quaternion);
      tmp.add(place.position);
      tmp.addScaledVector(tmp2, 0.35 + anim.lift[pip.tile] * 0.8);
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      const ps = parentScale * (0.6 + 0.4 * w);
      dummy.scale.set(ps, ps, ps);
      dummy.updateMatrix();
      pipMesh.setMatrixAt(p, dummy.matrix);
      color.copy(palette.status.active).multiplyScalar(0.6 + 0.6 * w);
      color.lerp(palette.body, recede * 0.7);
      pipMesh.setColorAt(p, color);
      // tether from parent cap to pip; collapsed to a point while absent
      if (parentScale > 0.05) {
        positions.setXYZ(
          p * 2,
          place.position.x + tmp2.x * (TILE_HEIGHT + anim.lift[pip.tile] * 0.8),
          place.position.y + tmp2.y * (TILE_HEIGHT + anim.lift[pip.tile] * 0.8),
          place.position.z + tmp2.z * (TILE_HEIGHT + anim.lift[pip.tile] * 0.8)
        );
        positions.setXYZ(p * 2 + 1, tmp.x, tmp.y, tmp.z);
      } else {
        positions.setXYZ(p * 2, tmp.x, tmp.y, tmp.z);
        positions.setXYZ(p * 2 + 1, tmp.x, tmp.y, tmp.z);
      }
    }
    positions.needsUpdate = true;
    tethers.visible = pips.length > 0;

    tiles.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    ghosts.instanceMatrix.needsUpdate = true;
    pipMesh.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    if (caps.instanceColor) caps.instanceColor.needsUpdate = true;
    if (ghosts.instanceColor) ghosts.instanceColor.needsUpdate = true;
    if (pipMesh.instanceColor) pipMesh.instanceColor.needsUpdate = true;

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

    if (anim.hover >= 0) {
      const place = placements[tileOfAgent[anim.hover]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, TILE_HEIGHT + 0.6);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setHover(anim.hover, point.x, point.y);
      } else a.clearHover();
    } else a.clearHover();
    writeLabelAnchors(
      model,
      at,
      placements,
      state.camera,
      size.width,
      size.height,
      a,
      TILE_HEIGHT + 0.5
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
      <fog attach="fog" args={[theme.canvas, 60, 160]} />
      <hemisphereLight args={[0xcfe6ff, 0x101420, 0.9]} />
      <directionalLight position={[30, 60, 20]} intensity={1.6} />
      <directionalLight position={[-40, 20, -30]} intensity={0.35} />

      <GlobeBody palette={palette} graticule={0.1} />

      <instancedMesh
        ref={tilesRef}
        args={[geometry, undefined, tileCount]}
        onPointerMove={hoverTile}
        onPointerOut={leaveTile}
        frustumCulled={false}
      >
        <meshStandardMaterial roughness={0.6} metalness={0.15} />
      </instancedMesh>

      <instancedMesh
        ref={capsRef}
        args={[capGeometry, undefined, tileCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
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

      <lineSegments
        ref={tethersRef}
        geometry={tetherGeometry}
        frustumCulled={false}
      >
        <lineBasicMaterial
          color={palette.label}
          transparent
          opacity={0.35}
          depthWrite={false}
        />
      </lineSegments>
    </>
  );
}
