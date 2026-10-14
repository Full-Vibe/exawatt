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
 * visual's states move with it. The fleet changes size with the story
 * (`Stage.count`): the fit at either end of a move is read for that stage's
 * own count and focus, and extent and centroid blend between the two on the
 * rail, so the camera never chases the agents as they arrive; they arrive
 * into a frame that is already on its way to fitting them.
 *
 * The rig lives in the canvas, above the visual, so switching the visual or
 * the material swaps what is drawn and never restarts the camera.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { RefObject } from 'react';
import { fleetAt, type FleetModel } from '../fleet-model';
import { axialToPlane } from '../fleet-model';
import { planeToSphere } from '../sphere';
import { isNarrow } from '../narrow';
import { leanBlend, leanCurve, panelSide, stageBlend, STAGES } from '../stages';
import { scrollIntent } from '../story-scroll';
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

/** Polar moves one way through the dissections and one way out to the
 *  fleet, and the distance between two scenes (the fit times the zoom, on
 *  one blend) is one glide, so the camera never nods back on itself between
 *  stages. The landing frames its ten agents close enough to read as the
 *  product's agents, under the type (operator 2026-10-14: "on desktop as
 *  well, the agent scene should be a little bit bigger"). */
const FRAMING: Record<string, StageFraming> = {
  landing: { polar: 0.78, azimuth: 0, zoom: 0.8, drop: 0.3 },
  working: { polar: 0.66, azimuth: 0.35, zoom: 0.84, drop: 0 },
  'needs-you': { polar: 0.62, azimuth: 0.75, zoom: 0.8, drop: 0 },
  third: { polar: 0.6, azimuth: 1.15, zoom: 0.8, drop: 0 },
  fleet: { polar: 0.95, azimuth: 1.45, zoom: 0.9, drop: 0.24 },
};

/** On a narrow screen the reading column is under the world or over it,
 *  never beside it: a stage that reads beside the subject lifts it instead.
 *  The landing comes in close under the type, so its ten agents read as
 *  agents, their marks and colours, and not as dots (operator 2026-10-14:
 *  "really tiny dots and you can't really tell what's going on... it
 *  should be... bigger on my phone"); the close comes in on the globe's cap
 *  under the download, so its Projects fill the foot of the screen instead
 *  of a small ball over its own dark underside. */
const NARROW: Record<string, { zoom: number; drop: number }> = {
  landing: { zoom: 0.62, drop: 0.32 },
  working: { zoom: 1.0, drop: -0.22 },
  'needs-you': { zoom: 1.0, drop: -0.22 },
  third: { zoom: 1.0, drop: -0.22 },
  fleet: { zoom: 0.62, drop: 0.32 },
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
  /** Fitted extent and centroid at every integer count, for the whole
   *  fleet and for the first Project alone, so a stage can fit either and
   *  the rail can blend between them. */
  fleetExtent: Float32Array;
  fleetCx: Float32Array;
  fleetCy: Float32Array;
  projectExtent: Float32Array;
  projectCx: Float32Array;
  projectCy: Float32Array;
}

const fitTableCache = new WeakMap<FleetModel, FitTables>();

function fitTables(model: FleetModel): FitTables {
  const hit = fitTableCache.get(model);
  if (hit) return hit;
  const n = model.agents.length;
  const t: FitTables = {
    fleetExtent: new Float32Array(n + 1),
    fleetCx: new Float32Array(n + 1),
    fleetCy: new Float32Array(n + 1),
    projectExtent: new Float32Array(n + 1),
    projectCx: new Float32Array(n + 1),
    projectCy: new Float32Array(n + 1),
  };
  const first = model.projects[0];
  const [pcx, pcy] = axialToPlane(first.center);
  let sx = 0;
  let sy = 0;
  let px = 0;
  let py = 0;
  let pn = 0;
  for (let count = 0; count <= n; count += 1) {
    t.fleetExtent[count] = fleetExtent(model, Math.max(1, count));
    const at = fleetAt(model, Math.max(1, count));
    let r = 0;
    for (const tile of model.tiles) {
      if (tile.project !== first.id || !at.tilePresent(tile)) continue;
      const [x, y] = axialToPlane(tile.axial);
      r = Math.max(r, Math.hypot(x - pcx, y - pcy));
    }
    t.projectExtent[count] = r + 2.6;
    if (count > 0) {
      const agent = model.agents[count - 1];
      const [x, y] = axialToPlane(agent.tile);
      sx += x;
      sy += y;
      t.fleetCx[count] = sx / count;
      t.fleetCy[count] = sy / count;
      if (agent.project === first.id) {
        px += x;
        py += y;
        pn += 1;
      }
      t.projectCx[count] = pn ? px / pn : pcx;
      t.projectCy[count] = pn ? py / pn : pcy;
    } else {
      t.projectCx[count] = pcx;
      t.projectCy[count] = pcy;
    }
  }
  fitTableCache.set(model, t);
  return t;
}

