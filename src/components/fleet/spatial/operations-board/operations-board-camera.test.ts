import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BOARD_CAMERA_LIMIT_POLICY,
  BOARD_CAMERA_POLICY,
  applyBoardCameraTarget,
  boardCameraLimits,
  boardClampEdgesKey,
  boardViewportFromCamera,
  clampBoardCameraTargetInPlace,
  clientPointToBoard,
  createBoardClampEdges,
  createBoardProjectionScratch,
  fittedBoardCameraTarget,
  relaxBoardCameraTargetInPlace,
  fitBoardZoom,
  semanticBoardCameraTarget,
  softFollowBoardPoint,
  softFollowBoardRect,
  type BoardCameraTarget,
} from './operations-board-camera';

const size = { width: 1_000, height: 700 };
const target: BoardCameraTarget = { x: 0, y: 0, zoom: 10, tilt: 0 };

function cameraFor(value: BoardCameraTarget) {
  const camera = new THREE.OrthographicCamera(-500, 500, 350, -350, 0.1, 200);
  applyBoardCameraTarget(camera, value);
  camera.updateMatrixWorld(true);
  return camera;
}

describe('operations board camera policy', () => {
  it('applies a target through the imperative camera adapter', () => {
    const camera = cameraFor({ ...target, x: 12, y: -8, tilt: 1 });
    expect(camera.zoom).toBeCloseTo(
      target.zoom * BOARD_CAMERA_POLICY.fixedAngleZoomScale
    );
    expect(camera.position.toArray()).toEqual([30, -30, 76]);
  });

  it('interpolates projection zoom continuously through a tilt transition', () => {
    const camera = cameraFor({ ...target, tilt: 0.5 });
    expect(camera.zoom).toBeCloseTo(
      target.zoom * ((1 + BOARD_CAMERA_POLICY.fixedAngleZoomScale) / 2)
    );
  });

  it('fits a rectangle with bounded padding', () => {
    expect(
      fittedBoardCameraTarget({ x: 20, y: 10, width: 40, height: 20 }, size, 0)
    ).toEqual({ x: 40, y: -20, zoom: 20.833333333333332, tilt: 0 });
  });

  it('does not move while the selected unit is inside the safe zone', () => {
    expect(softFollowBoardPoint(target, { x: 20, y: 10 }, size)).toEqual(
      target
    );
  });

  it('pans only the distance needed to return a unit to the edge buffer', () => {
    const followed = softFollowBoardPoint(target, { x: 60, y: -10 }, size);
    expect(followed.x).toBeCloseTo(28);
    expect(followed.y).toBe(0);
    expect(followed.zoom).toBe(target.zoom);
  });

  it('keeps a focused Project boundary inside the safe buffer', () => {
    const followed = softFollowBoardRect(
      target,
      { x: -60, y: -10, width: 30, height: 20 },
      size
    );
    expect(followed.x).toBeCloseTo(-28);
    expect(followed.y).toBe(0);
  });

  it('bounds semantic zoom and preserves off-center composition', () => {
    // A tiny rect would fit at a huge zoom; the move is bounded to the policy
    // ratio of where the camera is now, so one keystroke never teleports.
    const next = semanticBoardCameraTarget(
      target,
      { x: 55, y: 20, width: 4, height: 4 },
      size
    );
    expect(next.zoom).toBeCloseTo(
      target.zoom * BOARD_CAMERA_POLICY.semanticZoomRatio
    );
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(57);
  });

  it('reaches a Project\'s actual fit from Fleet under one geometry (V3.7)', () => {
    // Units no longer grow when a Project is focused, so the camera alone
    // must supply the room. From a Fleet zoom, a Voltaic-sized Project circle
    // (radius ~10, viewport 1440x900) must land on its FIT, not on a bounded
    // fraction of it -- 1.45x used to leave 12px hexes at Project altitude.
    const fleet = { x: 0, y: 0, zoom: 9.2, tilt: 0 };
    const rect = { x: 3.75, y: 3.75, width: 20.5, height: 20.5 };
    const viewport = { width: 1440, height: 900 };
    const next = semanticBoardCameraTarget(fleet, rect, viewport);
    expect(next.zoom).toBeCloseTo(fitBoardZoom(rect, viewport), 6);
    expect(next.zoom).toBeGreaterThan(fleet.zoom * 2.5);
  });

  it('allows more semantic zoom on compact viewports for touch targets', () => {
    // A compact viewport may zoom further per move than a desktop one, so
    // 44px direct-touch Agent targets separate. Here the rect's fit is within
    // that allowance, so the move lands on the fit; on desktop with the same
    // starting zoom the ceiling would be lower.
    const compact = { width: 600, height: 700 };
    const rect = { x: 0, y: 0, width: 4, height: 4 };
    const next = semanticBoardCameraTarget(target, rect, compact);
    expect(next.zoom).toBeCloseTo(fitBoardZoom(rect, compact), 6);
    expect(next.zoom).toBeLessThanOrEqual(
      target.zoom * BOARD_CAMERA_POLICY.compactViewportSemanticZoomRatio
    );
    expect(BOARD_CAMERA_POLICY.compactViewportSemanticZoomRatio).toBeGreaterThan(
      BOARD_CAMERA_POLICY.semanticZoomRatio
    );
  });
});

