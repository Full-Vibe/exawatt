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
import type { CrustMaterialId } from './visuals/crust-materials';
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
  /** Agents before the fleet stage grows it. */
  base: number;
  /** Agents the stage on screen nominally shows (base, or the whole fleet). */
  count: number;
  /** The signal each stage lifts under the current copy set, by stage. */
  highlights: (StatusLightState | null)[];
  /** Agent id the panel points at, or -1. */
  exemplar: number;
  /** Agent the reader clicked, or -1. */
  selected: number;
  /** Smoothed progress, written by the camera rig. Visuals blend stage
   *  states on this, through `stageBlend`. */
  rail: number;
  /** The visual recedes behind centred type. Written by the camera rig. */
  recede: number;
}

/**
 * Written by the visual every rendered frame; read by the DOM overlay.
 * Methods rather than fields, so a visual never assigns into a prop (the
 * React Compiler lint forbids it) and the overlay never sees a half-written
 * point.
 */
export class VisualAnchor {
  exemplar: { x: number; y: number } | null = null;
  /** The selected agent's canvas point, for the info card. */
  focus = -1;
  focusPoint: { x: number; y: number } | null = null;
  /** One slot per Project, in model order; the overlay draws the present ones. */
  labels: LabelAnchor[] = [];
  private exemplarSlot = { x: 0, y: 0 };
  private focusSlot = { x: 0, y: 0 };

  setExemplar(x: number, y: number) {
    this.exemplarSlot.x = x;
    this.exemplarSlot.y = y;
    this.exemplar = this.exemplarSlot;
  }
  clearExemplar() {
    this.exemplar = null;
  }
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
  needsYou: number;
}

export interface VisualProps {
  model: FleetModel;
  theme: SpatialThemeSnapshot;
  drive: RefObject<StoryDrive>;
  anchor: VisualAnchor;
  reducedMotion: boolean;
  /** Body material for the Crust geometry (W15c). Other visuals ignore it. */
  material: CrustMaterialId;
  /** Kind marks: the inlay is a glyph for the agent's harness (W15c). */
  marks: boolean;
  /** How an agent carries its status (W15d). Crust only. */
  signal: CrustSignalId;
  /** Which reflection room lights the materials. Default `room`. */
  light?: EnvironmentKind;
  /** Frame one cluster close, for the material study. */
  closeUp?: boolean;
  /** A ghost tile was clicked: the operator wants one more agent. */
  onExpand?: () => void;
  /** The agent under the pointer, or -1. A click selects it. */
  onHoverChange?: (agent: number) => void;
}

export const STATUS_ORDER: StatusLightState[] = [
  'active',
  'needs-you',
  'result',
  'off',
  'fault',
];
