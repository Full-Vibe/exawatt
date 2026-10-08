'use client';

/**
 * Option C, Dome (ENG-031 W15).
 *
 * The shipped board's own vocabulary, bent onto the sphere: a Project is a
 * thin zone ring that hugs its present agents, an agent is a status-coloured
 * mark lying on the surface, a mark that needs you wears a halo, children sit
 * as pips with hairline tethers. It is the nearest step from what the
 * homepage ships today, and it answers the operator's "a mix of what that is
 * and what we have now" with the fewest new ideas: same marks, same rings,
 * same lenses, but demonstrably round and growing.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { axialToPlane, fleetAt } from '../fleet-model';
import { SPHERE_CENTER, planeToSphere } from '../sphere';
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

const RING_SEGMENTS = 96;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const point = { x: 0, y: 0 };

function makeAnim(agentCount: number, projectCount: number) {
  return {
    scale: new Float32Array(agentCount),
    weight: new Float32Array(agentCount).fill(1),
    ringRadius: new Float32Array(projectCount),
    ringAlpha: new Float32Array(projectCount),
    pulse: 0,
    hover: -1,
  };
}

export function DomeVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  onHoverChange,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const agentCount = model.agents.length;
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

  const marksRef = useRef<THREE.InstancedMesh>(null);
  const halosRef = useRef<THREE.InstancedMesh>(null);
  const pipsRef = useRef<THREE.InstancedMesh>(null);
  const tethersRef = useRef<THREE.LineSegments>(null);
  const ringsRef = useRef<(THREE.LineLoop | null)[]>([]);
  const shownRef = useRef(1);
  const { size } = useThree();

  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
  if (animRef.current === null)
    animRef.current = makeAnim(agentCount, model.projects.length);
  const anim = animRef.current;

  const markGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.44, 0.44, 0.16, 24, 1),
    []
  );
  const haloGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.62, 0.74, 40, 1);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const pipGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.18, 0.18, 0.1, 12, 1),
    []
  );
  const ringGeometries = useMemo(
    () =>
      model.projects.map(() => {
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.BufferAttribute(new Float32Array(RING_SEGMENTS * 3), 3)
        );
        return g;
      }),
    [model]
  );
  const tetherGeometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array(Math.max(1, pips.length) * 6),
        3
      )
    );
    return g;
  }, [pips.length]);
  useEffect(
    () => () => {
      markGeometry.dispose();
      haloGeometry.dispose();
      pipGeometry.dispose();
      tetherGeometry.dispose();
      ringGeometries.forEach(g => g.dispose());
    },
    [markGeometry, haloGeometry, pipGeometry, tetherGeometry, ringGeometries]
  );

  const hoverMark = (e: ThreeEvent<PointerEvent>) => {
    const id = e.instanceId ?? -1;
    const agent = id >= 0 && anim.scale[id] > 0.5 ? id : -1;
    if (agent !== anim.hover) {
      anim.hover = agent;
      onHoverChange?.(agent);
    }
  };
  const leaveMark = () => {
    if (anim.hover !== -1) {
      anim.hover = -1;
      onHoverChange?.(-1);
    }
  };

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = drive.current;
    const marks = marksRef.current;
    const halos = halosRef.current;
    const pipMesh = pipsRef.current;
    const tethers = tethersRef.current;
    if (!marks || !halos || !pipMesh || !tethers) return;
    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.pulse += delta;
    const breathe = reducedMotion
      ? 0.5
      : (Math.sin(anim.pulse * 2.4) + 1) * 0.5;
    const recede = d.recede;

    for (let i = 0; i < agentCount; i += 1) {
      const agent = model.agents[i];
      const place = placements[tileOfAgent[i]];
      const present = i < at.count ? 1 : 0;
      const weight = present ? highlightWeight(agent.status, d.highlight) : 1;
      if (reducedMotion) {
        anim.scale[i] = present;
        anim.weight[i] = weight;
      } else {
        anim.scale[i] = THREE.MathUtils.damp(anim.scale[i], present, 6, delta);
        anim.weight[i] = THREE.MathUtils.damp(anim.weight[i], weight, 5, delta);
      }
      const s = anim.scale[i];
      const w = anim.weight[i];
      const lead = i === d.exemplar || i === anim.hover ? 1.25 : 1;
      const sizeByStatus =
        agent.status === 'needs-you' ? 1.2 : agent.status === 'off' ? 0.72 : 1;
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp
        .copy(place.position)
        .addScaledVector(
          tmp2,
          0.1 + (d.highlight && w > 0.5 ? 0.25 : 0) + (lead > 1 ? 0.2 : 0)
        );
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      const ms = s * sizeByStatus * lead * (0.8 + 0.2 * w);
      dummy.scale.set(ms, 1, ms);
      dummy.updateMatrix();
      marks.setMatrixAt(i, dummy.matrix);
      color.copy(palette.status[agent.status]);
      color.multiplyScalar(0.75 + 0.3 * w);
      color.lerp(palette.dim, (1 - w) * 0.8);
      color.lerp(palette.body, recede * 0.7);
      marks.setColorAt(i, color);

      // Halo on marks that need you.
      const halo =
        agent.status === 'needs-you'
          ? s * (1 + breathe * 0.25) * (0.5 + 0.5 * w)
          : 0;
      dummy.position.copy(place.position).addScaledVector(tmp2, 0.2);
      dummy.scale.set(halo, 1, halo);
      dummy.updateMatrix();
      halos.setMatrixAt(i, dummy.matrix);
      color
        .copy(palette.status['needs-you'])
        .multiplyScalar(0.6 + breathe * 0.4);
      color.lerp(palette.body, recede * 0.7);
      halos.setColorAt(i, color);
    }

    // Zone rings hug the present agents of each Project.
    for (const project of model.projects) {
      const loop = ringsRef.current[project.id];
      if (!loop) continue;
      const present = at.projects.includes(project);
      let edge = 0;
      if (present) {
        const last = Math.min(at.count, project.first + project.count) - 1;
        edge = model.agents[last].ring;
      }
      const radiusTarget = present ? (edge + 1.55) * Math.sqrt(3) : 0.5;
      const alphaTarget = present ? 1 : 0;
      if (reducedMotion) {
        anim.ringRadius[project.id] = radiusTarget;
        anim.ringAlpha[project.id] = alphaTarget;
      } else {
        anim.ringRadius[project.id] = THREE.MathUtils.damp(
          anim.ringRadius[project.id],
          radiusTarget,
          4,
          delta
        );
        anim.ringAlpha[project.id] = THREE.MathUtils.damp(
          anim.ringAlpha[project.id],
          alphaTarget,
          5,
          delta
        );
      }
      const [cx, cy] = axialToPlane(project.center);
      const r = anim.ringRadius[project.id];
      const positions = loop.geometry.attributes
        .position as THREE.BufferAttribute;
      for (let k = 0; k < RING_SEGMENTS; k += 1) {
        const a = (k / RING_SEGMENTS) * Math.PI * 2;
        planeToSphere(
          cx + Math.cos(a) * r,
          cy + Math.sin(a) * r,
          tmp,
          undefined,
          0.12
        );
        positions.setXYZ(k, tmp.x, tmp.y, tmp.z);
      }
      positions.needsUpdate = true;
      const material = loop.material as THREE.LineBasicMaterial;
      material.opacity = anim.ringAlpha[project.id] * 0.55 * (1 - recede * 0.7);
      loop.visible = anim.ringAlpha[project.id] > 0.02;
    }

    // Children pips and tethers.
    const tpos = tethers.geometry.attributes.position as THREE.BufferAttribute;
    for (let p = 0; p < pips.length; p += 1) {
      const pip = pips[p];
      const place = placements[tileOfAgent[pip.agent]];
      const s = anim.scale[pip.agent];
      const w = anim.weight[pip.agent];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.set(Math.cos(pip.angle) * 1.15, 0, Math.sin(pip.angle) * 1.15);
      tmp
        .applyQuaternion(place.quaternion)
        .add(place.position)
        .addScaledVector(tmp2, 0.12);
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      const ps = s * (0.6 + 0.4 * w);
      dummy.scale.set(ps, 1, ps);
      dummy.updateMatrix();
      pipMesh.setMatrixAt(p, dummy.matrix);
      color
        .copy(palette.status.active)
        .multiplyScalar(0.5 + 0.6 * w)
        .lerp(palette.body, recede * 0.7);
      pipMesh.setColorAt(p, color);
      if (s > 0.05) {
        tpos.setXYZ(
          p * 2,
          place.position.x + tmp2.x * 0.15,
          place.position.y + tmp2.y * 0.15,
          place.position.z + tmp2.z * 0.15
        );
        tpos.setXYZ(p * 2 + 1, tmp.x, tmp.y, tmp.z);
      } else {
        tpos.setXYZ(p * 2, tmp.x, tmp.y, tmp.z);
        tpos.setXYZ(p * 2 + 1, tmp.x, tmp.y, tmp.z);
      }
    }
    tpos.needsUpdate = true;
    tethers.visible = pips.length > 0;

    marks.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    pipMesh.instanceMatrix.needsUpdate = true;
    if (marks.instanceColor) marks.instanceColor.needsUpdate = true;
    if (halos.instanceColor) halos.instanceColor.needsUpdate = true;
    if (pipMesh.instanceColor) pipMesh.instanceColor.needsUpdate = true;

    const a = anchor;
    if (d.exemplar >= 0 && d.exemplar < at.count) {
      const place = placements[tileOfAgent[d.exemplar]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 0.9);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setExemplar(point.x, point.y);
      } else a.clearExemplar();
    } else a.clearExemplar();
    if (anim.hover >= 0) {
      const place = placements[tileOfAgent[anim.hover]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 0.9);
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
      0.6
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
      <hemisphereLight args={[0xcfe6ff, 0x101420, 0.8]} />
      <directionalLight position={[30, 60, 20]} intensity={1.2} />
      <GlobeBody palette={palette} graticule={0.14} />

      {model.projects.map(project => (
        <lineLoop
          key={project.id}
          ref={el => {
            ringsRef.current[project.id] = el;
          }}
          geometry={ringGeometries[project.id]}
          frustumCulled={false}
        >
          <lineBasicMaterial
            color={theme.zone}
            transparent
            opacity={0}
            depthWrite={false}
          />
        </lineLoop>
      ))}

      <instancedMesh
        ref={marksRef}
        args={[markGeometry, undefined, agentCount]}
        onPointerMove={hoverMark}
        onPointerOut={leaveMark}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={halosRef}
        args={[haloGeometry, undefined, agentCount]}
        raycast={() => null}
        frustumCulled={false}
      >
        <meshBasicMaterial
          toneMapped={false}
          transparent
          opacity={0.9}
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