describe('operations board projection', () => {
  it('projects the top-down camera footprint exactly', () => {
    const camera = cameraFor(target);
    const viewport = boardViewportFromCamera(
      camera,
      createBoardProjectionScratch()
    );
    expect(viewport).not.toBeNull();
    expect(viewport!.centerX).toBeCloseTo(0);
    expect(viewport!.centerY).toBeCloseTo(0);
    expect(viewport!.width).toBeCloseTo(100);
    expect(viewport!.height).toBeCloseTo(70);
  });

  it('reports the larger fixed-angle board-plane footprint', () => {
    const top = boardViewportFromCamera(
      cameraFor(target),
      createBoardProjectionScratch()
    )!;
    const angle = boardViewportFromCamera(
      cameraFor({ ...target, tilt: 1 }),
      createBoardProjectionScratch()
    )!;
    expect(angle.width).toBeGreaterThan(top.width);
    expect(angle.height).toBeGreaterThan(top.height);
  });

  it('maps client coordinates through the actual camera projection', () => {
    const camera = cameraFor({ ...target, x: 12, y: -8, tilt: 1 });
    const point = clientPointToBoard(
      camera,
      { left: 100, top: 50, width: 1_000, height: 700 },
      600,
      400,
      createBoardProjectionScratch()
    );
    expect(point).not.toBeNull();
    expect(point!.x).toBeCloseTo(12);
    expect(point!.y).toBeCloseTo(-8);
  });
});

