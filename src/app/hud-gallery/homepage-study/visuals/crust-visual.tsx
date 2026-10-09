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
 * Every tile is one instance of one hex prism: territory in the ground
 * material, agents in the body material of the chosen option (W15c,
 * `crust-materials.ts`). An agent carries its status as colour and rise, an
 * inlaid light on top that is a glyph for its harness when kind marks are
 * on (`crust-glyphs.ts`) and turns while it works, and, in the translucent
 * options, a light inside the body. The ring beyond the territory is drawn
 * as ghost outlines and a click on one adds an agent. Delegated children
 * sit as small pips on the parent's vertices with hairline tethers. The
 * sphere body underneath is a dark globe with faint graticule so even a
 * one-agent slice reads as a piece of something round.
 *
 * Per-frame work mutates preallocated arrays and writes instance buffers.
 * Nothing allocates in `useFrame`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { fleetAt } from '../fleet-model';
import { SPHERE_CENTER } from '../sphere';
import { stageBlend } from '../stages';
import type { VisualProps } from '../visual-contract';
import { CameraRig } from './camera-rig';
import {
  GLYPH_COUNT,
  glyphIndexFor,
  makeGlyphGeometries,
} from './crust-glyphs';
import {
  disposeCrustMaterial,
  hexPrismGeometry,
  makeCrustMaterial,
} from './crust-materials';
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

const TILE_HEIGHT = 0.42;
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const spin = new THREE.Quaternion();
const yAxis = new THREE.Vector3(0, 1, 0);
const point = { x: 0, y: 0 };
const WHITE = new THREE.Color(0xffffff);
/** Neutral body for the metal option; the status lives on the inlay. */
const METAL = new THREE.Color(0x8a9199);
/** Frosted clear ground for the acrylic option. */
const FROST = new THREE.Color(0xb9d2e4);
const SPIN_RATE = 0.5;
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

