/**
 * What every visual option receives and what it owes back (ENG-031 W15).
 *
 * The scroll experience owns the story; a visual owns the pixels. The seam
 * between them is a handful of refs written at scroll frequency and read in
 * `useFrame`, so nothing re-renders React while the page moves.
 */

import type { RefObject } from 'react';
import type { StatusLightState } from '@/components/status-light/protocol';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { FleetModel } from './fleet-model';
import type { NamesId } from './names';
import type { CrustMarkId } from './visuals/crust-marks';
import type { CrustMaterialId } from './visuals/crust-materials';
import type { CrustMotion } from './visuals/crust-motion';
import type { CrustShapeId } from './visuals/crust-shape';
import type { CrustSignalId } from './visuals/crust-signal';
import type { EnvironmentKind } from './visuals/environment';

export type VisualId = 'crust' | 'lidar' | 'dome' | 'prism' | 'mercury';

export const VISUALS: { id: VisualId; name: string; note: string }[] = [
  {
    id: 'crust',
    name: 'Crust',
    note: 'Hex territory on a section of a sphere. Grows with the fleet.',
  },
  {
    id: 'lidar',
    name: 'LiDAR',
    note: 'The same world as a scanned point cloud with a live sweep.',
  },
  {
    id: 'dome',
    name: 'Dome',
    note: "Today's board, bent onto the sphere. The nearest step from what ships.",
  },
  {
    id: 'prism',
    name: 'Prism',
    note: 'Crystal glass with a status light inside each agent. Dispersion and iridescence.',
  },
  {
    id: 'mercury',
    name: 'Mercury',
    note: 'Liquid metal. Agents are droplets that merge into a pool as a Project fills.',
  },
];

/**
 * The story drive. The scroll experience writes the scroll-side fields every
 * scroll frame; the camera rig writes the rail-side fields every rendered
 * frame from its smoothed progress, so every visual reads one smoothed
 * story and never raw scroll.
 */
export interface StoryDrive {
  /** Stage index plus fraction, 0 .. STAGES.length - 1. Raw scroll. */
  progress: number;
  /** Agents when the story does not say: the close-up study's own count. */
  base: number;
  /** Agents the stage on screen shows (`Stage.count`), for choosing the
   *  exemplar. */
  count: number;
  /** The signal each stage lifts under the current copy set, by stage. */
  highlights: (StatusLightState | null)[];
  /** The agent the stage lifts, the first of the highlighted signal, or -1. */
  exemplar: number;
  /** Agent the reader clicked, or -1. */
  selected: number;
  /** How fast the rig lets its progress follow the scroll, per second. A
   *  scroll that is already a smooth move (the study's Page mode) wants a
   *  high rate, so the rig adds no lag of its own; a hand on the wheel wants
   *  a low one, so the scene eases through its jitter. */
  rate: number;
  /** Smoothed progress, written by the camera rig. Visuals blend stage
   *  states on this, through `stageBlend`. */
  rail: number;
  /** How far a gesture has pushed toward the next scene before it pages,
   *  signed, -1 to 1, at a time in milliseconds (W15i). The scroll writes
   *  the reader; the camera leans by it and the page shows it. Absent
   *  outside Page mode. */
  intent?: (now: number) => number;
  /** The direction of the paged move under way, or 0. */
  moving: -1 | 0 | 1;
}

/** Say how a gesture is going (W15i). Module functions, so a hook writes
 *  through the drive it was handed without assigning into its argument. */
export function setIntent(
  drive: StoryDrive,
  intent: ((now: number) => number) | undefined
): void {
  drive.intent = intent;
}

export function setMoving(drive: StoryDrive, moving: -1 | 0 | 1): void {
  drive.moving = moving;
}

/**
 * Written by the visual every rendered frame; read by the DOM overlay.
 * Methods rather than fields, so a visual never assigns into a prop (the
 * React Compiler lint forbids it) and the overlay never sees a half-written
 * point.
 */
export class VisualAnchor {
  /** The selected agent's canvas point, for the open panel. */
  focus = -1;
  focusPoint: { x: number; y: number } | null = null;
  /** One slot per Project, in model order; the overlay draws the present ones. */
  labels: LabelAnchor[] = [];
  private focusSlot = { x: 0, y: 0 };

  setFocus(agent: number, x: number, y: number) {
    this.focusSlot.x = x;
    this.focusSlot.y = y;
    this.focus = agent;
    this.focusPoint = this.focusSlot;
  }
  clearFocus() {
    this.focus = -1;
    this.focusPoint = null;
  }
}

export interface LabelAnchor {
  project: number;
  x: number;
  y: number;
  visible: boolean;
  /** Agents present in the Project right now. */
  count: number;
  /** How squarely the Project faces the camera, 1 head on to 0 at the limb
   *  of the globe. A name over a cluster seen edge-on is clutter. */
  facing: number;
  /** The highest point on screen of the Project's border on the globe
   *  (`territory.ts`): where a tag is pinned and a border's name sits. */
  rimX: number;
  rimY: number;
  rimVisible: boolean;
}

export interface VisualProps {
  model: FleetModel;
  theme: SpatialThemeSnapshot;
  drive: RefObject<StoryDrive>;
  anchor: VisualAnchor;
  reducedMotion: boolean;
  /** The eased count the camera rig fits, shared so the visual and the
   *  camera agree on what is present. */
  shownRef: RefObject<number>;
  /** Body material for the Crust geometry (W15c). Other visuals ignore it. */
  material: CrustMaterialId;
  /** How the agent carries its harness's mark (W15f). Crust only. */
  mark: CrustMarkId;
  /** The tile's outline, crisp to round (W15g). Crust only. */
  shape: CrustShapeId;
  /** How a working agent moves: any of three lights, one lift (W15i).
   *  Crust only. */
  motion: CrustMotion;
  /** How an agent carries its status (W15d). Crust only. */
  signal: CrustSignalId;
  /** Which reflection room lights the materials. Default `room`. */
  light?: EnvironmentKind;
  /** Frame one cluster close, for the material study. */
  closeUp?: boolean;
  /** A ghost tile was clicked: the operator wants the cluster filled. */
  onExpand?: () => void;
  /** Whether a ghost answers the pointer now (a lone agent's slots do; a
   *  full cluster's do not). Read only when `onExpand` is given. */
  expandable?: boolean;
  /** Pressing an agent or a slot clicks like a key (W15i). */
  sound?: boolean;
  /** How the Project names are drawn (W15i); Border also outlines each
   *  Project's land. Crust only draws the outline. */
  names?: NamesId;
  /** The agent under the pointer, or -1. */
  onHoverChange?: (agent: number) => void;
  /** A click landed on an agent, or on nothing (-1). */
  onSelect?: (agent: number) => void;
}

export const STATUS_ORDER: StatusLightState[] = [
  'active',
  'needs-you',
  'result',
  'off',
  'fault',
];
