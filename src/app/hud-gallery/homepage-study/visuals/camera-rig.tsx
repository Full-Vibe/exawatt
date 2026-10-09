'use client';

/**
 * One camera for every visual option (ENG-031 W15).
 *
 * An orbit around the fleet: azimuth drifts on its own and answers a drag
 * with velocity (guide rule 13), polar angle and distance follow the story
 * stage, and distance is fitted to the territory that is actually present
 * so a fleet of one fills the frame as honestly as a fleet of three hundred.
 * Distance mixes in log space (rule 4c). Nothing here allocates per frame.
 *
 * The rig is on rails (W15c, W15d). Scroll progress is the one eased input;
 * the stage blend (`stageBlend`) turns it into a dwell and a move, and
 * polar, azimuth, zoom, drop, reading side, fleet count, extent and centroid
 * are all read off that blend, so the camera travels one path and the
 * visual's states move with it. During growth the count ramps on the same
 * rail, the centroid runs straight from the first Project to the whole
 * fleet, and the fitted extent reads a look-ahead curve that widens before
 * each Project lands rather than stepping when it does.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RefObject } from 'react';
import { fleetAt, FLEET_MAX, type FleetModel } from '../fleet-model';
import { axialToPlane } from '../fleet-model';
import { planeToSphere } from '../sphere';
import {
  GROWTH_WINDOW,
  panelSide,
  stageBlend,
  stageIndex,
  STAGES,
} from '../stages';
import type { StoryDrive } from '../visual-contract';

interface StageFraming {
  /** Camera polar angle from the pole normal, radians. */
  polar: number;
  /** Extra azimuth, so every stage is a new perspective on the same world. */
  azimuth: number;
  /** Multiplier on the fitted distance. */
  zoom: number;
  /** Push the subject down the frame (fraction of its extent) so centred
   *  type above it has clean ground. */
  drop: number;
}

/** Polar and zoom move one way through the dissections and one way out to
 *  the fleet, so the camera never nods back on itself between stages. */
const FRAMING: Record<string, StageFraming> = {
  landing: { polar: 0.78, azimuth: 0, zoom: 0.95, drop: 0.75 },
  working: { polar: 0.66, azimuth: 0.35, zoom: 0.84, drop: 0 },
  'needs-you': { polar: 0.62, azimuth: 0.75, zoom: 0.8, drop: 0 },
  third: { polar: 0.6, azimuth: 1.15, zoom: 0.8, drop: 0 },
  fleet: { polar: 0.95, azimuth: 1.45, zoom: 1.0, drop: 0.35 },
  launch: { polar: 1.1, azimuth: 1.7, zoom: 1.25, drop: 0.1 },
  download: { polar: 1.2, azimuth: 1.9, zoom: 1.45, drop: 0 },
};

/** Planar radius of the present fleet, tile units, with a margin ring. */
export function fleetExtent(model: FleetModel, count: number): number {
  const at = fleetAt(model, count);
  let r = 0;
  for (const tile of model.tiles) {
    if (!at.tilePresent(tile)) continue;
    const [x, y] = axialToPlane(tile.axial);
    r = Math.max(r, Math.hypot(x, y));
  }
  return r + 3.2;
}

interface FitTables {
  /** Fitted extent at every integer count, widened ahead of each Project
   *  and averaged, so a growing fleet pulls the camera back on a curve. */
  extent: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
}

const LOOK_AHEAD = 60;
const AVERAGE_HALF = 30;
const fitTableCache = new WeakMap<FleetModel, FitTables>();

function fitTables(model: FleetModel): FitTables {
  const hit = fitTableCache.get(model);
  if (hit) return hit;
  const n = model.agents.length;
  const raw = new Float32Array(n + 1);
  const ahead = new Float32Array(n + 1);
  const extent = new Float32Array(n + 1);
  const cx = new Float32Array(n + 1);
  const cy = new Float32Array(n + 1);
  let sx = 0;
  let sy = 0;
  for (let count = 0; count <= n; count += 1) {
    raw[count] = fleetExtent(model, Math.max(1, count));
    if (count > 0) {
      const [px, py] = axialToPlane(model.agents[count - 1].tile);
      sx += px;
      sy += py;
      cx[count] = sx / count;
      cy[count] = sy / count;
    }
  }
  for (let count = 0; count <= n; count += 1) {
    let m = 0;
    for (let c = 0; c <= Math.min(n, count + LOOK_AHEAD); c += 1)
      m = Math.max(m, raw[c]);
    ahead[count] = m;
  }
  for (let count = 0; count <= n; count += 1) {
    const lo = Math.max(0, count - AVERAGE_HALF);
    const hi = Math.min(n, count + AVERAGE_HALF);
    let sum = 0;
    for (let c = lo; c <= hi; c += 1) sum += ahead[c];
    extent[count] = sum / (hi - lo + 1);
  }
  const tables = { extent, cx, cy };
  fitTableCache.set(model, tables);
  return tables;
}

