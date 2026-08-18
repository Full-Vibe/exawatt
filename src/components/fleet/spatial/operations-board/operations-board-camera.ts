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
  // How far one semantic move may zoom relative to where the camera is now.
  // Under one geometry (V3.7) the room a focused Project needs comes from the
  // camera alone -- units no longer grow when focused -- so a Fleet -> Project
  // move must be allowed to reach the Project's actual fit. 1.45 was tuned
  // when the unit did 1.69x of the work; that factor moved here.
  semanticZoomRatio: 3.6,
  compactViewportSemanticZoomRatio: 4.2,
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

/**
 * Camera limits and the elastic response at them (V3.3 F3, decision `0024`:
 * "pan clamping must never eat input silently"). Two rules produce it:
 *
 * - the camera center stays within the board expanded by `panSlack` of the
 *   visible half-extent, so the world can never be pushed entirely off screen;
 * - an input may push `overshoot` past a bound, then a damped relax returns it.
 *   The excursion is what the hand feels; without it a clamped gesture is
 *   indistinguishable from a dropped one.
 */
export const BOARD_CAMERA_LIMIT_POLICY = {
  zoomOutRatio: 0.55,
  zoomInRatio: 4.5,
  panSlack: 0.62,
  panOvershoot: 0.085,
  zoomOvershoot: 0.06,
  relaxLambda: 8.5,
  restEpsilon: 1e-4,
} as const;

export interface BoardCameraLimits {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZoom: number;
  maxZoom: number;
  overshootX: number;
  overshootY: number;
}

/** Which bound the operator is currently pushing against. Mutable and caller
 *  owned so the per-frame relax never allocates (guide rule 3). */
export interface BoardClampEdges {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
}

export function createBoardClampEdges(): BoardClampEdges {
  return {
    left: false,
    right: false,
    top: false,
    bottom: false,
    zoomIn: false,
    zoomOut: false,
  };
}

export function boardClampEdgesKey(edges: BoardClampEdges): string {
  return `${edges.left ? 'l' : ''}${edges.right ? 'r' : ''}${
    edges.top ? 't' : ''
  }${edges.bottom ? 'b' : ''}${edges.zoomIn ? 'i' : ''}${
    edges.zoomOut ? 'o' : ''
  }`;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Pan bounds follow the WHOLE board, not the focused subject: altitude is
 * resolution inside one world, so descending into a Project must not fence the
 * camera out of its neighbors.
 */
export function boardCameraLimits(
  bounds: SpatialBoardRect,
  size: BoardViewportSize,
  fitZoom: number,
  target: BoardCameraTarget
): BoardCameraLimits {
  const zoom = Math.max(effectiveBoardCameraZoom(target), 0.001);
  const halfWidth = finiteOr(size.width / (2 * zoom), 0);
  const halfHeight = finiteOr(size.height / (2 * zoom), 0);
  const slackX = halfWidth * BOARD_CAMERA_LIMIT_POLICY.panSlack;
  const slackY = halfHeight * BOARD_CAMERA_LIMIT_POLICY.panSlack;
  const safeFit = fitZoom > 0 && Number.isFinite(fitZoom) ? fitZoom : 0;
  return {
    minX: bounds.x - slackX,
    maxX: bounds.x + bounds.width + slackX,
    // Layout rects are y-down; the camera lives in y-up world space.
    minY: -(bounds.y + bounds.height) - slackY,
    maxY: -bounds.y + slackY,
    minZoom: safeFit > 0 ? safeFit * BOARD_CAMERA_LIMIT_POLICY.zoomOutRatio : 0,
    maxZoom: safeFit > 0
      ? safeFit * BOARD_CAMERA_LIMIT_POLICY.zoomInRatio
      : Number.POSITIVE_INFINITY,
    overshootX: halfWidth * BOARD_CAMERA_LIMIT_POLICY.panOvershoot,
    overshootY: halfHeight * BOARD_CAMERA_LIMIT_POLICY.panOvershoot,
  };
}

/**
 * Clamp a requested camera target to its limits, allowing a bounded elastic
 * excursion past each engaged bound. Mutates `target` and `edges` in place and
 * returns whether any bound is engaged. `elastic: false` (reduced motion, low
 * power) clamps hard — the edge report is then the only feedback channel.
 */
export function clampBoardCameraTargetInPlace(
  target: BoardCameraTarget,
  limits: BoardCameraLimits,
  elastic: boolean,
  edges: BoardClampEdges
): boolean {
  const overshootX = elastic ? limits.overshootX : 0;
  const overshootY = elastic ? limits.overshootY : 0;
  const zoomOvershoot = elastic ? BOARD_CAMERA_LIMIT_POLICY.zoomOvershoot : 0;
  edges.left = target.x < limits.minX;
  edges.right = target.x > limits.maxX;
  edges.bottom = target.y < limits.minY;
  edges.top = target.y > limits.maxY;
  edges.zoomOut = target.zoom < limits.minZoom;
  edges.zoomIn = target.zoom > limits.maxZoom;
  // A board narrower than its slack can invert the range; the midpoint is the
  // only honest answer and keeps the world centered instead of NaN.
  if (limits.minX > limits.maxX) target.x = (limits.minX + limits.maxX) / 2;
  else {
    target.x = THREE.MathUtils.clamp(
      target.x,
      limits.minX - overshootX,
      limits.maxX + overshootX
    );
  }
  if (limits.minY > limits.maxY) target.y = (limits.minY + limits.maxY) / 2;
  else {
    target.y = THREE.MathUtils.clamp(
      target.y,
      limits.minY - overshootY,
      limits.maxY + overshootY
    );
  }
  target.zoom = THREE.MathUtils.clamp(
    target.zoom,
    limits.minZoom * (1 - zoomOvershoot),
    limits.maxZoom * (1 + zoomOvershoot)
  );
  return (
    edges.left ||
    edges.right ||
    edges.top ||
    edges.bottom ||
    edges.zoomIn ||
    edges.zoomOut
  );
}

function relaxAxis(
  value: number,
  min: number,
  max: number,
  delta: number
): number {
  const bound = value < min ? min : value > max ? max : null;
  if (bound === null) return value;
  const next = THREE.MathUtils.damp(
    value,
    bound,
    BOARD_CAMERA_LIMIT_POLICY.relaxLambda,
    delta
  );
  return Math.abs(next - bound) <= BOARD_CAMERA_LIMIT_POLICY.restEpsilon
    ? bound
    : next;
}

/**
 * Return an over-pushed camera target to its bounds. Mutates in place and
 * reports whether it is still travelling, so the demand loop keeps painting
 * exactly as long as the rubber band is visibly moving.
 */
export function relaxBoardCameraTargetInPlace(
  target: BoardCameraTarget,
  limits: BoardCameraLimits,
  delta: number
): boolean {
  const x = relaxAxis(target.x, limits.minX, limits.maxX, delta);
  const y = relaxAxis(target.y, limits.minY, limits.maxY, delta);
  const zoom = relaxAxis(target.zoom, limits.minZoom, limits.maxZoom, delta);
  const moved =
    x !== target.x || y !== target.y || zoom !== target.zoom;
  target.x = x;
  target.y = y;
  target.zoom = zoom;
  return moved;
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
