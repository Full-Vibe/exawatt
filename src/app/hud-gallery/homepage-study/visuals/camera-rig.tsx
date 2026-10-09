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
 * One smoothed story progress drives every framing value (W15c, operator
 * 2026-10-09: "too jittery or wiggly or wobbly ... unstable when it's
 * transitioning between the different camera angles"). The wobble was four
 * parameters moving at four speeds: azimuth followed raw scroll, polar and
 * distance lagged at two different rates, and the fitted extent and the
 * centroid stepped on integer counts. Now scroll progress, the reading side
 * and the count are the only eased inputs, and polar, azimuth, zoom, drop,
 * extent and centroid are smooth functions of them, so the camera travels
 * one path.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RefObject } from 'react';
import { fleetAt, type FleetModel } from '../fleet-model';
import { axialToPlane } from '../fleet-model';
import { planeToSphere } from '../sphere';
import { STAGES } from '../stages';
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

/** Mostly linear with a soft settle at each stage, so a steady scroll moves
 *  the camera at a steady pace rather than stop-go at every boundary. */
function smooth(t: number) {
  return 0.45 * t + 0.55 * (t * t * (3 - 2 * t));
}

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
  /** Extent and centroid at every integer count, so a fractional count
   *  reads a continuous value and a growing fleet never steps the camera. */
  extent: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
}

const fitTableCache = new WeakMap<FleetModel, FitTables>();

function fitTables(model: FleetModel): FitTables {
  const hit = fitTableCache.get(model);
  if (hit) return hit;
  const n = model.agents.length;
  const extent = new Float32Array(n + 1);
  const cx = new Float32Array(n + 1);
  const cy = new Float32Array(n + 1);
  let sx = 0;
  let sy = 0;
  for (let count = 0; count <= n; count += 1) {
    extent[count] = fleetExtent(model, Math.max(1, count));
    if (count > 0) {
      const [px, py] = axialToPlane(model.agents[count - 1].tile);
      sx += px;
      sy += py;
      cx[count] = sx / count;
      cy[count] = sy / count;
    }
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

/** Stage framing at a fractional, already-smoothed progress. */
function framingAt(
  progress: number,
  out: { polar: number; azimuth: number; zoom: number; drop: number }
) {
  const i0 = Math.max(0, Math.min(STAGES.length - 1, Math.floor(progress)));
  const i1 = Math.min(STAGES.length - 1, i0 + 1);
  const t = smooth(THREE.MathUtils.clamp(progress - i0, 0, 1));
  const f0 = FRAMING[STAGES[i0].id];
  const f1 = FRAMING[STAGES[i1].id];
  out.polar = THREE.MathUtils.lerp(f0.polar, f1.polar, t);
  out.azimuth = THREE.MathUtils.lerp(f0.azimuth, f1.azimuth, t);
  out.zoom = Math.exp(
    THREE.MathUtils.lerp(Math.log(f0.zoom), Math.log(f1.zoom), t)
  );
  out.drop = THREE.MathUtils.lerp(f0.drop, f1.drop, t);
}

/** How fast the story inputs settle. One rate for all of them, so nothing
 *  leads or lags anything else. */
const STORY_RATE = 2.6;
/** A light second pass that rounds the kinks a new agent puts in the
 *  fitted extent. Fast enough never to lag the story visibly. */
const FIT_RATE = 9;

export function CameraRig({
  model,
  drive,
  reducedMotion,
  shownRef,
}: {
  model: FleetModel;
  drive: RefObject<StoryDrive>;
  reducedMotion: boolean;
  /** Shared eased count, so the visual and the camera agree. */
  shownRef: RefObject<number>;
}) {
  const { camera, gl, size } = useThree();
  const state = useRef({
    progress: 0,
    side: 0,
    azimuth: 0.4,
    azimuthVelocity: 0,
    polar: 0.78,
    distance: 40,
    target: new THREE.Vector3(),
    dragging: false,
    lastX: 0,
    lastY: 0,
    polarVelocity: 0,
    userAzimuth: 0,
    userPolar: 0,
  });
  const scratch = useMemo(
    () => ({
      centroid: new THREE.Vector2(),
      targetWorld: new THREE.Vector3(),
      position: new THREE.Vector3(),
      right: new THREE.Vector3(),
      camUp: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      framing: { polar: 0.78, azimuth: 0, zoom: 1, drop: 0 },
    }),
    []
  );
  const tables = useMemo(() => fitTables(model), [model]);

  // Drag to orbit: velocity in, decay out. Zoom and pan stay with the page.
  useEffect(() => {
    const el = gl.domElement;
    const s = state.current;
    const down = (e: PointerEvent) => {
      s.dragging = true;
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
      s.azimuthVelocity = dx * 0.004;
      s.polarVelocity = dy * 0.003;
      s.userAzimuth += dx * 0.004;
      s.userPolar = THREE.MathUtils.clamp(
        s.userPolar + dy * 0.003,
        -0.35,
        0.35
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
  }, [gl]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const s = state.current;
    const d = drive.current;

    // The story inputs, eased at one rate.
    if (reducedMotion) {
      s.progress = d.progress;
      s.side = d.side;
    } else {
      s.progress = THREE.MathUtils.damp(
        s.progress,
        d.progress,
        STORY_RATE,
        delta
      );
      s.side = THREE.MathUtils.damp(s.side, d.side, STORY_RATE, delta);
    }
    const shown = reducedMotion
      ? d.count
      : THREE.MathUtils.damp(shownRef.current, d.count, 2.2, delta);
    shownRef.current = shown;

    const f = scratch.framing;
    framingAt(s.progress, f);

    // Fit the present territory; extent is continuous in the eased count.
    const extent = readTable(tables.extent, shown);
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = size.width / Math.max(1, size.height);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    const fitted = (extent / Math.tan(fov / 2)) * 1.05 * f.zoom;
    const distanceTarget = Math.max(12, fitted);

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
    const azimuthTarget = s.azimuth + f.azimuth + s.userAzimuth;
    s.polar = THREE.MathUtils.clamp(f.polar + s.userPolar, 0.2, 1.35);
    const drop = f.drop;

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

    // Target: the present centroid on the sphere, nudged away from the
    // reading column so the subject is never under the type.
    scratch.centroid.set(
      readTable(tables.cx, shown),
      readTable(tables.cy, shown)
    );
    planeToSphere(scratch.centroid.x, scratch.centroid.y, scratch.targetWorld);
    scratch.right.set(Math.cos(azimuthTarget), 0, -Math.sin(azimuthTarget));
    const sideShift = s.side * extent * 0.28;
    scratch.targetWorld.addScaledVector(scratch.right, sideShift);
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
