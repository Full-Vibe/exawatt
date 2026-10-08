'use client';

/**
 * Option B, LiDAR (ENG-031 W15, operator brief 2026-10-08).
 *
 * "A point cloud LiDAR view of an agent world, a little high-tech, a little
 * digital." The same territory on the same sphere, but nothing is a solid:
 * every tile is a scatter of returns along its edges, every agent is a column
 * of returns rising off its tile, coloured by status, and a scan sweep turns
 * about the fleet's centre lighting what it passes and leaving an afterglow.
 * Beyond the territory the sphere itself is sparsely scanned, so the world
 * reads as larger than the fleet.
 *
 * One `Points` draw call. The vertex shader does the sweep; the CPU writes
 * one float per point per frame (presence times highlight), nothing else.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt, type FleetModel } from '../fleet-model';
import { SPHERE_CENTER, SPHERE_RADIUS } from '../sphere';
import type { VisualProps } from '../visual-contract';
import { CameraRig, fleetExtent } from './camera-rig';
import {
  highlightWeight,
  paletteFrom,
  placeTiles,
  projectToCanvas,
  writeLabelAnchors,
  type Palette,
  type TilePlacement,
} from './shared';

const VERT = /* glsl */ `
  attribute vec3 pointColor;
  attribute float pointSize;
  attribute float pointAlpha;
  attribute float pointPhase;
  uniform float uSweep;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform vec3 uCenter;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // azimuth about the fleet centre, in the sphere's tangent plane
    vec3 rel = position - uCenter;
    float az = atan(rel.z, rel.x);
    float diff = mod(uSweep - az + 6.28318530718, 6.28318530718);
    // bright at the sweep, long afterglow behind it
    float sweep = exp(-diff * 2.2) * 0.9 + exp(-diff * 0.45) * 0.35;
    float flicker = 0.85 + 0.15 * sin(uTime * 3.0 + pointPhase * 6.2831);
    vColor = pointColor * (0.55 + sweep * 1.6) * flicker;
    vAlpha = pointAlpha * (0.55 + sweep * 0.45);
    gl_PointSize = max(1.6, pointSize * uPixelRatio * (70.0 / max(1.0, -mv.z))) * (0.85 + sweep * 0.45);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float soft = smoothstep(0.25, 0.05, d);
    gl_FragColor = vec4(vColor, vAlpha * soft);
  }
`;

interface Cloud {
  positions: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  phases: Float32Array;
  /** Tile index each point belongs to, or -1 for the open sphere. */
  tile: Int32Array;
  /** Agent id each point belongs to, or -1. */
  agent: Int32Array;
  count: number;
}

