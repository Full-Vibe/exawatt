'use client';

/**
 * Shared geometry and color vocabulary for the board's WebGL layers: the one
 * Agent-unit hex, the D40 status-mark primitives, the lens color mapping, and
 * the recession mix. Module scope on purpose -- several layers draw the same
 * nouns, and a shared definition is what keeps them the same noun.
 */

import * as THREE from 'three';
import { UNREAD_CORNER_MARK } from '@/components/status-light/inspection';
import {
  type SpatialBoardLens,
  type SpatialBoardPiece,
} from '@exawatt/ui-model';
import {
  spatialPressureColor,
  spatialStatusColor,
  type SpatialThemeSnapshot,
} from '../spatial-theme';

export const BURN_RAMP_STEPS = 32;

/** How far a non-focused Project's mass mixes toward the board (V3.7). Bodies
 *  and plates recede this much; status lights never do. */
export const FOCUS_RECESSION_MIX = 0.82;

/** One color decision for every piece mark: status protocol by default, the
 *  FLUX ramp under the burn lens. Shape always keeps carrying status (D30
 *  redundant channels), so the lens swaps only the hue channel. */
export function pieceLensColor(
  piece: SpatialBoardPiece,
  lens: SpatialBoardLens,
  theme: SpatialThemeSnapshot
): string {
  return lens === 'burn'
    ? piece.burnIntensity == null || piece.burnIntensity < 0
      ? theme.consumption.unknown
      : spatialPressureColor(theme, piece.burnIntensity)
    : spatialStatusColor(theme, piece.status);
}

/**
 * The one Agent-unit noun. Parents and delegated children are the same family
 * by construction — they share this geometry rather than each constructing an
 * identical hex prism, so the family cannot drift and the GPU holds one buffer.
 *
 * Module scope, created once and never disposed: it is a six-sided prism of a
 * few hundred bytes, two layers mount and unmount it independently, and it
 * lives exactly as long as the lazily-imported board chunk that owns it.
 * Ref-counting it would mean mutating module state during render.
 */
/**
 * The D40 status-mark primitives. Module scope for the same reasons as
 * `AGENT_HEX_GEOMETRY`: they are small, several layers draw them, and a shared
 * definition is what guarantees a delegated child's Active light is literally
 * the same light as its parent's rather than a lookalike.
 */
const markSlot = 0.68;
const unreadRadius =
  (markSlot * UNREAD_CORNER_MARK.diameter) / UNREAD_CORNER_MARK.slot / 2;
const unreadOffset =
  markSlot / 2 -
  unreadRadius -
  (markSlot * UNREAD_CORNER_MARK.inset) / UNREAD_CORNER_MARK.slot;

export const STATUS_MARK_GEOMETRY = {
  backing: new THREE.CircleGeometry(markSlot / 2, 32),
  unread: new THREE.CircleGeometry(unreadRadius, 16).translate(
    unreadOffset,
    unreadOffset,
    0
  ),
  ring: new THREE.RingGeometry(0.18, 0.28, 32),
  offSegment: new THREE.RingGeometry(0.21, 0.27, 8, 1, 0, Math.PI / 4),
  // The unreported mark, matching the DOM atom: an unbroken socket ring that
  // holds the footprint, and one bar across it standing for no reading. It is
  // the only mark in the family whose interior is a straight line, so the
  // board separates "quietly waiting" from "nobody said" by shape, not hue.
  socketRing: new THREE.RingGeometry(0.225, 0.265, 32),
  noReadingBar: new THREE.PlaneGeometry(0.3, 0.055),
  rotor: new THREE.CircleGeometry(0.2, 24, -Math.PI / 2, Math.PI),
  signal: new THREE.CircleGeometry(0.28, 28),
  check: checkGeometry(),
  dot: new THREE.CircleGeometry(0.07, 16),
  cross: crossGeometry(),
} as const;

export const AGENT_HEX_GEOMETRY = (() => {
  const geometry = new THREE.CylinderGeometry(0.5, 0.56, 0.34, 6);
  geometry.rotateX(Math.PI / 2);
  return geometry;
})();

function checkGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.15, 0.01);
  shape.lineTo(-0.06, -0.08);
  shape.lineTo(0.16, 0.14);
  shape.lineTo(0.11, 0.18);
  shape.lineTo(-0.06, 0.02);
  shape.lineTo(-0.11, 0.06);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function crossGeometry(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-0.16, -0.11);
  shape.lineTo(-0.11, -0.16);
  shape.lineTo(0, -0.05);
  shape.lineTo(0.11, -0.16);
  shape.lineTo(0.16, -0.11);
  shape.lineTo(0.05, 0);
  shape.lineTo(0.16, 0.11);
  shape.lineTo(0.11, 0.16);
  shape.lineTo(0, 0.05);
  shape.lineTo(-0.11, 0.16);
  shape.lineTo(-0.16, 0.11);
  shape.lineTo(-0.05, 0);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

export const noopRaycast = () => null;
