'use client';

/**
 * One camera for every visual option (ENG-031 W15).
 *
 * An orbit around the fleet: azimuth drifts on its own and answers a drag
 * with velocity (guide rule 13), polar angle and distance follow the story
 * stage, and distance is fitted to the territory that is actually present
 * so a fleet of one fills the frame as honestly as a fleet of three hundred.
 * Distance mixes in log space (rule 4c). Nothing here allocates per frame.
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

const FRAMING: Record<string, StageFraming> = {
  landing: { polar: 0.78, azimuth: 0, zoom: 0.95, drop: 0.75 },
  working: { polar: 0.62, azimuth: 0.35, zoom: 0.82, drop: 0 },
  'needs-you': { polar: 0.7, azimuth: 0.75, zoom: 0.8, drop: 0 },
  third: { polar: 0.58, azimuth: 1.15, zoom: 0.84, drop: 0 },
  fleet: { polar: 0.95, azimuth: 1.45, zoom: 1.0, drop: 0.35 },
  launch: { polar: 1.1, azimuth: 1.7, zoom: 1.25, drop: 0.1 },
  download: { polar: 1.2, azimuth: 1.9, zoom: 1.45, drop: 0 },
};

function smooth(t: number) {
  return t * t * (3 - 2 * t);
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

/** Planar centroid of the present agents. */
export function fleetCentroid(
  model: FleetModel,
  count: number,
  out: THREE.Vector2
): THREE.Vector2 {
  const n = Math.max(1, Math.min(model.agents.length, Math.round(count)));
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i += 1) {
    const [px, py] = axialToPlane(model.agents[i].tile);
    x += px;
    y += py;
  }
  return out.set(x / n, y / n);
}

export interface CameraRigState {
  /** The count the camera is currently framing (eased). */
  shown: number;
}

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
    }),
    []
  );

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

    // Story stage, interpolated.
    const i0 = Math.max(0, Math.min(STAGES.length - 1, Math.floor(d.progress)));
    const i1 = Math.min(STAGES.length - 1, i0 + 1);
    const t = smooth(THREE.MathUtils.clamp(d.progress - i0, 0, 1));
    const f0 = FRAMING[STAGES[i0].id];
    const f1 = FRAMING[STAGES[i1].id];
    const polar = THREE.MathUtils.lerp(f0.polar, f1.polar, t);
    const stageAzimuth = THREE.MathUtils.lerp(f0.azimuth, f1.azimuth, t);
    const zoom = Math.exp(
      THREE.MathUtils.lerp(Math.log(f0.zoom), Math.log(f1.zoom), t)
    );
    const drop = THREE.MathUtils.lerp(f0.drop, f1.drop, t);

    // Eased count, shared with the visual.
    const shown = reducedMotion
      ? d.count
      : THREE.MathUtils.damp(shownRef.current, d.count, 2.2, delta);
    shownRef.current = shown;

    // Fit the present territory.
    const extent = fleetExtent(model, Math.round(shown));
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = size.width / Math.max(1, size.height);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    const fitted = (extent / Math.tan(fov / 2)) * 1.05 * zoom;
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
    const azimuthTarget = s.azimuth + stageAzimuth + s.userAzimuth;
    const polarTarget = THREE.MathUtils.clamp(polar + s.userPolar, 0.2, 1.35);

    if (reducedMotion) {
      s.polar = polarTarget;
      s.distance = distanceTarget;
    } else {
      s.polar = THREE.MathUtils.damp(s.polar, polarTarget, 3.5, delta);
      s.distance = Math.exp(
        THREE.MathUtils.damp(
          Math.log(s.distance),
          Math.log(distanceTarget),
          3,
          delta
        )
      );
    }

    // Target: the present centroid on the sphere, nudged away from the
    // reading column so the subject is never under the type.
    fleetCentroid(model, shown, scratch.centroid);
    planeToSphere(scratch.centroid.x, scratch.centroid.y, scratch.targetWorld);
    scratch.right.set(Math.cos(azimuthTarget), 0, -Math.sin(azimuthTarget));
    const sideShift = d.side * extent * 0.28;
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
        3,
        delta
      );
      s.target.y = THREE.MathUtils.damp(
        s.target.y,
        scratch.targetWorld.y,
        3,
        delta
      );
      s.target.z = THREE.MathUtils.damp(
        s.target.z,
        scratch.targetWorld.z,
        3,
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