function hash(i: number) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildCloud(
  model: FleetModel,
  placements: TilePlacement[],
  palette: Palette
): Cloud {
  const EDGE_POINTS = 36;
  const COLUMN_POINTS = 90;
  const CHILD_POINTS = 16;
  const SPHERE_POINTS = 9000;
  let total = SPHERE_POINTS;
  for (const tile of model.tiles) {
    total += EDGE_POINTS;
    if (tile.agent >= 0)
      total += COLUMN_POINTS + model.agents[tile.agent].children * CHILD_POINTS;
  }
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  const sizes = new Float32Array(total);
  const alphas = new Float32Array(total);
  const phases = new Float32Array(total);
  const tileOf = new Int32Array(total).fill(-1);
  const agentOf = new Int32Array(total).fill(-1);
  let n = 0;
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const push = (
    p: THREE.Vector3,
    c: THREE.Color,
    size: number,
    tile: number,
    agent: number
  ) => {
    positions[n * 3] = p.x;
    positions[n * 3 + 1] = p.y;
    positions[n * 3 + 2] = p.z;
    colors[n * 3] = c.r;
    colors[n * 3 + 1] = c.g;
    colors[n * 3 + 2] = c.b;
    sizes[n] = size;
    phases[n] = hash(n);
    tileOf[n] = tile;
    agentOf[n] = agent;
    n += 1;
  };

  // Open sphere: sparse returns over the cap the camera can see.
  const sphereColor = palette.grid.clone().multiplyScalar(0.55);
  for (let i = 0; i < SPHERE_POINTS; i += 1) {
    const u = hash(i * 3 + 1);
    const v = hash(i * 3 + 2);
    const theta = Math.sqrt(u) * 1.25; // denser toward the pole
    const phi = v * Math.PI * 2;
    const s = Math.sin(theta) * SPHERE_RADIUS;
    world.set(
      Math.cos(phi) * s,
      Math.cos(theta) * SPHERE_RADIUS - SPHERE_RADIUS + 0.08,
      Math.sin(phi) * s
    );
    push(world, sphereColor, 0.7 + hash(i * 5) * 0.6, -1, -1);
  }

  model.tiles.forEach((tile, i) => {
    const place = placements[i];
    normal.copy(place.position).sub(SPHERE_CENTER).normalize();
    const agent = tile.agent >= 0 ? model.agents[tile.agent] : null;
    const edgeColor = agent
      ? palette.status[agent.status].clone().lerp(palette.label, 0.25)
      : palette.grid.clone().lerp(palette.label, tile.ring === 0 ? 0.5 : 0.3);
    // returns along the hex edges
    for (let k = 0; k < EDGE_POINTS; k += 1) {
      const t = (k / EDGE_POINTS) * 6;
      const side = Math.floor(t);
      const f = t - side;
      const a0 = (side / 6) * Math.PI * 2 + Math.PI / 6;
      const a1 = ((side + 1) / 6) * Math.PI * 2 + Math.PI / 6;
      const r = 0.9;
      local.set(
        THREE.MathUtils.lerp(Math.cos(a0), Math.cos(a1), f) * r,
        0.04 + hash(i * 97 + k) * 0.06,
        THREE.MathUtils.lerp(Math.sin(a0), Math.sin(a1), f) * r
      );
      world.copy(local).applyQuaternion(place.quaternion).add(place.position);
      push(world, edgeColor, 1.15, i, -1);
    }
    if (agent) {
      // a column of returns above the tile: taller when it needs you
      const height =
        agent.status === 'needs-you'
          ? 3.4
          : agent.status === 'active'
            ? 2.0 + agent.burn * 1.4
            : agent.status === 'result'
              ? 1.4
              : 0.6;
      const c = palette.status[agent.status];
      for (let k = 0; k < COLUMN_POINTS; k += 1) {
        const h = hash(i * 131 + k * 7);
        const ang = hash(i * 17 + k * 3) * Math.PI * 2;
        const rad = Math.sqrt(hash(i * 29 + k * 11)) * 0.3;
        local.set(Math.cos(ang) * rad, 0.1 + h * height, Math.sin(ang) * rad);
        world.copy(local).applyQuaternion(place.quaternion).add(place.position);
        push(world, c, 1.2 + h * 0.9, i, agent.id);
      }
      for (let ch = 0; ch < agent.children; ch += 1) {
        const ang = ((ch + 0.5) / agent.children) * Math.PI * 2 + agent.id;
        for (let k = 0; k < CHILD_POINTS; k += 1) {
          const h = hash(i * 211 + ch * 19 + k);
          local.set(
            Math.cos(ang) * 1.25 + (hash(k * 5 + ch) - 0.5) * 0.3,
            0.1 + h * 0.6,
            Math.sin(ang) * 1.25 + (hash(k * 7 + ch) - 0.5) * 0.3
          );
          world
            .copy(local)
            .applyQuaternion(place.quaternion)
            .add(place.position);
          push(world, palette.status.active, 1.0, i, agent.id);
        }
      }
    }
  });

  return {
    positions,
    colors,
    sizes,
    alphas,
    phases,
    tile: tileOf,
    agent: agentOf,
    count: n,
  };
}

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const point = { x: 0, y: 0 };
const SCAN_POINTS = 48;