function makeAnim(tileCount: number, pipCount: number) {
  return {
    scale: new Float32Array(tileCount),
    lift: new Float32Array(tileCount),
    weight: new Float32Array(tileCount).fill(1),
    ghost: new Float32Array(tileCount),
    present: new Uint8Array(tileCount),
    ghostIndex: new Int32Array(tileCount).fill(-1),
    tileOfGhost: new Int32Array(tileCount).fill(-1),
    glyphCount: new Int32Array(GLYPH_COUNT),
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
  material,
  marks,
  signal,
  light = 'room',
  closeUp = false,
  onExpand,
  onHoverChange,
}: VisualProps) {
  const palette = useMemo(() => paletteFrom(theme), [theme]);
  const placements = useMemo(() => placeTiles(model), [model]);
  const tileCount = model.tiles.length;
  const spec = useMemo(() => makeCrustMaterial(material), [material]);
  const sig = useMemo(() => crustSignal(signal), [signal]);
  useEffect(() => () => disposeCrustMaterial(spec), [spec]);
  useRoomEnvironment(spec.environment, light);

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

  const groundRef = useRef<THREE.InstancedMesh>(null);
  const agentsRef = useRef<THREE.InstancedMesh>(null);
  const coresRef = useRef<THREE.InstancedMesh>(null);
  const glyphRefs = useRef<(THREE.InstancedMesh | null)[]>(
    Array.from({ length: GLYPH_COUNT }, () => null)
  );
  const ghostsRef = useRef<THREE.InstancedMesh>(null);
  const rimsRef = useRef<THREE.InstancedMesh>(null);
  const glowsRef = useRef<THREE.InstancedMesh>(null);
  const selectionRef = useRef<THREE.Mesh>(null);
  const pipsRef = useRef<THREE.InstancedMesh>(null);
  const tethersRef = useRef<THREE.LineSegments>(null);

  // Per-tile animated state, preallocated once and mutated in place.
  const animRef = useRef<ReturnType<typeof makeAnim> | null>(null);
  if (animRef.current === null)
    animRef.current = makeAnim(tileCount, pips.length);
  const anim = animRef.current;
  const shownRef = useRef(1);
  const { size, gl } = useThree();
  const tileOfAgent = useMemo(() => {
    const map = new Int32Array(model.agents.length).fill(-1);
    model.tiles.forEach((t, i) => {
      if (t.agent >= 0) map[t.agent] = i;
    });
    return map;
  }, [model]);
  const glyphOfAgent = useMemo(
    () => Int8Array.from(model.agents, a => glyphIndexFor(a.source)),
    [model]
  );

  const geometry = useMemo(
    () => hexPrismGeometry(0.9, TILE_HEIGHT, spec.edge),
    [spec.edge]
  );
  const coreGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.46, 0.46, 1, 6, 1),
    []
  );
  const glyphGeometries = useMemo(() => makeGlyphGeometries(), []);
  const ghostGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.76, 0.86, 6, 1);
    g.rotateX(-Math.PI / 2);
    g.rotateY(Math.PI / 6);
    return g;
  }, []);
  // Rim: a thin lit shell around the top edge, so the status is light on
  // the side of the tile, not a line drawn on top of it.
  const rimGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.905, 0.905, 0.07, 6, 1, true),
    []
  );
  // Lamp: light spilling under the tile, a soft radial falloff on a quad.
  const glowGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(3.2, 3.2);
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);
  const glowTexture = useMemo(() => makeGlowTexture(), []);
  const selectionGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(0.96, 1.01, 6, 1);
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
      coreGeometry.dispose();
      glyphGeometries.forEach(g => g.dispose());
      ghostGeometry.dispose();
      rimGeometry.dispose();
      glowGeometry.dispose();
      glowTexture.dispose();
      selectionGeometry.dispose();
      pipGeometry.dispose();
      tetherGeometry.dispose();
    },
    [
      geometry,
      coreGeometry,
      glyphGeometries,
      ghostGeometry,
      rimGeometry,
      glowGeometry,
      glowTexture,
      selectionGeometry,
      pipGeometry,
      tetherGeometry,
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
    const ground = groundRef.current;
    const agents = agentsRef.current;
    const cores = coresRef.current;
    const ghosts = ghostsRef.current;
    const rims = rimsRef.current;
    const glows = glowsRef.current;
    const selection = selectionRef.current;
    const pipMesh = pipsRef.current;
    const tethers = tethersRef.current;
    const glyphs = glyphRefs.current;
    if (
      !ground ||
      !agents ||
      !cores ||
      !ghosts ||
      !rims ||
      !glows ||
      !selection ||
      !pipMesh ||
      !tethers
    )
      return;
    for (let g = 0; g < GLYPH_COUNT; g += 1) if (!glyphs[g]) return;

    const shown = shownRef.current;
    const at = fleetAt(model, Math.round(shown));
    anim.pulse += delta;
    const breathe = reducedMotion ? 0 : (Math.sin(anim.pulse * 2.2) + 1) * 0.5;
    const recede = d.recede;
    // Stage states blend on the rail, with the camera.
    const b = stageBlend(d.rail, undefined, blendScratch);
    const h0 = d.highlights[b.from] ?? null;
    const h1 = d.highlights[b.to] ?? null;
    const lifted = THREE.MathUtils.lerp(h0 ? 1 : 0, h1 ? 1 : 0, b.t);

    let ghostCount = 0;
    let coreCount = 0;
    let rimCount = 0;
    let glowCount = 0;
    selection.visible = false;
    anim.glyphCount.fill(0);
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
        if (tile.agent === anim.hover) liftTarget += 0.15;
        if (tile.agent === d.selected) liftTarget += 0.3;
        liftTarget *= spec.liftScale * sig.liftScale;
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

      // Tile body: territory in the ground mesh, agents in the body mesh.
      const thickness = 1 + anim.lift[i] * 2.4;
      tmp.copy(place.position);
      // lift along the normal so the tile grows outward from the sphere
      tmp2.copy(place.position).sub(SPHERE_CENTER).normalize();
      tmp.addScaledVector(tmp2, (TILE_HEIGHT * (thickness - 1)) / 2);
      dummy.position.copy(tmp);
      dummy.quaternion.copy(place.quaternion);
      dummy.scale.set(s * 0.97, s * thickness, s * 0.97);
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
        if (agent.status === 'active' && w > 0.5)
          color.lerp(palette.label, breathe * 0.08);
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

      // The status light: an inlaid glyph on top, and inside the body for
      // the translucent options.
      if (agent) {
        const glyphIndex = marks ? glyphOfAgent[agent.id] : 0;
        const mesh = glyphs[glyphIndex] as THREE.InstancedMesh;
        const slot = anim.glyphCount[glyphIndex];
        anim.glyphCount[glyphIndex] = slot + 1;
        const capScale = s * (0.75 + 0.25 * w) * sig.glyphScale;
        tmp.addScaledVector(tmp2, (TILE_HEIGHT * thickness) / 2 + 0.05);
        dummy.position.copy(tmp);
        dummy.quaternion.copy(place.quaternion);
        if (agent.status === 'active' && !reducedMotion) {
          spin.setFromAxisAngle(
            yAxis,
            anim.pulse * SPIN_RATE * (0.7 + 0.6 * w) + agent.id * 0.7
          );
          dummy.quaternion.multiply(spin);
        }
        dummy.scale.set(capScale, 1, capScale);
        dummy.updateMatrix();
        mesh.setMatrixAt(slot, dummy.matrix);
        // A lit glyph: the status hue carried toward white, never past it,
        // so amber stays amber instead of clipping to cream.
        color.copy(palette.status[agent.status]);
        const lit =
          0.22 +
          0.2 * w +
          (agent.status === 'needs-you' ? breathe * 0.25 * w : 0);
        color.lerp(WHITE, Math.min(0.6, lit * spec.inlayGlow));
        color.multiplyScalar((0.75 + 0.35 * w) * (1 - recede * 0.6));
        // a quiet mark when the signal lives elsewhere on the tile
        if (sig.glyphStatus < 1) {
          color.copy(palette.neutral).lerp(palette.label, 0.22 + 0.1 * w);
        }
        mesh.setColorAt(slot, color);

        // Rim: the status as a lit band around the top edge.
        if (sig.rim) {
          dummy.position.copy(tmp).addScaledVector(tmp2, -0.09);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(s, 1, s);
          dummy.updateMatrix();
          rims.setMatrixAt(rimCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
          color.multiplyScalar(
            (0.45 +
              0.55 * w +
              (agent.status === 'needs-you' ? breathe * 0.35 * w : 0)) *
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
          const gs = s * (0.8 + 0.3 * w + breathe * 0.08 * w);
          dummy.scale.set(gs, 1, gs);
          dummy.updateMatrix();
          glows.setMatrixAt(glowCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
          color.multiplyScalar(
            (0.2 +
              0.5 * w +
              (agent.status === 'needs-you' ? breathe * 0.3 * w : 0)) *
              (1 - recede * 0.7)
          );
          glows.setColorAt(glowCount, color);
          glowCount += 1;
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
          const coreHeight = TILE_HEIGHT * thickness * 0.6;
          tmp
            .copy(place.position)
            .addScaledVector(tmp2, (TILE_HEIGHT * thickness) / 2);
          dummy.position.copy(tmp);
          dummy.quaternion.copy(place.quaternion);
          dummy.scale.set(s * 0.9, s * coreHeight, s * 0.9);
          dummy.updateMatrix();
          cores.setMatrixAt(coreCount, dummy.matrix);
          color.copy(palette.status[agent.status]);
          color.multiplyScalar(
            (0.9 +
              1.1 * w +
              (agent.status === 'needs-you' ? breathe * 0.8 * w : 0)) *
              (1 - recede * 0.6)
          );
          cores.setColorAt(coreCount, color);
          coreCount += 1;
        }
      }

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
    cores.count = coreCount;
    rims.count = rimCount;
    glows.count = glowCount;
    for (let g = 0; g < GLYPH_COUNT; g += 1) {
      const mesh = glyphs[g] as THREE.InstancedMesh;
      mesh.count = anim.glyphCount[g];
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

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

    ground.instanceMatrix.needsUpdate = true;
    agents.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
    ghosts.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    glows.instanceMatrix.needsUpdate = true;
    pipMesh.instanceMatrix.needsUpdate = true;
    if (rims.instanceColor) rims.instanceColor.needsUpdate = true;
    if (glows.instanceColor) glows.instanceColor.needsUpdate = true;
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;
    if (agents.instanceColor) agents.instanceColor.needsUpdate = true;
    if (cores.instanceColor) cores.instanceColor.needsUpdate = true;
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
      <CameraRig
        model={model}
        drive={drive}
        reducedMotion={reducedMotion}
        shownRef={shownRef}
        closeUp={closeUp}
      />
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

      {glyphGeometries.map((glyph, g) => (
        <instancedMesh
          key={g}
          ref={el => {
            glyphRefs.current[g] = el;
          }}
          args={[glyph, undefined, tileCount]}
          raycast={() => null}
          frustumCulled={false}
        >
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      ))}

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
          side={THREE.DoubleSide}
        />
      </mesh>

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
