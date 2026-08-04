import * as THREE from 'three';
import type { SpatialBoardRect } from '@exawatt/ui-model';

export interface BoardCameraTarget {
  x: number;
  y: number;
  zoom: number;
  tilt: number;
}

export interface OperationsBoardViewport {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

export interface BoardViewportSize {
  width: number;
  height: number;
}

export interface BoardPoint {
  x: number;
  y: number;
}

export const BOARD_CAMERA_POLICY = {
  minimumZoom: 0.35,
  fitPaddingX: 8,
  fitPaddingY: 8,
  fitMinimumWidth: 18,
  fitMinimumHeight: 14,
  semanticZoomRatio: 1.45,
  compactViewportSemanticZoomRatio: 2.2,
  compactViewportMaximumWidth: 600,
  safeInsetX: 0.18,
  safeInsetY: 0.2,
  fixedAngleZoomScale: 0.92,
} as const;

export function boardRectCenter(rect: SpatialBoardRect): BoardPoint {
  return {
    x: rect.x + rect.width / 2,
    y: -(rect.y + rect.height / 2),
  };
}

export function effectiveBoardCameraZoom(target: BoardCameraTarget): number {
  return (
    target.zoom *
    THREE.MathUtils.lerp(
      1,
      BOARD_CAMERA_POLICY.fixedAngleZoomScale,
      THREE.MathUtils.clamp(target.tilt, 0, 1)
    )
  );
}

/** Imperative R3F adapter kept outside React so the camera policy remains
 * independently testable and React render inputs are never mutated. */
export function applyBoardCameraTarget(
  camera: THREE.OrthographicCamera,
  target: BoardCameraTarget
): void {
  camera.position.set(
    target.x + target.tilt * 18,
    target.y - target.tilt * 22,
    100 - target.tilt * 24
  );
  camera.up.set(0, 1, 0);
  camera.lookAt(target.x, target.y, 0);
  camera.zoom = effectiveBoardCameraZoom(target);
  camera.updateProjectionMatrix();
}

export function fitBoardZoom(
  rect: SpatialBoardRect,
  size: BoardViewportSize
): number {
  const paddedWidth = Math.max(
    BOARD_CAMERA_POLICY.fitMinimumWidth,
    rect.width + BOARD_CAMERA_POLICY.fitPaddingX
  );
  const paddedHeight = Math.max(
    BOARD_CAMERA_POLICY.fitMinimumHeight,
    rect.height + BOARD_CAMERA_POLICY.fitPaddingY
  );
  return Math.max(
    BOARD_CAMERA_POLICY.minimumZoom,
    Math.min(size.width / paddedWidth, size.height / paddedHeight)
  );
}

export function fittedBoardCameraTarget(
  rect: SpatialBoardRect,
  size: BoardViewportSize,
  tilt: number
): BoardCameraTarget {
  const center = boardRectCenter(rect);
  return { ...center, zoom: fitBoardZoom(rect, size), tilt };
}

/**
 * Move the camera only far enough to return a subject to the interior safe
 * zone. Subjects already inside the buffer do not move the camera, preserving
 * the operator's composition instead of pinning the unit to dead center.
 */
export function softFollowBoardPoint(
  target: BoardCameraTarget,
  point: BoardPoint,
  size: BoardViewportSize,
  insets: { x?: number; y?: number } = {}
): BoardCameraTarget {
  const zoom = Math.max(effectiveBoardCameraZoom(target), 0.001);
  const halfSafeWidth =
    (size.width / zoom) *
    Math.max(0.05, 0.5 - (insets.x ?? BOARD_CAMERA_POLICY.safeInsetX));
  const halfSafeHeight =
    (size.height / zoom) *
    Math.max(0.05, 0.5 - (insets.y ?? BOARD_CAMERA_POLICY.safeInsetY));
  let x = target.x;
  let y = target.y;
  if (point.x < x - halfSafeWidth) x = point.x + halfSafeWidth;
  else if (point.x > x + halfSafeWidth) x = point.x - halfSafeWidth;
  if (point.y < y - halfSafeHeight) y = point.y + halfSafeHeight;
  else if (point.y > y + halfSafeHeight) y = point.y - halfSafeHeight;
  return { ...target, x, y };
}

/** Minimal follow for a semantic subject with area (Project/Agent bounds).
 * Keeps the full rect in the safe interior when it fits; oversized subjects
 * fall back to their center because no camera translation can contain them. */
export function softFollowBoardRect(
  target: BoardCameraTarget,
  rect: SpatialBoardRect,
  size: BoardViewportSize,
  insets: { x?: number; y?: number } = {}
): BoardCameraTarget {
  const zoom = Math.max(effectiveBoardCameraZoom(target), 0.001);
  const halfSafeWidth =
    (size.width / zoom) *
    Math.max(0.05, 0.5 - (insets.x ?? BOARD_CAMERA_POLICY.safeInsetX));
  const halfSafeHeight =
    (size.height / zoom) *
    Math.max(0.05, 0.5 - (insets.y ?? BOARD_CAMERA_POLICY.safeInsetY));
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = -(rect.y + rect.height);
  const maxY = -rect.y;
  let x = target.x;
  let y = target.y;
  if (maxX - minX <= halfSafeWidth * 2) {
    if (minX < x - halfSafeWidth) x = minX + halfSafeWidth;
    else if (maxX > x + halfSafeWidth) x = maxX - halfSafeWidth;
  } else {
    x = (minX + maxX) / 2;
  }
  if (maxY - minY <= halfSafeHeight * 2) {
    if (minY < y - halfSafeHeight) y = minY + halfSafeHeight;
    else if (maxY > y + halfSafeHeight) y = maxY - halfSafeHeight;
  } else {
    y = (minY + maxY) / 2;
  }
  return { ...target, x, y };
}

/**
 * Altitude changes are bounded semantic zooms, not refits. The focused subject
 * keeps its current screen composition unless it would cross the safe zone.
 */
export function semanticBoardCameraTarget(
  current: BoardCameraTarget,
  focusRect: SpatialBoardRect,
  size: BoardViewportSize
): BoardCameraTarget {
  const fitZoom = fitBoardZoom(focusRect, size);
  // Compact viewports need enough semantic zoom for 44px direct-touch Agent
  // targets to separate. This is still a bounded move in the same world: the
  // camera keeps the focused Project's screen composition and the minimap
  // continues to show every neighboring Project.
  const ratio =
    size.width <= BOARD_CAMERA_POLICY.compactViewportMaximumWidth
      ? BOARD_CAMERA_POLICY.compactViewportSemanticZoomRatio
      : BOARD_CAMERA_POLICY.semanticZoomRatio;
  const zoom = THREE.MathUtils.clamp(
    fitZoom,
    current.zoom / ratio,
    current.zoom * ratio
  );
  return softFollowBoardRect({ ...current, zoom }, focusRect, size);
}

export interface BoardProjectionScratch {
  raycaster: THREE.Raycaster;
  plane: THREE.Plane;
  ndc: THREE.Vector2;
  point: THREE.Vector3;
  viewport: OperationsBoardViewport;
}

export function createBoardProjectionScratch(): BoardProjectionScratch {
  return {
    raycaster: new THREE.Raycaster(),
    plane: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    ndc: new THREE.Vector2(),
    point: new THREE.Vector3(),
    viewport: { centerX: 0, centerY: 0, width: 0, height: 0 },
  };
}

function boardPlanePoint(
  camera: THREE.OrthographicCamera,
  ndcX: number,
  ndcY: number,
  scratch: BoardProjectionScratch
): boolean {
  scratch.ndc.set(ndcX, ndcY);
  scratch.raycaster.setFromCamera(scratch.ndc, camera);
  return Boolean(
    scratch.raycaster.ray.intersectPlane(scratch.plane, scratch.point)
  );
}

/** Axis-aligned board-plane footprint of the actual rendered camera. */
export function boardViewportFromCamera(
  camera: THREE.OrthographicCamera,
  scratch: BoardProjectionScratch
): OperationsBoardViewport | null {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minLayoutY = Number.POSITIVE_INFINITY;
  let maxLayoutY = Number.NEGATIVE_INFINITY;
  for (const [ndcX, ndcY] of BOARD_NDC_CORNERS) {
    if (!boardPlanePoint(camera, ndcX, ndcY, scratch)) return null;
    minX = Math.min(minX, scratch.point.x);
    maxX = Math.max(maxX, scratch.point.x);
    minLayoutY = Math.min(minLayoutY, -scratch.point.y);
    maxLayoutY = Math.max(maxLayoutY, -scratch.point.y);
  }
  scratch.viewport.centerX = (minX + maxX) / 2;
  scratch.viewport.centerY = (minLayoutY + maxLayoutY) / 2;
  scratch.viewport.width = maxX - minX;
  scratch.viewport.height = maxLayoutY - minLayoutY;
  return scratch.viewport;
}

/** Convert a pointer coordinate to the board plane under either projection. */
export function clientPointToBoard(
  camera: THREE.OrthographicCamera,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  scratch: BoardProjectionScratch
): BoardPoint | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
  return boardPlanePoint(camera, ndcX, ndcY, scratch)
    ? { x: scratch.point.x, y: scratch.point.y }
    : null;
}

const BOARD_NDC_CORNERS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