export function LidarVisual({
  model,
  theme,
  drive,
  anchor,
  reducedMotion,
  onHoverChange,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const cloudRef = useRef<Cloud | null>(null);
  if (cloudRef.current === null)
    cloudRef.current = buildCloud(model, placements, palette);
  const cloud = cloudRef.current;
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const shownRef = useRef(1);
  const { size } = useThree();
  const pointsRef = useRef<THREE.Points>(null);
  const scanRef = useRef<THREE.Line | null>(null);
  if (scanRef.current === null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(SCAN_POINTS * 3), 3)
    );
    const line = new THREE.Line(
      g,
      new THREE.LineBasicMaterial({
        color: theme.status.active,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      })
    );
    line.frustumCulled = false;
    scanRef.current = line;
  }
  const scanLine = scanRef.current;
  const animRef = useRef<{
    tileScale: Float32Array;
    tileWeight: Float32Array;
    agentScale: Float32Array;
  } | null>(null);
  if (animRef.current === null)
    animRef.current = {
      tileScale: new Float32Array(model.tiles.length),
      tileWeight: new Float32Array(model.tiles.length).fill(1),
      agentScale: new Float32Array(model.agents.length),
    };
  const { tileScale, tileWeight, agentScale } = animRef.current;
  const sweep = useRef(0);
  const hover = useRef(-1);

  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  if (geometryRef.current === null) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3));
    g.setAttribute('pointColor', new THREE.BufferAttribute(cloud.colors, 3));
    g.setAttribute('pointSize', new THREE.BufferAttribute(cloud.sizes, 1));
    g.setAttribute('pointAlpha', new THREE.BufferAttribute(cloud.alphas, 1));
    g.setAttribute('pointPhase', new THREE.BufferAttribute(cloud.phases, 1));
    g.setDrawRange(0, cloud.count);
    geometryRef.current = g;
  }
  const geometry = geometryRef.current;
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  if (materialRef.current === null)
    materialRef.current = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uSweep: { value: 0 },
        uTime: { value: 0 },
        uPixelRatio: { value: 1 },
        uCenter: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  const material = materialRef.current;
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      scanLine.geometry.dispose();
      (scanLine.material as THREE.Material).dispose();
    },
    [geometry, material, scanLine]
  );

  // Hover: nearest agent column to the pointer, in screen space, cheap.
  const { gl } = useThree();
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
  const hoverPointerRef = useRef({ x: 0, y: 0, active: false });

  const fleetExtentOf = (count: number) => fleetExtent(model, count);

  useFrame((state, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const d = drive.current;
    const points = pointsRef.current;
    if (!points) return;
    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));

    sweep.current += reducedMotion ? 0 : delta * 0.9;
    material.uniforms.uSweep.value = sweep.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
    material.uniforms.uPixelRatio.value = state.gl.getPixelRatio();

    // Per-tile presence and highlight, damped.
    for (let i = 0; i < model.tiles.length; i += 1) {
      const tile = model.tiles[i];
      const present = at.tilePresent(tile) ? 1 : 0;
      const agent = at.tileAgent(tile) ? model.agents[tile.agent] : null;
      const weight = agent ? highlightWeight(agent.status, d.highlight) : 1;
      if (reducedMotion) {
        tileScale[i] = present;
        tileWeight[i] = weight;
      } else {
        tileScale[i] = THREE.MathUtils.damp(tileScale[i], present, 5, delta);
        tileWeight[i] = THREE.MathUtils.damp(tileWeight[i], weight, 5, delta);
      }
    }
    for (let i = 0; i < model.agents.length; i += 1) {
      const present = i < at.count ? 1 : 0;
      agentScale[i] = reducedMotion
        ? present
        : THREE.MathUtils.damp(agentScale[i], present, 5, delta);
    }
    const fade = 1 - d.recede * 0.75;
    const alphas = cloud.alphas;
    for (let p = 0; p < cloud.count; p += 1) {
      const t = cloud.tile[p];
      if (t < 0) {
        alphas[p] = 0.5 * fade;
        continue;
      }
      const agentId = cloud.agent[p];
      if (agentId >= 0) {
        const w = tileWeight[t];
        let a = agentScale[agentId] * (0.25 + 0.75 * w) * fade;
        if (agentId === d.exemplar || agentId === hover.current)
          a = Math.min(1, a + 0.6);
        alphas[p] = a;
      } else {
        alphas[p] = tileScale[t] * 0.85 * fade;
      }
    }
    (geometry.attributes.pointAlpha as THREE.BufferAttribute).needsUpdate =
      true;

    // Sweep about the pole; the scan line is the sweep made visible.
    const center = material.uniforms.uCenter.value as THREE.Vector3;
    center.copy(SPHERE_CENTER);
    const scan = scanLine;
    {
      const pos = scan.geometry.attributes.position as THREE.BufferAttribute;
      const reach = Math.min(
        1.15,
        0.25 + fleetExtentOf(at.count) / SPHERE_RADIUS + 0.2
      );
      for (let k = 0; k < SCAN_POINTS; k += 1) {
        const theta = (k / (SCAN_POINTS - 1)) * reach;
        const sr = Math.sin(theta) * (SPHERE_RADIUS + 0.15);
        pos.setXYZ(
          k,
          Math.cos(sweep.current) * sr,
          Math.cos(theta) * (SPHERE_RADIUS + 0.15) - SPHERE_RADIUS,
          Math.sin(sweep.current) * sr
        );
      }
      pos.needsUpdate = true;
      (scan.material as THREE.LineBasicMaterial).opacity = 0.35 * fade;
    }

    // Hover: nearest present agent column in screen space.
    let best = -1;
    const hoverPointer = hoverPointerRef.current;
    if (hoverPointer.active) {
      let bestD = 28 * 28;
      for (let i = 0; i < at.count; i += 1) {
        const ti = tileOfAgent[i];
        const place = placements[ti];
        tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
        tmp.copy(place.position).addScaledVector(tmp2, 0.8);
        if (!projectToCanvas(tmp, state.camera, size.width, size.height, point))
          continue;
        const dx = point.x - hoverPointer.x;
        const dy = point.y - hoverPointer.y;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    if (best !== hover.current) {
      hover.current = best;
      onHoverChange?.(best);
    }

    const a = anchor;
    const exemplarTile =
      d.exemplar >= 0 && d.exemplar < at.count ? tileOfAgent[d.exemplar] : -1;
    if (exemplarTile >= 0) {
      const place = placements[exemplarTile];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 2.2);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setExemplar(point.x, point.y);
      } else a.clearExemplar();
    } else a.clearExemplar();
    if (hover.current >= 0) {
      const place = placements[tileOfAgent[hover.current]];
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.copy(place.position).addScaledVector(tmp2, 1.6);
      if (projectToCanvas(tmp, state.camera, size.width, size.height, point)) {
        a.setHover(hover.current, point.x, point.y);
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
      1.6
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
      <fog attach="fog" args={[theme.canvas, 50, 150]} />
      <points
        ref={pointsRef}
        geometry={geometry}
        material={material}
        frustumCulled={false}
      />
      <primitive object={scanLine} />
    </>
  );
}