function readTable(table: Float32Array, count: number): number {
  const c = THREE.MathUtils.clamp(count, 1, table.length - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(table.length - 1, i0 + 1);
  return THREE.MathUtils.lerp(table[i0], table[i1], c - i0);
}

/** The rail-side fields of the drive, written by the rig. A plain function,
 *  because the drive arrives as a prop and the compiler lint forbids
 *  assigning into one directly. */
function writeRail(d: StoryDrive, rail: number, recede: number) {
  d.rail = rail;
  d.recede = recede;
}

/** How fast the story input settles. */
const STORY_RATE = 2.6;
/** A light second pass on distance and target, so a ghost click or a
 *  fleet-size change arrives as a glide and not a cut. */
const FIT_RATE = 9;

export function CameraRig({
  model,
  drive,
  reducedMotion,
  shownRef,
  closeUp = false,
}: {
  model: FleetModel;
  drive: RefObject<StoryDrive>;
  reducedMotion: boolean;
  /** Shared eased count, so the visual and the camera agree. */
  shownRef: RefObject<number>;
  /** Frame one cluster close and let the reader orbit all the way round. */
  closeUp?: boolean;
}) {
  const { camera, gl, size } = useThree();
  const state = useRef({
    progress: 0,
    azimuth: 0.4,
    azimuthVelocity: 0,
    polar: 0.78,
    distance: 40,
    target: new THREE.Vector3(),
    dragging: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
    polarVelocity: 0,
    userAzimuth: 0,
    userPolar: 0,
  });
  const scratch = useMemo(
    () => ({
      targetWorld: new THREE.Vector3(),
      position: new THREE.Vector3(),
      right: new THREE.Vector3(),
      camUp: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      blend: { from: 0, to: 0, t: 0 },
      growth: { from: 0, to: 0, t: 0 },
    }),
    []
  );
  const tables = useMemo(() => fitTables(model), [model]);
  const launchIndex = useMemo(() => stageIndex('launch'), []);

  // Drag to orbit: velocity in, decay out. Zoom and pan stay with the page.
  useEffect(() => {
    const el = gl.domElement;
    const s = state.current;
    const down = (e: PointerEvent) => {
      s.dragging = true;
      s.moved = 0;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!s.dragging) return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.azimuthVelocity = dx * 0.004;
      s.polarVelocity = dy * 0.003;
      s.userAzimuth += dx * 0.004;
      s.userPolar = THREE.MathUtils.clamp(
        s.userPolar + dy * 0.003,
        closeUp ? -0.6 : -0.35,
        closeUp ? 0.9 : 0.35
      );
    };
    const up = (e: PointerEvent) => {
      s.dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // already released
      }
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.style.setProperty('touch-action', 'pan-y');
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, closeUp]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const s = state.current;
    const d = drive.current;

    // The one eased input.
    s.progress = reducedMotion
      ? d.progress
      : THREE.MathUtils.damp(s.progress, d.progress, STORY_RATE, delta);
    const b = stageBlend(s.progress, undefined, scratch.blend);
    const g = stageBlend(s.progress, GROWTH_WINDOW, scratch.growth);
    const f0 = FRAMING[STAGES[b.from].id];
    const f1 = FRAMING[STAGES[b.to].id];
    const polar = THREE.MathUtils.lerp(f0.polar, f1.polar, b.t);
    const stageAzimuth = THREE.MathUtils.lerp(f0.azimuth, f1.azimuth, b.t);
    const zoom = Math.exp(
      THREE.MathUtils.lerp(Math.log(f0.zoom), Math.log(f1.zoom), b.t)
    );
    // A close-up frames the cluster dead centre; the stage's side and drop
    // exist to clear the reading column, which a close-up has none of.
    const drop = closeUp ? 0 : THREE.MathUtils.lerp(f0.drop, f1.drop, b.t);
    const side = closeUp
      ? 0
      : THREE.MathUtils.lerp(
          panelSide(STAGES[b.from]),
          panelSide(STAGES[b.to]),
          b.t
        );
    writeRail(
      d,
      s.progress,
      THREE.MathUtils.lerp(
        b.from >= launchIndex ? 1 : 0,
        b.to >= launchIndex ? 1 : 0,
        b.t
      )
    );

    // Count on the growth rail; the visual shows it.
    const countFrom = STAGES[g.from].growToFleet ? FLEET_MAX : d.base;
    const countTo = STAGES[g.to].growToFleet ? FLEET_MAX : d.base;
    const shown = THREE.MathUtils.lerp(countFrom, countTo, g.t);
    shownRef.current = shown;

    // Fit the present territory.
    const extent = readTable(tables.extent, shown);
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = size.width / Math.max(1, size.height);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    const fitted =
      (extent / Math.tan(fov / 2)) * 1.05 * zoom * (closeUp ? 0.6 : 1);
    const distanceTarget = Math.max(closeUp ? 5 : 12, fitted);

    // Azimuth: stage perspective + slow drift + the user's own turn.
    if (!s.dragging) {
      s.azimuthVelocity = THREE.MathUtils.damp(s.azimuthVelocity, 0, 4, delta);
      s.polarVelocity = THREE.MathUtils.damp(s.polarVelocity, 0, 4, delta);
      s.userAzimuth += s.azimuthVelocity;
      s.userPolar = THREE.MathUtils.clamp(
        s.userPolar + s.polarVelocity,
        -0.35,
        0.35
      );
    }
    const drift = reducedMotion ? 0 : delta * 0.045;
    s.azimuth += drift;
    const azimuthTarget = s.azimuth + stageAzimuth + s.userAzimuth;
    s.polar = THREE.MathUtils.clamp(polar + s.userPolar, 0.2, 1.35);

    if (reducedMotion) s.distance = distanceTarget;
    else
      s.distance = Math.exp(
        THREE.MathUtils.damp(
          Math.log(s.distance),
          Math.log(distanceTarget),
          FIT_RATE,
          delta
        )
      );

    // Target: straight between the centroids at either end of the move,
    // nudged away from the reading column so the subject is never under
    // the type.
    const cx = THREE.MathUtils.lerp(
      readTable(tables.cx, countFrom),
      readTable(tables.cx, countTo),
      g.t
    );
    const cy = THREE.MathUtils.lerp(
      readTable(tables.cy, countFrom),
      readTable(tables.cy, countTo),
      g.t
    );
    planeToSphere(cx, cy, scratch.targetWorld);
    scratch.right.set(Math.cos(azimuthTarget), 0, -Math.sin(azimuthTarget));
    scratch.targetWorld.addScaledVector(scratch.right, side * extent * 0.28);
    // Camera-up in world space for the current polar/azimuth, so a drop
    // moves the subject straight down the frame.
    scratch.camUp.set(
      -Math.sin(azimuthTarget) * Math.cos(s.polar),
      Math.sin(s.polar),
      -Math.cos(azimuthTarget) * Math.cos(s.polar)
    );
    scratch.targetWorld.addScaledVector(scratch.camUp, drop * extent);
    if (reducedMotion) s.target.copy(scratch.targetWorld);
    else {
      s.target.x = THREE.MathUtils.damp(
        s.target.x,
        scratch.targetWorld.x,
        FIT_RATE,
        delta
      );
      s.target.y = THREE.MathUtils.damp(
        s.target.y,
        scratch.targetWorld.y,
        FIT_RATE,
        delta
      );
      s.target.z = THREE.MathUtils.damp(
        s.target.z,
        scratch.targetWorld.z,
        FIT_RATE,
        delta
      );
    }

    // Spherical about the target, polar measured from the pole normal (+Y).
    const sp = Math.sin(s.polar) * s.distance;
    scratch.position.set(
      s.target.x + Math.sin(azimuthTarget) * sp,
      s.target.y + Math.cos(s.polar) * s.distance,
      s.target.z + Math.cos(azimuthTarget) * sp
    );
    camera.position.copy(scratch.position);
    camera.up.copy(scratch.up);
    camera.lookAt(s.target);
  });

  return null;
}