describe('board camera limits and clamp feedback (F3)', () => {
  const bounds = { x: 0, y: 0, width: 120, height: 90 };
  const limitsFor = (value: BoardCameraTarget) =>
    boardCameraLimits(bounds, size, 8, value);

  it('bounds the camera to the board plus a slack fraction of the viewport', () => {
    const limits = limitsFor(target);
    const halfWidth = size.width / (2 * target.zoom);
    const slack = halfWidth * BOARD_CAMERA_LIMIT_POLICY.panSlack;
    expect(limits.minX).toBeCloseTo(bounds.x - slack);
    expect(limits.maxX).toBeCloseTo(bounds.x + bounds.width + slack);
    // Layout rects are y-down; the camera lives in y-up world space.
    const slackY =
      (size.height / (2 * target.zoom)) * BOARD_CAMERA_LIMIT_POLICY.panSlack;
    expect(limits.maxY).toBeCloseTo(-bounds.y + slackY);
    expect(limits.minY).toBeCloseTo(-(bounds.y + bounds.height) - slackY);
    expect(limits.minZoom).toBeCloseTo(
      8 * BOARD_CAMERA_LIMIT_POLICY.zoomOutRatio
    );
    expect(limits.maxZoom).toBeCloseTo(
      8 * BOARD_CAMERA_LIMIT_POLICY.zoomInRatio
    );
  });

  it('lets a clamped pan travel a bounded distance past the bound', () => {
    const value: BoardCameraTarget = { ...target, x: 10_000 };
    const limits = limitsFor(value);
    const edges = createBoardClampEdges();
    const engaged = clampBoardCameraTargetInPlace(value, limits, true, edges);
    expect(engaged).toBe(true);
    expect(edges.right).toBe(true);
    expect(edges.left).toBe(false);
    // The excursion is what the hand feels: past the bound, but bounded.
    expect(value.x).toBeGreaterThan(limits.maxX);
    expect(value.x).toBeCloseTo(limits.maxX + limits.overshootX);
  });

  it('clamps hard with no excursion when motion is suppressed', () => {
    const value: BoardCameraTarget = { ...target, x: 10_000 };
    const limits = limitsFor(value);
    const edges = createBoardClampEdges();
    clampBoardCameraTargetInPlace(value, limits, false, edges);
    expect(value.x).toBeCloseTo(limits.maxX);
    // The edge report survives so the DOM indicator still answers the gesture.
    expect(boardClampEdgesKey(edges)).toBe('r');
  });

  it('reports the engaged zoom bound and bounds the zoom excursion', () => {
    const value: BoardCameraTarget = { ...target, zoom: 1_000 };
    const limits = limitsFor(value);
    const edges = createBoardClampEdges();
    clampBoardCameraTargetInPlace(value, limits, true, edges);
    expect(edges.zoomIn).toBe(true);
    expect(value.zoom).toBeCloseTo(
      limits.maxZoom * (1 + BOARD_CAMERA_LIMIT_POLICY.zoomOvershoot)
    );
  });

  it('reports no engaged edge for a target inside the limits', () => {
    const value: BoardCameraTarget = { ...target, x: 60, y: -45 };
    const limits = limitsFor(value);
    const edges = createBoardClampEdges();
    expect(clampBoardCameraTargetInPlace(value, limits, true, edges)).toBe(
      false
    );
    expect(boardClampEdgesKey(edges)).toBe('');
    expect(value.x).toBeCloseTo(60);
    expect(value.y).toBeCloseTo(-45);
  });

  it('relaxes an over-pushed target back onto its bound and then rests', () => {
    const value: BoardCameraTarget = { ...target, x: 10_000 };
    const limits = limitsFor(value);
    clampBoardCameraTargetInPlace(value, limits, true, createBoardClampEdges());
    const pushed = value.x;
    expect(relaxBoardCameraTargetInPlace(value, limits, 1 / 60)).toBe(true);
    expect(value.x).toBeLessThan(pushed);
    for (let frame = 0; frame < 240; frame += 1) {
      relaxBoardCameraTargetInPlace(value, limits, 1 / 60);
    }
    expect(value.x).toBeCloseTo(limits.maxX);
    // Settled: the demand loop must be allowed to park.
    expect(relaxBoardCameraTargetInPlace(value, limits, 1 / 60)).toBe(false);
  });

  it('leaves an in-bounds target untouched so a solved pose is never dragged', () => {
    const value: BoardCameraTarget = { ...target, x: 60, y: -45 };
    const limits = limitsFor(value);
    expect(relaxBoardCameraTargetInPlace(value, limits, 1 / 60)).toBe(false);
    expect(value.x).toBeCloseTo(60);
  });

  it('centers rather than producing NaN when slack inverts the range', () => {
    const value: BoardCameraTarget = { ...target, x: 5, zoom: 0 };
    const limits = boardCameraLimits(bounds, size, 0, value);
    clampBoardCameraTargetInPlace(value, limits, true, createBoardClampEdges());
    expect(Number.isFinite(value.x)).toBe(true);
    expect(Number.isFinite(value.y)).toBe(true);
  });
});
