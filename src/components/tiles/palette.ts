import * as THREE from 'three';
import type { StatusLightState } from '@/components/status-light/protocol';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
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
