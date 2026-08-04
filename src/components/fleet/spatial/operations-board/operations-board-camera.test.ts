import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BOARD_CAMERA_POLICY,
  applyBoardCameraTarget,
  boardViewportFromCamera,
  clientPointToBoard,
  createBoardProjectionScratch,
  fittedBoardCameraTarget,
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
    const next = semanticBoardCameraTarget(
      target,
      { x: 55, y: 20, width: 4, height: 4 },
      size
    );
    expect(next.zoom).toBeCloseTo(target.zoom * 1.45);
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(57);
  });

  it('allows more semantic zoom on compact viewports for touch targets', () => {
    const next = semanticBoardCameraTarget(
      target,
      { x: 0, y: 0, width: 4, height: 4 },
      { width: 600, height: 700 }
    );
    expect(next.zoom).toBeCloseTo(
      target.zoom * BOARD_CAMERA_POLICY.compactViewportSemanticZoomRatio
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
