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

/** Written by the scroll experience every scroll frame; read in `useFrame`. */
export interface StoryDrive {
  /** Stage index plus fraction, 0 .. STAGES.length - 1. */
  progress: number;
  /** Agents the visual should show right now (eased by the visual). */
  count: number;
  /** Signal to lift, or null for the whole fleet. */
  highlight: StatusLightState | null;
  /** Agent id the panel points at, or -1. */
  exemplar: number;
  /** Side the reading column sits on, so the visual can keep the subject
   *  clear of it. -1 left, 0 centre, 1 right. */
  side: -1 | 0 | 1;
  /** The visual recedes behind centred type. */
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
  hover = -1;
  hoverPoint: { x: number; y: number } | null = null;
  /** One slot per Project, in model order; the overlay draws the present ones. */
  labels: LabelAnchor[] = [];
  private exemplarSlot = { x: 0, y: 0 };
  private hoverSlot = { x: 0, y: 0 };

  setExemplar(x: number, y: number) {
    this.exemplarSlot.x = x;
    this.exemplarSlot.y = y;
    this.exemplar = this.exemplarSlot;
  }
  clearExemplar() {
    this.exemplar = null;
  }
  setHover(agent: number, x: number, y: number) {
    this.hoverSlot.x = x;
    this.hoverSlot.y = y;
    this.hover = agent;
    this.hoverPoint = this.hoverSlot;
  }
  clearHover() {
    this.hover = -1;
    this.hoverPoint = null;
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
  /** A ghost tile was clicked: the operator wants one more agent. */
  onExpand?: () => void;
  onHoverChange?: (agent: number) => void;
}

export const STATUS_ORDER: StatusLightState[] = [
  'active',
  'needs-you',
  'result',
  'off',
  'fault',
];