function readTable(table: Float32Array, count: number): number {
  const c = THREE.MathUtils.clamp(count, 1, table.length - 1);
  const i0 = Math.floor(c);
  const i1 = Math.min(table.length - 1, i0 + 1);
  return THREE.MathUtils.lerp(table[i0], table[i1], c - i0);
}

/** The rail-side field of the drive, written by the rig. A plain function,
 *  because the drive arrives as a prop and the compiler lint forbids
 *  assigning into one directly. */
function writeRail(d: StoryDrive, rail: number) {
  d.rail = rail;
}

/** How far a drag may turn the world, radians, by mode (story, close-up).
 *  The story keeps the reader near the authored frame (operator 2026-10-12:
 *  "constrain the drag camera angle a bit more"); the close-up is the
 *  reader's to turn. */
const USER_AZIMUTH = [0.55, Math.PI * 4];
const USER_POLAR: [number, number][] = [
  [-0.16, 0.2],
  [-0.6, 0.9],
];

/**
 * Fog is a depth cue for the far limb of the globe, so it must start beyond
 * the subject, wherever the camera has put it. Fixed distances swallowed the
 * whole globe on a phone, where the fleet fits by moving the camera back past
 * them (operator-visible as a blank fleet scene, 2026-10-13). The ramp keeps
 * its length and never starts nearer than it used to.
 */
const FOG_NEAR_MIN = 60;
const FOG_RAMP = 100;
const FOG_CLEAR = 10;

/** A plain function, because the fog arrives from a hook and the compiler
 *  lint forbids assigning into it directly. */
function setFog(fog: THREE.Fog, distance: number) {
  fog.near = Math.max(FOG_NEAR_MIN, distance + FOG_CLEAR);
  fog.far = fog.near + FOG_RAMP;
}

/** The world's own slow turn, radians per second: a full turn in about five
 *  minutes (operator 2026-10-13: "Slower rotation orbit"; it was 0.045). */
const DRIFT_RATE = 0.021;
/** A push on the wheel before the page moves leans the camera toward the
 *  scene it asks for, up to this share of the move (in the move's eased
 *  terms), and the lean springs back at this rate if the push is let go
 *  (operator 2026-10-13: "when I'm beginning my scroll gesture but before
 *  it begins the scene transition, there's no visible feedback"). */
const LEAN_MAX = 0.12;
/** How far a finger travels before its drag is taken as a turn or left to
 *  the page. */
