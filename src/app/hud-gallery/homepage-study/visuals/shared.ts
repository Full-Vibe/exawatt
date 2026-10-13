/**
 * Per-tile world placement and palette, shared by the visual options
 * (ENG-031 W15). Computed once per model and never per frame.
 */

import * as THREE from 'three';
import type { StatusLightState } from '@/components/status-light/protocol';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import { axialToPlane, type fleetAt, type FleetModel } from '../fleet-model';
import type { LabelAnchor } from '../visual-contract';
import {
  SPHERE_CENTER,
  SPHERE_RADIUS,
  planeToSphere,
  tileQuaternion,
} from '../sphere';

export interface TilePlacement {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Planar coordinates, for anything that wants the flat layout. */
  x: number;
  y: number;
}

export function placeTiles(model: FleetModel): TilePlacement[] {
  return model.tiles.map(tile => {
    const [x, y] = axialToPlane(tile.axial);
    const position = planeToSphere(x, y, new THREE.Vector3());
    const quaternion = tileQuaternion(x, y, new THREE.Quaternion());
    return { position, quaternion, x, y };
  });
}

export interface Palette {
  status: Record<StatusLightState, THREE.Color>;
  ground: THREE.Color;
  groundEdge: THREE.Color;
  ghost: THREE.Color;
  body: THREE.Color;
  grid: THREE.Color;
  label: THREE.Color;
  dim: THREE.Color;
  /** The product's selection colour. */
  selection: THREE.Color;
  /** A quiet body for the signal treatments that keep status off the body. */
  neutral: THREE.Color;
}

export function paletteFrom(theme: SpatialThemeSnapshot): Palette {
  const canvas = new THREE.Color(theme.canvas);
  const status = {
    active: new THREE.Color(theme.status.active),
    'needs-you': new THREE.Color(theme.status['needs-you']),
    result: new THREE.Color(theme.status.result),
    off: new THREE.Color(theme.status.off),
    fault: new THREE.Color(theme.status.fault),
  } as Record<StatusLightState, THREE.Color>;
  return {
    status,
    ground: new THREE.Color(theme.zone).lerp(canvas, 0.55),
    groundEdge: new THREE.Color(theme.grid),
    ghost: new THREE.Color(theme.gridMajor),
    body: canvas.clone().lerp(new THREE.Color(theme.zone), 0.18),
    grid: new THREE.Color(theme.grid),
    label: new THREE.Color(theme.label),
    dim: canvas.clone().lerp(new THREE.Color(theme.unitMuted), 0.35),
    selection: new THREE.Color(theme.selection),
    neutral: new THREE.Color(theme.zone).lerp(
      new THREE.Color(theme.unitMuted),
      0.3
    ),
  };
}

/** Status mix for a stage highlight: 1 = lifted, 0 = set back. */
export function highlightWeight(
  status: StatusLightState,
  highlight: StatusLightState | null
): number {
  if (highlight === null) return 1;
  return status === highlight ? 1 : 0;
}

/** Project a world point to canvas pixels; returns false when behind. */
const ndc = new THREE.Vector3();
export function projectToCanvas(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
  out: { x: number; y: number }
): boolean {
  ndc.copy(point).project(camera);
  if (ndc.z > 1 || ndc.z < -1) return false;
  out.x = (ndc.x * 0.5 + 0.5) * width;
  out.y = (-ndc.y * 0.5 + 0.5) * height;
  return true;
}

const centerTileCache = new WeakMap<FleetModel, number[]>();

/** Each Project's centre tile (ring 0), by Project id, found once. */
function centerTiles(model: FleetModel): number[] {
  let centers = centerTileCache.get(model);
  if (!centers) {
    centers = model.projects.map(project =>
      model.tiles.findIndex(t => t.project === project.id && t.ring === 0)
    );
    centerTileCache.set(model, centers);
  }
  return centers;
}

/** Planar distance between neighbouring rings of a Project, in tile units. */
const RING_PITCH = Math.sqrt(3);
/** Past the outermost ring, so a name stands clear of its own tiles. */
const LABEL_MARGIN = 0.9;

/**
 * Write one label anchor per Project, projected to canvas pixels. The name
 * stands beyond the cluster's far rim as the camera sees it, not over its
 * middle: from the Project's centre it is carried along the surface in the
 * direction that is up on screen, out past the outermost ring, then raised
 * `lift` clear of the tiles. (From the middle, a name over a big cluster sat
 * on its own tiles and could not be read.) Present Projects only.
 */
const labelPoint = { x: 0, y: 0 };
const labelWorld = new THREE.Vector3();
const labelNormal = new THREE.Vector3();
const labelUp = new THREE.Vector3();
const labelOut = new THREE.Vector3();
export function writeLabelAnchors(
  model: FleetModel,
  at: ReturnType<typeof fleetAt>,
  placements: TilePlacement[],
  camera: THREE.Camera,
  width: number,
  height: number,
  anchor: { labels: LabelAnchor[] },
  lift: number
) {
  if (anchor.labels.length !== model.projects.length) {
    anchor.labels = model.projects.map(project => ({
      project: project.id,
      x: 0,
      y: 0,
      visible: false,
      count: 0,
      facing: 0,
    }));
  }
  // the rig moved the camera this frame; the matrices must say so, or every
  // anchor trails the picture by a frame
  camera.updateMatrixWorld();
  labelUp.setFromMatrixColumn(camera.matrixWorld, 1);
  const centers = centerTiles(model);
  for (const project of model.projects) {
    const slot = anchor.labels[project.id];
    if (project.first >= at.count) {
      slot.visible = false;
      slot.count = 0;
      slot.facing = 0;
      continue;
    }
    const place = placements[centers[project.id]];
    const last = Math.min(at.count, project.first + project.count);
    const edge = model.agents[last - 1].ring;
    labelNormal.copy(place.position).sub(SPHERE_CENTER).normalize();
    // screen-up, flattened onto the surface here
    labelOut
      .copy(labelUp)
      .addScaledVector(labelNormal, -labelUp.dot(labelNormal));
    if (labelOut.lengthSq() < 0.04) labelOut.set(0, 0, -1);
    labelOut.normalize();
    labelWorld
      .copy(place.position)
      .addScaledVector(labelOut, (edge + 1) * RING_PITCH + LABEL_MARGIN)
      .sub(SPHERE_CENTER)
      .setLength(SPHERE_RADIUS + lift)
      .add(SPHERE_CENTER);
    slot.visible = projectToCanvas(
      labelWorld,
      camera,
      width,
      height,
      labelPoint
    );
    slot.x = labelPoint.x;
    slot.y = labelPoint.y;
    slot.count = Math.max(0, last - project.first);
    labelOut.copy(camera.position).sub(place.position).normalize();
    slot.facing = labelNormal.dot(labelOut);
  }
}