const TOUCH_DECIDE_PX = 8;
const LEAN_RATE = 14;
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
  const { camera, gl, size, scene } = useThree();
  const state = useRef({
    progress: 0,
    azimuth: 0.4,
    azimuthVelocity: 0,
    /** The camera's lean toward the scene a push asks for, signed. */
    lean: 0,
    polar: 0.78,
    distance: 40,
    target: new THREE.Vector3(),
    dragging: false,
    moved: 0,
    lastX: 0,
    lastY: 0,
    /** Where a drag began, and which way it was taken: a finger's drag turns
     *  the world only once it has gone sideways; up and down is the page's
     *  (W15l: "a weird mix of panning and scrolling"). */
    startX: 0,
    startY: 0,
    lock: 'none' as 'none' | 'turn' | 'page',
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
      leaned: { from: 0, to: 0, t: 0 },
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
      s.moved = 0;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.startX = e.clientX;
      s.startY = e.clientY;
      // a mouse turns the world at once; a finger or a pen waits to see
      s.lock = e.pointerType === 'mouse' ? 'turn' : 'none';
      el.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!s.dragging) return;
      if (s.lock === 'none') {
        const tx = e.clientX - s.startX;
        const ty = e.clientY - s.startY;
        if (Math.hypot(tx, ty) < TOUCH_DECIDE_PX) return;
        s.lock = Math.abs(tx) > Math.abs(ty) ? 'turn' : 'page';
        s.lastX = e.clientX;
        s.lastY = e.clientY;
        return;
      }
      if (s.lock === 'page') return;
      const dx = e.clientX - s.lastX;
      const dy = e.clientY - s.lastY;
      s.lastX = e.clientX;
      s.lastY = e.clientY;
      s.moved += Math.abs(dx) + Math.abs(dy);
      s.azimuthVelocity = dx * 0.004;
      s.polarVelocity = dy * 0.003;
      s.userAzimuth = THREE.MathUtils.clamp(
        s.userAzimuth + dx * 0.004,
        -USER_AZIMUTH[closeUp ? 1 : 0],
        USER_AZIMUTH[closeUp ? 1 : 0]
      );
      s.userPolar = THREE.MathUtils.clamp(
        s.userPolar + dy * 0.003,
        USER_POLAR[closeUp ? 1 : 0][0],
        USER_POLAR[closeUp ? 1 : 0][1]
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
      : THREE.MathUtils.damp(s.progress, d.progress, d.rate, delta);
    const b = stageBlend(s.progress, undefined, scratch.blend);
    // The lean: eased toward what the push asks for; held once the move it
    // asked for starts, until the move has carried the camera past it, so
    // the move goes on from the lean and never dips back first.
    // A push on the wheel before the page moves, and a scroll (a finger on
    // glass, a wheel in the other modes) into the hold around a frame: both
    // lean the camera toward where they are going (W15i, W15l).
    const intent =
      reducedMotion || closeUp
        ? 0
        : THREE.MathUtils.clamp(
            (d.intent ? d.intent(performance.now()) : 0) +
              scrollIntent(d.progress, d.restFrame, STAGES.length - 1),
            -1,
            1
          );
    const holding = d.moving !== 0 && Math.sign(s.lean) === d.moving;
    if (!holding)
      s.lean = THREE.MathUtils.damp(
        s.lean,
        Math.sign(intent) * LEAN_MAX * leanCurve(intent),
        LEAN_RATE,
        delta
      );
    const lb = leanBlend(b, s.lean, scratch.leaned);
    if (holding && lb.from === b.from && lb.t === b.t) s.lean = 0;
    // The framing follows the leaned blend; what is present follows the
    // story itself.
    const f0 = FRAMING[STAGES[lb.from].id];
    const f1 = FRAMING[STAGES[lb.to].id];
    const polar = THREE.MathUtils.lerp(f0.polar, f1.polar, lb.t);
    const stageAzimuth = THREE.MathUtils.lerp(f0.azimuth, f1.azimuth, lb.t);
    const zoom = Math.exp(
      THREE.MathUtils.lerp(Math.log(f0.zoom), Math.log(f1.zoom), lb.t)
    );
    // A close-up frames the cluster dead centre; the stage's side and drop
    // exist to clear the reading column, which a close-up has none of. On a
    // narrow screen the column sits under the world instead of beside it,
    // so the subject moves up the frame, never sideways.
    const narrow = isNarrow(size.width, size.height);
    const n0 = NARROW[STAGES[lb.from].id];
    const n1 = NARROW[STAGES[lb.to].id];
    const drop = closeUp
      ? 0
      : THREE.MathUtils.lerp(
          narrow ? n0.drop : f0.drop,
          narrow ? n1.drop : f1.drop,
          lb.t
        );
    const narrowZoom = narrow
      ? Math.exp(
          THREE.MathUtils.lerp(Math.log(n0.zoom), Math.log(n1.zoom), lb.t)
        )
      : 1;
    const side =
      closeUp || narrow
        ? 0
        : THREE.MathUtils.lerp(
            panelSide(STAGES[lb.from]),
            panelSide(STAGES[lb.to]),
            lb.t
          );
    writeRail(d, s.progress);

    // The fleet is the stage's own size at either end of the move; what is
    // present eases between them with the rail, so agents arrive in a wave
    // as the camera travels. A close-up shows the study's own count.
    const countFrom = closeUp ? d.base : STAGES[b.from].count;
    const countTo = closeUp ? d.base : STAGES[b.to].count;
    const shown = THREE.MathUtils.lerp(countFrom, countTo, b.t);
    shownRef.current = shown;

    // Fit what each end of the move looks at, at its own count, on the
    // same leaned blend as the framing. The distance is the fit times the
    // zoom, so a lean that moved one without the other would swing the
    // camera past a scene and back: on a phone the landing frames its ten
    // agents closer than their fit while the one agent's fit shrinks, and
    // the lean into the one-agent scene came in 6% past it and backed out.
    // What is present still follows the story itself.
    const fitFrom = closeUp ? d.base : STAGES[lb.from].count;
    const fitTo = closeUp ? d.base : STAGES[lb.to].count;
    const fromFleet = STAGES[lb.from].focus === 'fleet';
    const toFleet = STAGES[lb.to].focus === 'fleet';
    const extentFrom = readTable(
      fromFleet ? tables.fleetExtent : tables.projectExtent,
      fitFrom
    );
    const extentTo = readTable(
      toFleet ? tables.fleetExtent : tables.projectExtent,
      fitTo
    );
    const extent = Math.exp(
      THREE.MathUtils.lerp(Math.log(extentFrom), Math.log(extentTo), lb.t)
    );
    const cam = camera as THREE.PerspectiveCamera;
    const vfov = THREE.MathUtils.degToRad(cam.fov);
    const aspect = size.width / Math.max(1, size.height);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const fov = Math.min(vfov, hfov);
    const fitted =
      (extent / Math.tan(fov / 2)) *
      1.05 *
      zoom *
      narrowZoom *
      (closeUp ? 0.6 : 1);
    const distanceTarget = Math.max(closeUp ? 5 : 12, fitted);

    // Azimuth: stage perspective + slow drift + the user's own turn. A turn
    // keeps its flick, then relaxes back to the authored frame, so the
    // reader can play without leaving the story broken.
    if (!s.dragging) {
      s.azimuthVelocity = THREE.MathUtils.damp(s.azimuthVelocity, 0, 4, delta);
      s.polarVelocity = THREE.MathUtils.damp(s.polarVelocity, 0, 4, delta);
      s.userAzimuth = THREE.MathUtils.clamp(
        s.userAzimuth + s.azimuthVelocity,
        -USER_AZIMUTH[closeUp ? 1 : 0],
        USER_AZIMUTH[closeUp ? 1 : 0]
      );
      s.userPolar = THREE.MathUtils.clamp(
        s.userPolar + s.polarVelocity,
        USER_POLAR[closeUp ? 1 : 0][0],
        USER_POLAR[closeUp ? 1 : 0][1]
      );
      if (!closeUp) {
        s.userAzimuth = THREE.MathUtils.damp(s.userAzimuth, 0, 0.6, delta);
        s.userPolar = THREE.MathUtils.damp(s.userPolar, 0, 0.6, delta);
      }
    }
    const drift = reducedMotion ? 0 : delta * DRIFT_RATE;
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
    if (scene.fog instanceof THREE.Fog) setFog(scene.fog, s.distance);

    // Target: straight between the centroids at either end of the move,
    // nudged away from the reading column so the subject is never under
    // the type.
    const cx = THREE.MathUtils.lerp(
      readTable(fromFleet ? tables.fleetCx : tables.projectCx, fitFrom),
      readTable(toFleet ? tables.fleetCx : tables.projectCx, fitTo),
      lb.t
    );
    const cy = THREE.MathUtils.lerp(
      readTable(fromFleet ? tables.fleetCy : tables.projectCy, fitFrom),
      readTable(toFleet ? tables.fleetCy : tables.projectCy, fitTo),
      lb.t
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
