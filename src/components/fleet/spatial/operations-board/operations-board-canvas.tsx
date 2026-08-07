'use client';

import { Instances, Instance, Html, Line, useCursor } from '@react-three/drei';
import {
  Canvas,
  type ThreeEvent,
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import {
  selectSpatialDelegationUnits,
  type SpatialBoardDelegationUnit,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardPiece,
  type SpatialBoardProjection,
  type SpatialBoardProjectZone,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  STATUS_LIGHT_META,
  statusLightStateForAgentStatus,
  type StatusLightState,
} from '@/components/status-light/protocol';
import {
  computePopulationDotField,
  POPULATION_STATUS_ORDER,
  type PopulationDotField,
} from './population-dots';
import {
  ALTITUDE_HANDOFF_CROSSFADE_MS,
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  ALTITUDE_HANDOFF_HOLD_MS,
  ALTITUDE_HANDOFF_POSE_EVENT,
  altitudeHandoffActive,
  claimAltitudeHandoff,
  lowPowerLikely,
  solveEntryPose,
  type HandoffPoseDetail,
} from '@/components/nav/altitude-handoff';
import {
  spatialColorWithAlpha,
  spatialPressureColor,
  spatialProjectIdentityColor,
  spatialProjectZoneFill,
  spatialStatusColor,
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import {
  applyBoardCameraTarget,
  boardCameraLimits,
  boardClampEdgesKey,
  boardRectCenter as rectCenter,
  boardViewportFromCamera,
  clampBoardCameraTargetInPlace,
  clientPointToBoard,
  createBoardClampEdges,
  createBoardProjectionScratch,
  effectiveBoardCameraZoom,
  fitBoardZoom,
  fittedBoardCameraTarget,
  relaxBoardCameraTargetInPlace,
  semanticBoardCameraTarget,
  softFollowBoardPoint,
  type BoardCameraTarget,
  type BoardClampEdges,
  type OperationsBoardViewport,
} from './operations-board-camera';
import { boardPointerAction, pinchZoomTarget } from './operations-board-input';

export type { OperationsBoardViewport } from './operations-board-camera';

const OperationsBoardEffects = lazy(() => import('./operations-board-effects'));

const BURN_RAMP_STEPS = 32;

/** One color decision for every piece mark: status protocol by default, the
 *  FLUX ramp under the burn lens. Shape always keeps carrying status (D30
 *  redundant channels), so the lens swaps only the hue channel. */
function pieceLensColor(
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

/** Reads matchMedia synchronously on mount (guide rule 12): initializing to
 *  `false` and correcting in an effect gave reduced-motion users one animated
 *  entrance frame set — entrances must SNAP for them, so the first render
 *  already needs the real preference. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function useLowPowerMode(): boolean {
  const [lowPower, setLowPower] = useState(false);
  useEffect(() => {
    // Shared predicate with the altitude handoff (V3.0): the same machine
    // that renders low-power also skips the entry-pose choreography.
    setLowPower(lowPowerLikely());
  }, []);
  return lowPower;
}

/** V2.4 ambient-motion gate: pulses/rotation run only while the tab is
 *  visible and motion is welcome. Hidden tab or reduced motion ⇒ park. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export interface OperationsBoardHandle {
  recenter(): void;
  restoreViewport(viewport: OperationsBoardViewport): void;
  focusProject(projectId: string): void;
  focusAgent(agentId: string, force?: boolean): void;
  enterSession(agentId: string): void;
  zoom(steps: number): void;
  pan(dx: number, dy: number): void;
  nudge(dx: number, dy: number, dollySteps: number, orbitRadians: number): void;
}

/** Camera speeds (damp lambda): FLIGHT for semantic moves (altitude change,
 *  drill, recenter — slower, reads as travel), NUDGE for direct manipulation
 *  (keys/wheel/drag — tight, immediate acknowledgment). */
const FLIGHT_LAMBDA = 5.5;
const FOLLOW_LAMBDA = 7.5;
const NUDGE_LAMBDA = 13;

function BoardCameraRig({
  layout,
  projection,
  reduced,
  controllerRef,
  onViewportChange,
  onZoomChange,
  onBandSelect,
  bandOverlayRef,
  suppressMissRef,
  followSelection,
  touchSelectionMode,
  onManualCameraInput,
  onClampEdges,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  reduced: boolean;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
  onZoomChange?: (zoom: number) => void;
  /** Band select (V3.2): rect arrives in LAYOUT space (y-down). */
  onBandSelect?: (band: SpatialBoardRect) => void;
  /** DOM rectangle the surface renders; the rig positions it directly. */
  bandOverlayRef?: { current: HTMLDivElement | null };
  /** Set on band end so the trailing click never reads as background. */
  suppressMissRef?: { current: number };
  /** Soft-follow is suspended by manual camera input until explicitly resumed. */
  followSelection: boolean;
  /** Direct touch pans by default; this explicit mode makes it band-select. */
  touchSelectionMode: boolean;
  onManualCameraInput?: () => void;
  /** F3 clamp feedback: fires only when the ENGAGED edge set changes, so the
   *  DOM indicator is semantic state and never a pointer-frequency render. */
  onClampEdges?: (edges: BoardClampEdges | null) => void;
}) {
  const { size, invalidate, gl } = useThree();
  const get = useThree(state => state.get);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const cameraBoundsX = layout.cameraBounds.x;
  const cameraBoundsY = layout.cameraBounds.y;
  const cameraBoundsWidth = layout.cameraBounds.width;
  const cameraBoundsHeight = layout.cameraBounds.height;
  const semanticAddress = `${layout.altitude}:${layout.focusedProjectId ?? '~'}`;
  const previousSemanticAddress = useRef(semanticAddress);
  const initialTilt = projection === 'fixed-angle' ? 1 : 0;
  const target = useRef<BoardCameraTarget>({
    x: 0,
    y: 0,
    zoom: 1,
    tilt: initialTilt,
  });
  const current = useRef<BoardCameraTarget>({
    x: 0,
    y: 0,
    zoom: 1,
    tilt: initialTilt,
  });
  const fitZoom = useRef(1);
  const lambda = useRef(FLIGHT_LAMBDA);
  const initialized = useRef(false);
  const clampEdges = useRef(createBoardClampEdges());
  const clampLimits = useRef<ReturnType<typeof boardCameraLimits> | null>(null);
  const clampEngaged = useRef(false);
  const clampKey = useRef('');
  /** Entry-pose hold (V3.0): while set, the camera stays on the handoff
   *  pose so the card→zone crossfade happens over a still frame; the
   *  pull-back to `fitRect` fires on release, unless the operator has
   *  already taken the camera somewhere else (input always wins). */
  const entryHold = useRef<{
    fitRect: SpatialBoardRect;
    pose: BoardCameraTarget;
  } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const poseFrame = useRef<number | null>(null);

  const projectionScratch = useMemo(() => createBoardProjectionScratch(), []);

  const notifyViewport = useCallback(() => {
    const ortho = cameraRef.current;
    if (!ortho) return;
    ortho.updateMatrixWorld(true);
    const viewport = boardViewportFromCamera(ortho, projectionScratch);
    if (!viewport) return;
    if (process.env.NODE_ENV !== 'production') {
      (
        window as typeof window & {
          __EVAL_BOARD_VIEWPORT__?: OperationsBoardViewport;
        }
      ).__EVAL_BOARD_VIEWPORT__ = viewport;
    }
    onViewportChange?.(viewport);
  }, [onViewportChange, projectionScratch]);

  const applyCamera = useCallback(
    (value: BoardCameraTarget) => {
      const ortho =
        cameraRef.current ?? (get().camera as THREE.OrthographicCamera);
      cameraRef.current = ortho;
      applyBoardCameraTarget(ortho, value);
      onZoomChange?.(value.zoom);
    },
    [get, onZoomChange]
  );

  const snapToTarget = useCallback(() => {
    current.current.x = target.current.x;
    current.current.y = target.current.y;
    current.current.zoom = target.current.zoom;
    current.current.tilt = target.current.tilt;
    applyCamera(current.current);
    notifyViewport();
  }, [applyCamera, notifyViewport]);

  const announceTargetViewport = useCallback(() => {
    notifyViewport();
  }, [notifyViewport]);

  /**
   * Hold a manually requested camera target inside the board's limits, letting
   * it travel a bounded distance past an engaged bound (F3). Applied to
   * operator input only — solved poses (entry, focus, recenter) already frame
   * real geometry, and clamping them would fight the transition owner.
   */
  const constrainTarget = useCallback(() => {
    const bounds = layoutRef.current.bounds;
    if (size.width <= 0 || size.height <= 0) return;
    const limits = boardCameraLimits(
      bounds,
      { width: size.width, height: size.height },
      fitZoom.current,
      target.current
    );
    clampLimits.current = limits;
    const engaged = clampBoardCameraTargetInPlace(
      target.current,
      limits,
      !reduced,
      clampEdges.current
    );
    clampEngaged.current = engaged;
    const key = engaged ? boardClampEdgesKey(clampEdges.current) : '';
    if (key === clampKey.current) return;
    clampKey.current = key;
    onClampEdges?.(engaged ? { ...clampEdges.current } : null);
  }, [onClampEdges, reduced, size.height, size.width]);

  const targetForRect = useCallback(
    (rect: SpatialBoardRect) => {
      const next = fittedBoardCameraTarget(
        rect,
        { width: size.width, height: size.height },
        target.current.tilt
      );
      fitZoom.current = next.zoom;
      target.current.x = next.x;
      target.current.y = next.y;
      target.current.zoom = next.zoom;
      lambda.current = FLIGHT_LAMBDA;
      announceTargetViewport();
    },
    [announceTargetViewport, size.height, size.width]
  );
  const targetForRectRef = useRef(targetForRect);
  targetForRectRef.current = targetForRect;
  const snapToTargetRef = useRef(snapToTarget);
  snapToTargetRef.current = snapToTarget;

  const releaseEntryHold = useCallback(() => {
    const hold = entryHold.current;
    entryHold.current = null;
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (!hold) return;
    const settled = target.current;
    const untouched =
      Math.abs(settled.x - hold.pose.x) < 0.5 &&
      Math.abs(settled.y - hold.pose.y) < 0.5 &&
      Math.abs(settled.zoom - hold.pose.zoom) <
        Math.max(0.01, hold.pose.zoom * 0.02);
    // "Only then does the camera pull back" — but an operator who already
    // moved the camera mid-crossfade is obeyed, never yanked to the fit.
    if (untouched) targetForRect(hold.fitRect);
    invalidate();
  }, [invalidate, targetForRect]);

  /** Claims a pending Team→Fleet snapshot and applies the entry pose. Every
   *  decline dispatches the fallback event so the transition owner cuts —
   *  a normal outcome, not an error. */
  const tryEnterFromHandoff = useCallback((): boolean => {
    const activeLayout = layoutRef.current;
    if (!altitudeHandoffActive()) return false;
    const fallback = () =>
      window.dispatchEvent(new CustomEvent(ALTITUDE_HANDOFF_FALLBACK_EVENT));
    if (projection !== 'top-down' || activeLayout.altitude !== 'fleet') {
      claimAltitudeHandoff(); // consume — this arrival cannot carry position
      fallback();
      return false;
    }
    const snapshot = claimAltitudeHandoff();
    if (!snapshot) {
      fallback(); // stale or viewport-mismatched: the budget was missed
      return false;
    }
    const canvasRect = gl.domElement.getBoundingClientRect();
    // Entry zoom is bounded to [1.06×fit, 2.2×fit]: the small lower inset
    // guarantees a perceptible pull-back even when a new zone shape makes the
    // raw scale solution equal the fit pose, and never lets matched
    // zones land far offscreen — real Team sections dwarf their zones, so an
    // unclamped size match reads as chaos, not carry (Voltaic tuning,
    // 2026-08-02). `targetForRect` has already run, so fitZoom is current.
    const solution = solveEntryPose(
      snapshot,
      activeLayout.zones,
      {
        width: size.width,
        height: size.height,
        left: canvasRect.left,
        top: canvasRect.top,
      },
      { min: fitZoom.current * 1.06, max: fitZoom.current * 2.2 }
    );
    if (!solution) {
      fallback();
      return false;
    }
    const pose: BoardCameraTarget = { ...solution.pose, tilt: 0 };
    target.current = { ...pose };
    current.current = { ...pose };
    applyCamera(current.current);
    notifyViewport();
    entryHold.current = { fitRect: activeLayout.cameraBounds, pose };
    // Announce the pose only after the first PAINTED frame at it (double
    // rAF): the card ghosts then hold still over the renderer swap and the
    // shader-compile stall, and the crossfade plays over a live board. The
    // hold clock starts with the crossfade, not with the claim. If the
    // paint takes longer than the frame budget, the ghost layer's deadline
    // cuts — that is the budget doing its job.
    poseFrame.current = window.requestAnimationFrame(() => {
      poseFrame.current = window.requestAnimationFrame(() => {
        poseFrame.current = null;
        holdTimer.current = window.setTimeout(
          releaseEntryHold,
          ALTITUDE_HANDOFF_HOLD_MS
        );
        window.dispatchEvent(
          new CustomEvent<HandoffPoseDetail>(ALTITUDE_HANDOFF_POSE_EVENT, {
            detail: {
              targets: solution.targets,
              crossfadeMs: ALTITUDE_HANDOFF_CROSSFADE_MS,
            },
          })
        );
      });
    });
    return true;
  }, [
    applyCamera,
    gl,
    notifyViewport,
    projection,
    releaseEntryHold,
    size.height,
    size.width,
  ]);
  const tryEnterFromHandoffRef = useRef(tryEnterFromHandoff);
  tryEnterFromHandoffRef.current = tryEnterFromHandoff;

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
      if (poseFrame.current !== null) {
        window.cancelAnimationFrame(poseFrame.current);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const cameraBounds = {
      x: cameraBoundsX,
      y: cameraBoundsY,
      width: cameraBoundsWidth,
      height: cameraBoundsHeight,
    };
    fitZoom.current = fitBoardZoom(cameraBounds, {
      width: size.width,
      height: size.height,
    });
    if (entryHold.current) {
      // A layout tick during the entry hold must not move the camera; the
      // pull-back targets the freshest fit when the hold releases.
      entryHold.current.fitRect = cameraBounds;
      previousSemanticAddress.current = semanticAddress;
      return;
    }
    if (!initialized.current) {
      targetForRectRef.current(cameraBounds);
      const entered = !reduced && tryEnterFromHandoffRef.current();
      initialized.current = true;
      if (!entered) {
        snapToTargetRef.current();
        // Arrival dolly (V2.4): enter the board slightly wide and ease in, so
        // regime entry reads as descending onto the map instead of a hard cut.
        if (!reduced) {
          current.current.zoom = target.current.zoom * 0.82;
          applyCamera(current.current);
        }
      }
      previousSemanticAddress.current = semanticAddress;
      invalidate();
      return;
    }
    if (previousSemanticAddress.current !== semanticAddress) {
      const next = semanticBoardCameraTarget(target.current, cameraBounds, {
        width: size.width,
        height: size.height,
      });
      target.current.x = next.x;
      target.current.y = next.y;
      target.current.zoom = next.zoom;
      lambda.current = FLIGHT_LAMBDA;
      if (reduced) snapToTargetRef.current();
      invalidate();
    }
    previousSemanticAddress.current = semanticAddress;
  }, [
    applyCamera,
    invalidate,
    cameraBoundsHeight,
    cameraBoundsWidth,
    cameraBoundsX,
    cameraBoundsY,
    reduced,
    semanticAddress,
    size.height,
    size.width,
  ]);

  useEffect(() => {
    target.current.tilt = projection === 'fixed-angle' ? 1 : 0;
    lambda.current = FLIGHT_LAMBDA;
    announceTargetViewport();
    if (reduced) snapToTarget();
    invalidate();
  }, [announceTargetViewport, invalidate, projection, reduced, snapToTarget]);

  // Pointer-specific RTS grammar: mouse/pen primary drag band-selects; touch
  // directly pans unless the explicit touch-select mode is armed. Middle drag,
  // WASD, and trackpad scroll pan; pinch/ctrl-wheel zoom at the cursor.
  useEffect(() => {
    const element = gl.domElement;
    const worldAt = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const ortho = cameraRef.current;
      const projected = ortho
        ? clientPointToBoard(ortho, rect, clientX, clientY, projectionScratch)
        : null;
      if (projected) return projected;
      const zoom = Math.max(effectiveBoardCameraZoom(current.current), 0.001);
      return {
        x: current.current.x + (clientX - rect.left - rect.width / 2) / zoom,
        y: current.current.y + (rect.height / 2 - (clientY - rect.top)) / zoom,
      };
    };
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const touches = new Map<number, { x: number; y: number }>();
    let pinching = false;
    let pinchDistance = 1;
    let pinchZoom = 1;
    let pinchAnchor = { x: 0, y: 0 };
    // Primary drag draws a selection band (V3.3). The
    // overlay div is DOM (pixel-crisp, outside the canvas); its transform is
    // written directly per move — never through React state (guide rule 14).
    let banding = false;
    let bandStartX = 0;
    let bandStartY = 0;
    let bandLastX = 0;
    let bandLastY = 0;
    const positionBandOverlay = (clientX: number, clientY: number) => {
      const overlay = bandOverlayRef?.current;
      if (!overlay) return;
      const rect = element.getBoundingClientRect();
      const left = Math.min(bandStartX, clientX) - rect.left;
      const top = Math.min(bandStartY, clientY) - rect.top;
      overlay.style.display = 'block';
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${Math.abs(clientX - bandStartX)}px`;
      overlay.style.height = `${Math.abs(clientY - bandStartY)}px`;
    };
    const hideBandOverlay = () => {
      const overlay = bandOverlayRef?.current;
      if (overlay) overlay.style.display = 'none';
    };
    const beginPinch = () => {
      const points = [...touches.values()];
      if (points.length < 2) return;
      const first = points[0]!;
      const second = points[1]!;
      pinching = true;
      dragging = false;
      banding = false;
      hideBandOverlay();
      pinchDistance = Math.max(
        1,
        Math.hypot(second.x - first.x, second.y - first.y)
      );
      pinchZoom = target.current.zoom;
      pinchAnchor = worldAt((first.x + second.x) / 2, (first.y + second.y) / 2);
      onManualCameraInput?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      const action = boardPointerAction({
        pointerType: event.pointerType,
        button: event.button,
        touchSelectionMode,
        canBandSelect: Boolean(onBandSelect),
      });
      if (action === 'ignore') return;
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        element.setPointerCapture(event.pointerId);
        if (touches.size === 2) {
          beginPinch();
          return;
        }
      }
      if (action === 'band') {
        banding = true;
        bandStartX = event.clientX;
        bandStartY = event.clientY;
        bandLastX = event.clientX;
        bandLastY = event.clientY;
        element.setPointerCapture(event.pointerId);
        return;
      }
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      element.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && touches.has(event.pointerId)) {
        touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (touches.size >= 2) {
          const points = [...touches.values()];
          const first = points[0]!;
          const second = points[1]!;
          const distance = Math.max(
            1,
            Math.hypot(second.x - first.x, second.y - first.y)
          );
          const nextZoom = pinchZoomTarget(pinchZoom, pinchDistance, distance);
          const ratio = target.current.zoom / Math.max(nextZoom, 0.001);
          target.current.x =
            pinchAnchor.x - (pinchAnchor.x - target.current.x) * ratio;
          target.current.y =
            pinchAnchor.y - (pinchAnchor.y - target.current.y) * ratio;
          target.current.zoom = nextZoom;
          constrainTarget();
          lambda.current = NUDGE_LAMBDA;
          if (reduced) snapToTarget();
          invalidate();
          return;
        }
      }
      if (banding) {
        bandLastX = event.clientX;
        bandLastY = event.clientY;
        positionBandOverlay(event.clientX, event.clientY);
        return;
      }
      if (!dragging) return;
      const zoom = Math.max(effectiveBoardCameraZoom(current.current), 0.001);
      target.current.x -= (event.clientX - lastX) / zoom;
      target.current.y += (event.clientY - lastY) / zoom;
      constrainTarget();
      lastX = event.clientX;
      lastY = event.clientY;
      lambda.current = NUDGE_LAMBDA;
      element.style.cursor = 'grabbing';
      onManualCameraInput?.();
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    const endDrag = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touches.delete(event.pointerId);
        if (pinching) {
          pinching = touches.size >= 2;
          dragging = false;
          banding = false;
          hideBandOverlay();
          if (element.hasPointerCapture(event.pointerId)) {
            element.releasePointerCapture(event.pointerId);
          }
          return;
        }
      }
      if (banding) {
        banding = false;
        hideBandOverlay();
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        const endX = event.pointerType === 'touch' ? bandLastX : event.clientX;
        const endY = event.pointerType === 'touch' ? bandLastY : event.clientY;
        const moved =
          Math.abs(endX - bandStartX) >= 4 || Math.abs(endY - bandStartY) >= 4;
        // A still click falls through to the piece/zone handlers.
        if (!moved || !onBandSelect) return;
        const from = worldAt(bandStartX, bandStartY);
        const to = worldAt(endX, endY);
        // World y is up; layout rects are y-down.
        onBandSelect({
          x: Math.min(from.x, to.x),
          y: Math.min(-from.y, -to.y),
          width: Math.abs(to.x - from.x),
          height: Math.abs(to.y - from.y),
        });
        if (suppressMissRef) suppressMissRef.current = performance.now();
        return;
      }
      if (!dragging) return;
      dragging = false;
      element.style.cursor = '';
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const zoom = Math.max(current.current.zoom, 0.001);
      if (event.ctrlKey || event.metaKey) {
        const anchor = worldAt(event.clientX, event.clientY);
        const nextZoom = target.current.zoom * Math.exp(-event.deltaY * 0.012);
        const ratio = target.current.zoom / Math.max(nextZoom, 0.001);
        target.current.x = anchor.x - (anchor.x - target.current.x) * ratio;
        target.current.y = anchor.y - (anchor.y - target.current.y) * ratio;
        target.current.zoom = nextZoom;
      } else {
        target.current.x += event.deltaX / zoom;
        target.current.y -= event.deltaY / zoom;
      }
      constrainTarget();
      lambda.current = NUDGE_LAMBDA;
      onManualCameraInput?.();
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', endDrag);
    element.addEventListener('pointercancel', endDrag);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', endDrag);
      element.removeEventListener('pointercancel', endDrag);
      element.removeEventListener('wheel', onWheel);
    };
  }, [
    announceTargetViewport,
    bandOverlayRef,
    constrainTarget,
    gl,
    invalidate,
    onBandSelect,
    onManualCameraInput,
    projectionScratch,
    reduced,
    snapToTarget,
    suppressMissRef,
    touchSelectionMode,
  ]);

  useEffect(() => {
    const span = () => Math.max(layout.bounds.width, layout.bounds.height, 24);
    const focusRect = (rect: SpatialBoardRect) => {
      targetForRect(rect);
      if (reduced) snapToTarget();
      invalidate();
    };
    const cameraChanged = (manual = true) => {
      lambda.current = NUDGE_LAMBDA;
      if (manual) onManualCameraInput?.();
      announceTargetViewport();
      if (reduced) snapToTarget();
      invalidate();
    };
    controllerRef.current = {
      recenter() {
        focusRect(layout.cameraBounds);
      },
      restoreViewport(viewport) {
        target.current.x = viewport.centerX;
        target.current.y = -viewport.centerY;
        target.current.zoom = Math.max(
          0.001,
          Math.min(size.width / viewport.width, size.height / viewport.height)
        );
        // A viewport remembered against a different fleet shape can sit far
        // outside today's board; restoring it must land inside the limits
        // rather than resuming the session lost in empty space.
        constrainTarget();
        cameraChanged(false);
      },
      focusProject(projectId) {
        const zone = layout.zones.find(entry => entry.id === projectId);
        if (!zone) return;
        const next = semanticBoardCameraTarget(target.current, zone.rect, {
          width: size.width,
          height: size.height,
        });
        target.current.x = next.x;
        target.current.y = next.y;
        target.current.zoom = next.zoom;
        lambda.current = FLIGHT_LAMBDA;
        if (reduced) snapToTarget();
        invalidate();
      },
      focusAgent(agentId, force = false) {
        const piece = layout.pieces.find(entry => entry.agentId === agentId);
        if (!piece) return;
        // Direct selection owns the camera from this instant. If an altitude
        // flight was still finishing, keep the zoom currently on screen so an
        // Arrow press can never inherit a delayed dolly or appear to refit.
        target.current.zoom = current.current.zoom;
        if (!followSelection && !force) {
          lambda.current = FOLLOW_LAMBDA;
          if (reduced) snapToTarget();
          invalidate();
          return;
        }
        const next = softFollowBoardPoint(
          target.current,
          { x: piece.x, y: -piece.y },
          { width: size.width, height: size.height }
        );
        target.current.x = next.x;
        target.current.y = next.y;
        lambda.current = FOLLOW_LAMBDA;
        if (reduced) snapToTarget();
        invalidate();
      },
      enterSession(agentId) {
        const piece = layout.pieces.find(entry => entry.agentId === agentId);
        if (!piece) return;
        // The altitude effect owns the one bounded semantic zoom. Session
        // entry only composes its Agent inside the safe zone; a second tight
        // refit would make Agent altitude feel like a disconnected map.
        const next = softFollowBoardPoint(
          target.current,
          { x: piece.x, y: -piece.y },
          { width: size.width, height: size.height }
        );
        target.current.x = next.x;
        target.current.y = next.y;
        lambda.current = FLIGHT_LAMBDA;
        if (reduced) snapToTarget();
        invalidate();
      },
      zoom(steps) {
        target.current.zoom *= Math.exp(steps * 0.18);
        constrainTarget();
        cameraChanged();
      },
      pan(dx, dy) {
        target.current.x += dx * span();
        target.current.y -= dy * span();
        constrainTarget();
        cameraChanged();
      },
      nudge(dx, dy, dollySteps) {
        target.current.x += dx * span();
        target.current.y -= dy * span();
        if (dollySteps) target.current.zoom *= Math.exp(dollySteps * 1.7);
        constrainTarget();
        cameraChanged();
      },
    };
    return () => {
      controllerRef.current = null;
    };
  }, [
    announceTargetViewport,
    constrainTarget,
    controllerRef,
    invalidate,
    layout.bounds.height,
    layout.bounds.width,
    layout.cameraBounds,
    layout.pieces,
    layout.zones,
    followSelection,
    onManualCameraInput,
    reduced,
    size.height,
    size.width,
    snapToTarget,
    targetForRect,
  ]);

  useFrame((state, delta) => {
    if (reduced) return;
    const ortho =
      cameraRef.current ?? (state.camera as THREE.OrthographicCamera);
    cameraRef.current = ortho;
    // Rubber band (F3): a target pushed past a bound returns to it. Gated on
    // an actually engaged clamp so a solved focus/entry pose is never dragged.
    let relaxing = false;
    if (clampEngaged.current && clampLimits.current) {
      relaxing = relaxBoardCameraTargetInPlace(
        target.current,
        clampLimits.current,
        Math.min(delta, 0.05)
      );
      if (!relaxing) {
        clampEngaged.current = false;
        if (clampKey.current !== '') {
          clampKey.current = '';
          onClampEdges?.(null);
        }
      }
    }
    const speed = lambda.current;
    const nextX = THREE.MathUtils.damp(
      current.current.x,
      target.current.x,
      speed,
      delta
    );
    const nextY = THREE.MathUtils.damp(
      current.current.y,
      target.current.y,
      speed,
      delta
    );
    const nextZoom = THREE.MathUtils.damp(
      current.current.zoom,
      target.current.zoom,
      speed,
      delta
    );
    const nextTilt = THREE.MathUtils.damp(
      current.current.tilt,
      target.current.tilt,
      speed,
      delta
    );
    const moving =
      Math.abs(nextX - target.current.x) > 0.001 ||
      Math.abs(nextY - target.current.y) > 0.001 ||
      Math.abs(nextZoom - target.current.zoom) > 0.001 ||
      Math.abs(nextTilt - target.current.tilt) > 0.001;
    current.current.x = moving ? nextX : target.current.x;
    current.current.y = moving ? nextY : target.current.y;
    current.current.zoom = moving ? nextZoom : target.current.zoom;
    current.current.tilt = moving ? nextTilt : target.current.tilt;
    applyCamera(current.current);
    notifyViewport();
    if (moving || relaxing) state.invalidate();
  });

  return null;
}

function gridGeometry(
  bounds: SpatialBoardRect,
  step: number,
  major: boolean,
  theme: SpatialThemeSnapshot
): THREE.BufferGeometry {
  const margin = 30;
  const minX = Math.floor((bounds.x - margin) / step) * step;
  const maxX = Math.ceil((bounds.x + bounds.width + margin) / step) * step;
  const minY = Math.floor((bounds.y - margin) / step) * step;
  const maxY = Math.ceil((bounds.y + bounds.height + margin) / step) * step;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const maxRadius = Math.max(Math.hypot(maxX - centerX, maxY - centerY), 1);
  const base = new THREE.Color(major ? theme.gridMajor : theme.grid);
  const points: number[] = [];
  const colors: number[] = [];
  const scratch = new THREE.Color();
  const SEGMENT = step * 5;
  // Segmented lines with vertex colors: brightness falls off radially from
  // the board center so the grid melts into the dark instead of ending at a
  // hard rectangle. (lineBasicMaterial has no per-vertex alpha; a color fade
  // into the near-black background is visually identical.)
  const pushPoint = (x: number, y: number) => {
    points.push(x, -y, -1);
    const falloff = Math.max(
      0,
      1 - Math.hypot(x - centerX, y - centerY) / maxRadius
    );
    scratch.copy(base).multiplyScalar(0.18 + 0.82 * falloff * falloff);
    colors.push(scratch.r, scratch.g, scratch.b);
  };
  for (let x = minX; x <= maxX; x += step) {
    const index = Math.round(x / step);
    if ((index % 5 === 0) !== major) continue;
    for (let y = minY; y < maxY; y += SEGMENT) {
      pushPoint(x, y);
      pushPoint(x, Math.min(y + SEGMENT, maxY));
    }
  }
  for (let y = minY; y <= maxY; y += step) {
    const index = Math.round(y / step);
    if ((index % 5 === 0) !== major) continue;
    for (let x = minX; x < maxX; x += SEGMENT) {
      pushPoint(x, y);
      pushPoint(Math.min(x + SEGMENT, maxX), y);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(points, 3)
  );
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function BoardGrid({
  bounds,
  theme,
}: {
  bounds: SpatialBoardRect;
  theme: SpatialThemeSnapshot;
}) {
  const minor = useMemo(
    () => gridGeometry(bounds, 2, false, theme),
    [bounds, theme]
  );
  const major = useMemo(
    () => gridGeometry(bounds, 2, true, theme),
    [bounds, theme]
  );
  useEffect(
    () => () => {
      minor.dispose();
      major.dispose();
    },
    [major, minor]
  );
  return (
    <>
      <lineSegments geometry={minor} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.6} />
      </lineSegments>
      <lineSegments geometry={major} raycast={() => null}>
        <lineBasicMaterial vertexColors transparent opacity={0.78} />
      </lineSegments>
    </>
  );
}

/** All circular Project edges in ONE Line2 draw: per-vertex accent colors carry each
 *  Project's hue, while selection replaces identity with the theme's
 *  selection role. Concrete sRGB values enter Three's color-managed working
 *  space once. */
function ZoneEdges({
  zones,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  theme: SpatialThemeSnapshot;
}) {
  const { points, colors } = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const colors: THREE.Color[] = [];
    for (const zone of zones) {
      const accent = new THREE.Color(
        zone.selected
          ? theme.selection
          : spatialProjectIdentityColor(theme, zone.id)
      );
      const center = rectCenter(zone.rect);
      const z = 0.35;
      const segments = 64;
      for (let edge = 0; edge < segments; edge += 1) {
        const from = (edge / segments) * Math.PI * 2;
        const to = ((edge + 1) / segments) * Math.PI * 2;
        points.push(
          [
            center.x + Math.cos(from) * zone.radius,
            center.y + Math.sin(from) * zone.radius,
            z,
          ],
          [
            center.x + Math.cos(to) * zone.radius,
            center.y + Math.sin(to) * zone.radius,
            z,
          ]
        );
        colors.push(accent, accent);
      }
    }
    return { points, colors };
  }, [theme, zones]);
  if (points.length === 0) return null;
  return (
    <Line
      points={points}
      vertexColors={colors}
      segments
      lineWidth={1.4}
      toneMapped={false}
      transparent
      opacity={1}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

/** Mount-keyed entrance: zones fade up quickly; the parent keys this layer
 *  by semantic address so descent/ascent re-choreographs (never data ticks). */
function ZoneLayer({
  zones,
  reduced,
  onDrillProject,
  onToggleZoneSelect,
  onHover,
  hoveredId,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  reduced: boolean;
  onDrillProject: (projectId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  onHover: (zoneId: string | null) => void;
  hoveredId: string | null;
  theme: SpatialThemeSnapshot;
}) {
  const materialRef = useRef<THREE.MeshLambertMaterial>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const geometry = useMemo(() => {
    const next = new THREE.CylinderGeometry(0.5, 0.5, 1, 64);
    next.rotateX(Math.PI / 2);
    return next;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useCursor(hoveredId != null);
  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    if (entrance.current >= 1) {
      material.opacity = 1;
      return;
    }
    entrance.current = Math.min(
      1,
      entrance.current + Math.min(delta, 0.05) * 4
    );
    material.opacity = entrance.current;
    state.invalidate();
  });
  return (
    <>
      <Instances geometry={geometry} limit={32} range={zones.length}>
        <meshLambertMaterial
          ref={materialRef}
          transparent
          opacity={reduced ? 1 : 0}
        />
        {zones.map(zone => {
          const center = rectCenter(zone.rect);
          const interactive = !zone.isAggregate;
          return (
            <Instance
              key={zone.id}
              position={[center.x, center.y, 0]}
              scale={[zone.rect.width, zone.rect.height, 0.62]}
              color={
                hoveredId === zone.id
                  ? theme.zoneHover
                  : spatialProjectZoneFill(theme, zone.id)
              }
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                onHover(zone.id);
              }}
              onPointerOut={() => onHover(null)}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!interactive || event.delta > 5) return;
                event.stopPropagation();
                // Shift-click toggles the zone's Agents in the multi-selection
                // (V3.2) — the same verb the zone's DOM control carries.
                if (event.shiftKey && onToggleZoneSelect) {
                  onToggleZoneSelect(zone.id);
                } else {
                  onDrillProject(zone.id);
                }
              }}
            />
          );
        })}
      </Instances>
      <ZoneEdges zones={zones} theme={theme} />
    </>
  );
}

function ProjectHealthRail({
  zone,
  theme,
}: {
  zone: SpatialBoardProjectZone;
  theme: SpatialThemeSnapshot;
}) {
  const total = Math.max(zone.agentCount, 1);
  const segments: Array<[StatusLightState, number]> = [
    ['active', zone.statusCounts.working + zone.statusCounts.reviewing],
    ['needs-you', zone.statusCounts.blocked],
    ['fault', zone.statusCounts.error],
    ['result', zone.statusCounts.complete],
    ['off', zone.statusCounts.idle],
  ];
  return (
    <span
      className="mt-1 flex h-[3px] w-full overflow-hidden"
      style={{ background: spatialColorWithAlpha(theme.unitMuted, 0.28) }}
    >
      {segments.map(([status, count]) =>
        count > 0 ? (
          <span
            key={status}
            style={{
              width: `${(count / total) * 100}%`,
              background: theme.status[status],
            }}
          />
        ) : null
      )}
    </span>
  );
}

function DampedHtmlAnchor({
  position,
  reduced,
  center = false,
  children,
}: {
  position: [number, number, number];
  reduced: boolean;
  center?: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const initial = useRef(position);
  const target = useRef(position);
  target.current = position;
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    if (!reduced || !group.current) return;
    group.current.position.set(...position);
    invalidate();
  }, [invalidate, position, reduced]);
  useFrame((state, delta) => {
    const node = group.current;
    if (!node || reduced) return;
    const nextX = THREE.MathUtils.damp(
      node.position.x,
      target.current[0],
      7.5,
      delta
    );
    const nextY = THREE.MathUtils.damp(
      node.position.y,
      target.current[1],
      7.5,
      delta
    );
    const nextZ = THREE.MathUtils.damp(
      node.position.z,
      target.current[2],
      7.5,
      delta
    );
    const moving =
      Math.abs(nextX - target.current[0]) > 0.001 ||
      Math.abs(nextY - target.current[1]) > 0.001 ||
      Math.abs(nextZ - target.current[2]) > 0.001;
    node.position.set(
      moving ? nextX : target.current[0],
      moving ? nextY : target.current[1],
      moving ? nextZ : target.current[2]
    );
    if (moving) state.invalidate();
  });
  return (
    <group ref={group} position={initial.current}>
      <Html center={center} style={{ pointerEvents: 'auto' }}>
        {children}
      </Html>
    </group>
  );
}

/** Zone-label budget (V3.1): full cards only when the zone's projected size
 *  can afford them; below that a one-line chip keeps identity, count, and the
 *  drill affordance while the population field stays visible. */
export type ZoneLabelTier = 'full' | 'compact';

/** "12%" / "<1%" — the zone control is the exact-figure owner while the dot
 *  field speaks in color. */
function burnShareCopy(share: number): string {
  const pct = Math.round(share * 100);
  return pct < 1 ? '<1%' : `${pct}%`;
}

function ProjectControls({
  zones,
  altitude,
  focusedProjectId,
  labelTier,
  reduced,
  lens,
  onDrillProject,
  onToggleZoneSelect,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  labelTier: ZoneLabelTier;
  reduced: boolean;
  lens: SpatialBoardLens;
  onDrillProject: (projectId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  theme: SpatialThemeSnapshot;
}) {
  return zones.map(zone => {
    // The zone control is the focusable DOM equivalent of the zone plate, so
    // it carries both verbs: activate opens, shift-activate (pointer or
    // keyboard — synthesized clicks keep modifier state) toggles selection.
    const activateZone = (event: { shiftKey: boolean }) => {
      if (event.shiftKey && onToggleZoneSelect) onToggleZoneSelect(zone.id);
      else onDrillProject(zone.id);
    };
    const position: [number, number, number] = [
      zone.rect.x + zone.radius * 0.28,
      -(zone.rect.y + 1.25),
      0.8,
    ];
    const accent = spatialProjectIdentityColor(theme, zone.id);
    const compact =
      labelTier === 'compact' ||
      (altitude !== 'fleet' && zone.id !== focusedProjectId);
    if (compact) {
      const compactContent = (
        <span className="flex items-baseline gap-2">
          <span
            className="max-w-[7.5rem] truncate text-chrome-micro font-semibold tracking-[-0.01em]"
            style={{ color: theme.label }}
          >
            {zone.label}
          </span>
          <span
            className="font-mono text-chrome-nano tabular-nums"
            style={{ color: theme.labelMuted }}
          >
            {zone.agentCount}
          </span>
          {zone.blockedCount > 0 && (
            <span
              className="font-mono text-chrome-nano tabular-nums"
              style={{ color: theme.status['needs-you'] }}
            >
              {zone.blockedCount}!
            </span>
          )}
          {lens === 'burn' && zone.burn && (
            <span
              className="font-mono text-chrome-nano tabular-nums"
              style={{
                color: spatialPressureColor(theme, zone.burn.intensity),
              }}
              title={`${burnShareCopy(zone.burn.share)} of the fleet's normalized token burn`}
            >
              {burnShareCopy(zone.burn.share)}
            </span>
          )}
        </span>
      );
      return (
        <DampedHtmlAnchor key={zone.id} position={position} reduced={reduced}>
          {!zone.isAggregate ? (
            <button
              type="button"
              data-board-zone={zone.id}
              aria-current={zone.selected ? 'true' : undefined}
              aria-label={`Open Project ${zone.label}`}
              onClick={activateZone}
              style={{
                borderColor: accent,
                color: theme.label,
                boxShadow: `0 8px 22px ${theme.shadow}`,
              }}
              className="exa-material-chrome board-control-enter border px-1.5 py-0.5 text-left outline-none transition-[border-color,background-color] duration-150 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {compactContent}
            </button>
          ) : (
            <div
              style={{
                borderColor: accent,
                color: theme.label,
                boxShadow: `0 8px 22px ${theme.shadow}`,
              }}
              className="exa-material-chrome board-control-enter border px-1.5 py-0.5 text-left"
            >
              {compactContent}
            </div>
          )}
        </DampedHtmlAnchor>
      );
    }
    const content = (
      <>
        <span className="flex items-baseline justify-between gap-3">
          <span
            className="max-w-[9.5rem] truncate text-chrome-meta font-semibold tracking-[-0.01em]"
            style={{ color: theme.label }}
          >
            {zone.label}
          </span>
          <span
            className="font-mono text-chrome-nano tabular-nums"
            style={{ color: theme.labelMuted }}
          >
            {zone.agentCount}A
          </span>
        </span>
        <span
          className="mt-0.5 flex gap-2 font-mono text-chrome-nano tabular-nums"
          style={{ color: theme.labelMuted }}
        >
          <span>
            {zone.agentCount === 0
              ? 'No agents yet'
              : `${zone.activeCount} active`}
          </span>
          {zone.blockedCount > 0 && (
            <span style={{ color: theme.status['needs-you'] }}>
              {zone.blockedCount} blocked
            </span>
          )}
          {lens === 'burn' &&
            (zone.burn ? (
              <span
                style={{
                  color: spatialPressureColor(theme, zone.burn.intensity),
                }}
                title={`${burnShareCopy(zone.burn.share)} of the fleet's normalized token burn`}
              >
                {burnShareCopy(zone.burn.share)} of burn
              </span>
            ) : (
              <span style={{ color: theme.consumption.unknown }}>
                usage unreported
              </span>
            ))}
        </span>
        <ProjectHealthRail zone={zone} theme={theme} />
      </>
    );
    return (
      <DampedHtmlAnchor key={zone.id} position={position} reduced={reduced}>
        {!zone.isAggregate ? (
          <button
            type="button"
            data-board-zone={zone.id}
            aria-current={zone.selected ? 'true' : undefined}
            aria-label={`Open Project ${zone.label}`}
            onClick={activateZone}
            style={{
              borderColor: accent,
              color: theme.label,
              boxShadow: `0 8px 22px ${theme.shadow}`,
            }}
            className="exa-material-chrome board-control-enter w-44 border px-2.5 py-2 text-left outline-none transition-[border-color,background-color,transform] duration-150 hover:brightness-105 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
          >
            {content}
          </button>
        ) : (
          <div
            style={{
              borderColor: accent,
              color: theme.label,
              boxShadow: `0 8px 22px ${theme.shadow}`,
            }}
            className="exa-material-chrome board-control-enter w-44 border px-2.5 py-2 text-left"
          >
            {content}
          </div>
        )}
      </DampedHtmlAnchor>
    );
  });
}

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

/**
 * Batched spatial sibling of the DOM StatusLight. Project identity stays on
 * zone edges; every Agent piece carries one exact protocol color and shape.
 * Only Active rotors invalidate the demand loop, at the shared DOM cadence.
 */
/**
 * Delegated children as board units (ENG-004 V3.4 / ENG-023 D3c). D3b drew one
 * punctuation-sized dot per child; operator dogfood found that four real
 * subagents then read as four specks above one large parent, conveying neither
 * fan-out nor that several Agents are doing the work.
 *
 * Children are now the same beveled hex noun as their parent at the pure
 * model's ratio, connected by a hairline Project-identity tether. All slot
 * geometry, the overflow boundary, and the lineage endpoints come from
 * `selectSpatialDelegationUnits`; this layer is a damped executor that owns
 * only material and the finite spawn/stop transitions.
 *
 * Two instanced draws for the whole board (bodies, tethers). Tethers are
 * transform-driven quads rather than lines so their endpoints can animate
 * every frame without rebuilding geometry.
 */
const DELEGATION_MOTION = {
  /** Critically damped settle, no bounce (D3c brief: 450–650ms). */
  spawnSeconds: 0.55,
  /** The exit finishes faster than the entrance (240–320ms). */
  stopSeconds: 0.28,
  staggerSeconds: 0.055,
  maxStaggerSeconds: 0.33,
  /** Per-piece mark cap × the project-altitude piece budget, with headroom:
   *  drei silently no-ops writes past `limit`, so a full fan-out team must
   *  never be able to reach it. */
  instanceLimit: 640,
} as const;

/** Identity rim scale relative to the child body — a hairline halo, not a ring. */
const DELEGATION_RIM_SCALE = 1.08;

interface DelegationMotionRecord {
  progress: number;
  delay: number;
  parentX: number;
  parentY: number;
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

/**
 * Units whose parent stopped reporting them, retained just long enough to
 * retract along their tether. Kept in React state (never set from `useFrame`);
 * the frame loop only mutates transforms.
 */
function useDelegationExits(
  units: SpatialBoardDelegationUnit[],
  reduced: boolean
): SpatialBoardDelegationUnit[] {
  const [exits, setExits] = useState<SpatialBoardDelegationUnit[]>([]);
  const previous = useRef<SpatialBoardDelegationUnit[]>([]);
  const timers = useRef<number[]>([]);
  useLayoutEffect(() => {
    const liveIds = new Set(units.map(unit => unit.id));
    const departed = previous.current.filter(unit => !liveIds.has(unit.id));
    previous.current = units;
    // Reduced motion keeps identical topology and census with no travel, so a
    // departure is simply gone on the next frame.
    if (reduced) {
      setExits(current => (current.length === 0 ? current : []));
      return;
    }
    setExits(current => {
      const kept = current.filter(unit => !liveIds.has(unit.id));
      const known = new Set(kept.map(unit => unit.id));
      const added = departed.filter(unit => !known.has(unit.id));
      if (added.length === 0 && kept.length === current.length) return current;
      return [...kept, ...added];
    });
    if (departed.length === 0) return;
    const timer = window.setTimeout(
      () => {
        const goneIds = new Set(departed.map(unit => unit.id));
        setExits(current => current.filter(unit => !goneIds.has(unit.id)));
      },
      DELEGATION_MOTION.stopSeconds * 1000 + 60
    );
    timers.current.push(timer);
  }, [reduced, units]);
  useEffect(
    () => () => {
      for (const timer of timers.current) window.clearTimeout(timer);
      timers.current = [];
    },
    []
  );
  return exits;
}

function DelegationUnitLayer({
  units,
  reduced,
  theme,
}: {
  units: SpatialBoardDelegationUnit[];
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const invalidate = useThree(state => state.invalidate);
  const exits = useDelegationExits(units, reduced);
  const bodyRefs = useRef(new Map<string, THREE.Object3D>());
  const rimRefs = useRef(new Map<string, THREE.Object3D>());
  const tetherRefs = useRef(new Map<string, THREE.Object3D>());
  const motion = useRef(new Map<string, DelegationMotionRecord>());
  const pieceGeometry = useMemo(() => {
    // The same noun as an Agent unit, one size down — the family match is the
    // whole point of the milestone, so the geometry is deliberately identical.
    const geometry = new THREE.CylinderGeometry(0.5, 0.56, 0.34, 6);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, []);
  const tetherGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(
    () => () => {
      pieceGeometry.dispose();
      tetherGeometry.dispose();
    },
    [pieceGeometry, tetherGeometry]
  );

  const rendered = useMemo(
    () => [
      ...units.map(unit => ({ unit, exiting: false })),
      ...exits.map(unit => ({ unit, exiting: true })),
    ],
    [exits, units]
  );

  // Seed lifecycle records for arrivals. A sibling that was already live keeps
  // its slot and its progress: a spawn moves the new unit, never the family.
  useLayoutEffect(() => {
    const seen = new Set<string>();
    const perParent = new Map<string, number>();
    for (const { unit, exiting } of rendered) {
      seen.add(unit.id);
      if (motion.current.has(unit.id)) continue;
      const index = perParent.get(unit.parentPieceId) ?? 0;
      perParent.set(unit.parentPieceId, index + 1);
      const record: DelegationMotionRecord = {
        progress: reduced || exiting ? 1 : 0,
        delay: reduced
          ? 0
          : Math.min(
              index * DELEGATION_MOTION.staggerSeconds,
              DELEGATION_MOTION.maxStaggerSeconds
            ),
        // The child emerges from, and retracts to, its parent's centre; the
        // tether endpoints in the model give it its resting geometry.
        parentX: unit.tether.x1,
        parentY: unit.tether.y1,
      };
      motion.current.set(unit.id, record);
    }
    for (const id of [...motion.current.keys()]) {
      if (!seen.has(id)) motion.current.delete(id);
    }
    invalidate();
  }, [invalidate, reduced, rendered]);

  useFrame((state, delta) => {
    if (rendered.length === 0) return;
    const dt = Math.min(delta, 0.05);
    let animating = false;
    for (const { unit, exiting } of rendered) {
      const record = motion.current.get(unit.id);
      const body = bodyRefs.current.get(unit.id);
      const rim = rimRefs.current.get(unit.id);
      const tether = tetherRefs.current.get(unit.id);
      if (!record || !body) continue;
      if (reduced) record.progress = exiting ? 0 : 1;
      else if (exiting) {
        record.progress = Math.max(
          0,
          record.progress - dt / DELEGATION_MOTION.stopSeconds
        );
        if (record.progress > 0) animating = true;
      } else if (record.delay > 0) {
        record.delay = Math.max(0, record.delay - dt);
        animating = true;
      } else if (record.progress < 1) {
        record.progress = Math.min(
          1,
          record.progress + dt / DELEGATION_MOTION.spawnSeconds
        );
        animating = true;
      }
      const eased = easeOutCubic(record.progress);
      const x = THREE.MathUtils.lerp(record.parentX, unit.x, eased);
      const layoutY = THREE.MathUtils.lerp(record.parentY, unit.y, eased);
      const scale = unit.size * (0.18 + 0.82 * eased);
      body.position.set(x, -layoutY, 0.72);
      body.scale.set(scale, scale, 1);
      if (rim) {
        rim.position.set(x, -layoutY, 0.7);
        rim.scale.set(scale * DELEGATION_RIM_SCALE, scale * DELEGATION_RIM_SCALE, 1);
      }
      if (tether) {
        // The tether establishes and retracts with the unit it explains.
        const dx = x - unit.tether.x1;
        const dy = -layoutY - -unit.tether.y1;
        const length = Math.hypot(dx, dy);
        tether.position.set(
          (unit.tether.x1 + x) / 2,
          (-unit.tether.y1 + -layoutY) / 2,
          0.55
        );
        tether.rotation.set(0, 0, Math.atan2(dy, dx));
        tether.scale.set(length, Math.max(unit.size * 0.045, 0.012), 1);
      }
    }
    if (animating) state.invalidate();
  });

  if (rendered.length === 0) return null;
  return (
    <group>
      <Instances
        geometry={tetherGeometry}
        limit={DELEGATION_MOTION.instanceLimit}
        range={rendered.length}
        renderOrder={1}
        frustumCulled={false}
      >
        <meshBasicMaterial
          toneMapped={false}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
        {rendered.map(({ unit }) => (
          <Instance
            key={`tether:${unit.id}`}
            ref={(instance: THREE.Object3D | null) => {
              if (instance) tetherRefs.current.set(unit.id, instance);
              else tetherRefs.current.delete(unit.id);
            }}
            scale={[0, 0, 1]}
            color={spatialProjectIdentityColor(theme, unit.projectId)}
            raycast={noopRaycast}
          />
        ))}
      </Instances>
      {/* Identity rim: the unit body stays the shared dark `theme.unit` noun,
          so without this a child hex is a near-black shape on a dark zone. The
          rim is the Project-identity channel the D3c brief assigns to lineage —
          it makes the worker legible without inventing a status color. */}
      <Instances
        geometry={pieceGeometry}
        limit={DELEGATION_MOTION.instanceLimit}
        range={rendered.length}
        renderOrder={1}
        frustumCulled={false}
      >
        <meshBasicMaterial toneMapped={false} transparent opacity={0.34} />
        {rendered.map(({ unit }) => (
          <Instance
            key={`rim:${unit.id}`}
            ref={(instance: THREE.Object3D | null) => {
              if (instance) rimRefs.current.set(unit.id, instance);
              else rimRefs.current.delete(unit.id);
            }}
            scale={[0, 0, 1]}
            color={spatialProjectIdentityColor(theme, unit.projectId)}
            raycast={noopRaycast}
          />
        ))}
      </Instances>
      <Instances
        geometry={pieceGeometry}
        limit={DELEGATION_MOTION.instanceLimit}
        range={rendered.length}
        renderOrder={2}
        frustumCulled={false}
      >
        <meshLambertMaterial />
        {rendered.map(({ unit }) => (
          <Instance
            key={`unit:${unit.id}`}
            ref={(instance: THREE.Object3D | null) => {
              if (instance) bodyRefs.current.set(unit.id, instance);
              else bodyRefs.current.delete(unit.id);
            }}
            scale={[0, 0, 1]}
            color={theme.unit}
            raycast={noopRaycast}
          />
        ))}
      </Instances>
    </group>
  );
}

function StatusMarkLayer({
  pieces,
  active,
  lens,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  active: boolean;
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
}) {
  const rotorRefs = useRef(new Map<string, THREE.Object3D>());
  const agentPieces = pieces.filter(piece => piece.kind === 'agent');
  const byState = (state: StatusLightState) =>
    agentPieces.filter(
      piece => statusLightStateForAgentStatus(piece.status) === state
    );
  const off = byState('off');
  const rotating = byState('active');
  const result = byState('result');
  const needsYou = byState('needs-you');
  const fault = byState('fault');
  const signalDisks = [...result, ...needsYou, ...fault];
  const geometries = useMemo(
    () => ({
      backing: new THREE.CircleGeometry(0.34, 32),
      ring: new THREE.RingGeometry(0.18, 0.28, 32),
      offSegment: new THREE.RingGeometry(0.21, 0.27, 8, 1, 0, Math.PI / 4),
      rotor: new THREE.CircleGeometry(0.2, 24, -Math.PI / 2, Math.PI),
      signal: new THREE.CircleGeometry(0.28, 28),
      check: checkGeometry(),
      dot: new THREE.CircleGeometry(0.07, 16),
      cross: crossGeometry(),
    }),
    []
  );
  useEffect(
    () => () => {
      for (const geometry of Object.values(geometries)) geometry.dispose();
    },
    [geometries]
  );

  useFrame((state, delta) => {
    if (rotorRefs.current.size === 0) return;
    if (!active) {
      for (const rotor of rotorRefs.current.values()) rotor.rotation.z = 0;
      return;
    }
    const step =
      (Math.min(delta, 0.05) * Math.PI * 2) /
      STATUS_LIGHT_ACTIVE_ROTATION_SECONDS;
    for (const rotor of rotorRefs.current.values()) {
      rotor.rotation.z = (rotor.rotation.z - step) % (Math.PI * 2);
    }
    state.invalidate();
  });

  const instance = (piece: SpatialBoardPiece) => ({
    position: [piece.x, -piece.y, 0.94] as [number, number, number],
    scale: [piece.size, piece.size, 1] as [number, number, number],
    color: pieceLensColor(piece, lens, theme),
  });

  return (
    <>
      {agentPieces.length > 0 && (
        <Instances
          geometry={geometries.backing}
          limit={1024}
          range={agentPieces.length}
          renderOrder={1}
        >
          <meshBasicMaterial toneMapped={false} depthWrite={false} />
          {agentPieces.map(piece => (
            <Instance
              {...instance(piece)}
              color={theme.markBacking}
              key={`status-backing:${piece.id}`}
              position={[piece.x, -piece.y, 0.91]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {rotating.length > 0 && (
        <Instances
          geometry={geometries.ring}
          limit={256}
          range={rotating.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {rotating.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-ring:${piece.id}`}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {signalDisks.length > 0 && (
        <Instances
          geometry={geometries.signal}
          limit={256}
          range={signalDisks.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {signalDisks.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-signal:${piece.id}`}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {off.length > 0 && (
        <Instances
          geometry={geometries.offSegment}
          limit={1024}
          range={off.length * 4}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            opacity={1}
            depthWrite={false}
          />
          {off.flatMap(piece =>
            [0, 1, 2, 3].map(segment => (
              <Instance
                {...instance(piece)}
                key={`status-off-${segment}:${piece.id}`}
                rotation={[0, 0, segment * (Math.PI / 2)]}
                raycast={() => null}
              />
            ))
          )}
        </Instances>
      )}
      {rotating.length > 0 && (
        <Instances
          geometry={geometries.rotor}
          limit={256}
          range={rotating.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.84}
            depthWrite={false}
          />
          {rotating.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-rotor:${piece.id}`}
              ref={(target: THREE.Object3D | null) => {
                if (target) rotorRefs.current.set(piece.id, target);
                else rotorRefs.current.delete(piece.id);
              }}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {result.length > 0 && (
        <Instances
          geometry={geometries.check}
          limit={256}
          range={result.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={theme.canvas}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {result.map(piece => (
            <Instance
              {...instance(piece)}
              color={theme.canvas}
              key={`status-check:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {needsYou.length > 0 && (
        <Instances
          geometry={geometries.dot}
          limit={256}
          range={needsYou.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={theme.canvas}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {needsYou.map(piece => (
            <Instance
              {...instance(piece)}
              color={theme.canvas}
              key={`status-dot:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {fault.length > 0 && (
        <Instances
          geometry={geometries.cross}
          limit={256}
          range={fault.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            color={theme.canvas}
            toneMapped={false}
            transparent
            opacity={0.98}
            depthWrite={false}
          />
          {fault.map(piece => (
            <Instance
              {...instance(piece)}
              color={theme.canvas}
              key={`status-cross:${piece.id}`}
              position={[piece.x, -piece.y, 0.97]}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
    </>
  );
}

/** Animated selection: an accent reticle that eases in on selection and
 *  slowly rotates while ambient motion is welcome. Keyed by the selected
 *  piece so a selection change replays the ease-in. */
function SelectionRing({
  piece,
  active,
  reduced,
  theme,
}: {
  piece: SpatialBoardPiece;
  active: boolean;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const group = useRef<THREE.Group>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const points = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    const SEGMENTS = 48;
    for (let index = 0; index <= SEGMENTS; index += 1) {
      const angle = (index / SEGMENTS) * Math.PI * 2;
      result.push([Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, 0]);
    }
    return result;
  }, []);
  useFrame((state, delta) => {
    const target = group.current;
    if (!target) return;
    const clamped = Math.min(delta, 0.05);
    let animating = false;
    if (entrance.current < 1) {
      entrance.current = Math.min(1, entrance.current + clamped * 5);
      animating = true;
    }
    const scale = piece.size * (1.25 - 0.25 * entrance.current);
    target.scale.setScalar(scale);
    if (active) {
      target.rotation.z += clamped * 0.5;
      animating = true;
    }
    if (animating) state.invalidate();
  });
  return (
    <group ref={group} position={[piece.x, -piece.y, 0.78]}>
      <Line
        points={points}
        color={theme.selection}
        lineWidth={1.6}
        dashed
        dashSize={0.22}
        gapSize={0.09}
        toneMapped={false}
        transparent
        opacity={0.95}
        depthWrite={false}
        raycast={() => null}
      />
    </group>
  );
}

function AgentPieceLayer({
  pieces,
  delegationUnits,
  altitude,
  reduced,
  ambient,
  lens,
  onSelectAgent,
  onToggleAgentSelect,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  delegationUnits: SpatialBoardDelegationUnit[];
  altitude: SpatialBoardLayout['altitude'];
  reduced: boolean;
  ambient: boolean;
  lens: SpatialBoardLens;
  onSelectAgent: (agentId: string) => void;
  onToggleAgentSelect?: (agentId: string) => void;
  theme: SpatialThemeSnapshot;
}) {
  // Aggregate pieces render as the instanced population dot field (V3.1),
  // never as per-piece bodies or DOM count labels.
  const visible = pieces.filter(
    piece => piece.visible && piece.kind === 'agent'
  );
  const solid = visible.filter(piece => piece.sessionState !== 'stopped');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const bodyMat = useRef<THREE.MeshLambertMaterial>(null);
  const bodyRefs = useRef(new Map<string, THREE.Object3D>());
  const motionGroup = useRef<THREE.Group>(null);
  const previousAltitude = useRef(altitude);
  const previousPositions = useRef(
    new Map(visible.map(piece => [piece.id, { x: piece.x, y: -piece.y }]))
  );
  const entranceClock = useRef<number | null>(reduced ? null : 0);
  const invalidate = useThree(state => state.invalidate);
  const pieceGeometry = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.56, 0.34, 6);
    geometry.rotateX(Math.PI / 2);
    return geometry;
  }, []);
  useEffect(
    () => () => {
      pieceGeometry.dispose();
    },
    [pieceGeometry]
  );
  useCursor(hoveredId != null);

  // Carry the unit field through semantic altitude changes. The new layout is
  // first transformed back onto the ACTUAL previous frame, then that inverse
  // transform damps to identity. This keeps the selected Project under the
  // operator instead of teleporting through the old origin.
  useLayoutEffect(() => {
    const group = motionGroup.current;
    const next = new Map(
      visible.map(piece => [piece.id, { x: piece.x, y: -piece.y }])
    );
    if (group && !reduced && previousAltitude.current !== altitude) {
      const common = visible.filter(piece =>
        previousPositions.current.has(piece.id)
      );
      if (common.length > 0) {
        let nextX = 0;
        let nextY = 0;
        let priorX = 0;
        let priorY = 0;
        for (const piece of common) {
          const prior = previousPositions.current.get(piece.id)!;
          nextX += piece.x;
          nextY += -piece.y;
          priorX += group.position.x + group.scale.x * prior.x;
          priorY += group.position.y + group.scale.y * prior.y;
        }
        nextX /= common.length;
        nextY /= common.length;
        priorX /= common.length;
        priorY /= common.length;
        let numerator = 0;
        let denominator = 0;
        for (const piece of common) {
          const prior = previousPositions.current.get(piece.id)!;
          const actualX = group.position.x + group.scale.x * prior.x;
          const actualY = group.position.y + group.scale.y * prior.y;
          const dx = piece.x - nextX;
          const dy = -piece.y - nextY;
          numerator += dx * (actualX - priorX) + dy * (actualY - priorY);
          denominator += dx * dx + dy * dy;
        }
        const scale = THREE.MathUtils.clamp(
          denominator > 0.0001 ? numerator / denominator : 1,
          0.35,
          2.85
        );
        group.scale.set(scale, scale, 1);
        group.position.set(priorX - scale * nextX, priorY - scale * nextY, 0);
        invalidate();
      }
    }
    previousAltitude.current = altitude;
    previousPositions.current = next;
  }, [altitude, invalidate, reduced, visible]);

  // Entrance choreography (V2.4): pieces scale in with a radial slot stagger
  // while the material fades up. Because the layer now survives altitude
  // changes, this remains a board/data arrival signature and never replays on
  // Fleet → Project → Agent navigation.
  useFrame((state, delta) => {
    const group = motionGroup.current;
    let fieldMoving = false;
    if (group && !reduced) {
      const dt = Math.min(delta, 0.05);
      const x = THREE.MathUtils.damp(group.position.x, 0, 7.5, dt);
      const y = THREE.MathUtils.damp(group.position.y, 0, 7.5, dt);
      const scale = THREE.MathUtils.damp(group.scale.x, 1, 7.5, dt);
      fieldMoving =
        Math.abs(x) > 0.001 ||
        Math.abs(y) > 0.001 ||
        Math.abs(scale - 1) > 0.0005;
      group.position.set(fieldMoving ? x : 0, fieldMoving ? y : 0, 0);
      group.scale.set(fieldMoving ? scale : 1, fieldMoving ? scale : 1, 1);
    }
    if (entranceClock.current === null) {
      if (bodyMat.current) bodyMat.current.opacity = 1;
      if (fieldMoving) state.invalidate();
      return;
    }
    entranceClock.current += Math.min(delta, 0.05);
    const elapsed = entranceClock.current;
    let settled = true;
    for (const piece of solid) {
      const local = THREE.MathUtils.clamp(
        (elapsed - piece.slotIndex * 0.045) / 0.34,
        0,
        1
      );
      const eased = 1 - Math.pow(1 - local, 3);
      const bodyScale = piece.size * (0.4 + 0.6 * eased);
      bodyRefs.current.get(piece.id)?.scale.set(bodyScale, bodyScale, 1);
      if (local < 1) settled = false;
    }
    const fade = THREE.MathUtils.clamp(elapsed / 0.3, 0, 1);
    if (bodyMat.current) bodyMat.current.opacity = fade;
    if (settled && fade >= 1) {
      entranceClock.current = null;
      return;
    }
    state.invalidate();
  });

  const selected = visible.find(piece => piece.selected);
  return (
    <group ref={motionGroup}>
      <Instances geometry={pieceGeometry} limit={256} range={solid.length}>
        <meshLambertMaterial
          ref={bodyMat}
          transparent
          opacity={reduced ? 1 : 0}
        />
        {solid.map(piece => {
          const interactive = piece.kind === 'agent' && altitude !== 'fleet';
          return (
            <Instance
              key={piece.id}
              ref={(instance: THREE.Object3D | null) => {
                if (instance) bodyRefs.current.set(piece.id, instance);
                else bodyRefs.current.delete(piece.id);
              }}
              position={[piece.x, -piece.y, 0.65]}
              scale={[piece.size, piece.size, 1]}
              color={theme.unit}
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                setHoveredId(piece.id);
              }}
              onPointerOut={() => setHoveredId(null)}
              onClick={(event: ThreeEvent<MouseEvent>) => {
                if (!piece.agentId || event.delta > 5) return;
                // Shift-click toggles multi-selection at EVERY altitude
                // (V3.2) — fleet pieces stay non-interactive for plain
                // clicks, where zones own the drill verb.
                if (event.shiftKey && onToggleAgentSelect) {
                  event.stopPropagation();
                  onToggleAgentSelect(piece.agentId);
                  return;
                }
                if (!interactive) return;
                event.stopPropagation();
                onSelectAgent(piece.agentId);
              }}
            />
          );
        })}
      </Instances>
      <StatusMarkLayer
        pieces={solid}
        active={ambient}
        lens={lens}
        theme={theme}
      />
      <DelegationUnitLayer
        units={delegationUnits}
        reduced={reduced}
        theme={theme}
      />
      <StoppedAgentOutlines pieces={visible} lens={lens} theme={theme} />
      {selected && (
        <SelectionRing
          key={selected.id}
          piece={selected}
          active={ambient}
          reduced={reduced}
          theme={theme}
        />
      )}
    </group>
  );
}

const noopRaycast = () => null;

function PopulationStatusMarks({
  field,
  lens,
  ambient,
  theme,
}: {
  field: ReturnType<typeof computePopulationDotField>;
  lens: SpatialBoardLens;
  ambient: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const invalidate = useThree(state => state.invalidate);
  const capacity = useMemo(() => {
    let size = 64;
    while (size < field.count) size *= 2;
    return size;
  }, [field.count]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  const activeCount = useMemo(() => {
    const reviewing = POPULATION_STATUS_ORDER.indexOf('reviewing');
    const working = POPULATION_STATUS_ORDER.indexOf('working');
    let count = 0;
    for (let index = 0; index < field.count; index += 1) {
      if (field.status[index] === reviewing || field.status[index] === working)
        count += 1;
    }
    return count;
  }, [field]);
  const geometry = useMemo(() => {
    const next = new THREE.PlaneGeometry(1, 1);
    next.setAttribute(
      'instanceState',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    );
    next.setAttribute(
      'instanceMarkColor',
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    );
    return next;
  }, [capacity]);
  const shader = useMemo(
    () => ({
      uniforms: { uPhase: { value: 0 } },
      vertexShader: `
        attribute float instanceState;
        attribute vec3 instanceMarkColor;
        varying vec2 vMarkUv;
        varying float vMarkState;
        varying vec3 vMarkColor;
        void main() {
          vMarkUv = uv - 0.5;
          vMarkState = instanceState;
          vMarkColor = instanceMarkColor;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uPhase;
        varying vec2 vMarkUv;
        varying float vMarkState;
        varying vec3 vMarkColor;
        float segment(vec2 p, vec2 a, vec2 b) {
          vec2 pa = p - a;
          vec2 ba = b - a;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          return length(pa - ba * h);
        }
        void main() {
          vec2 p = vMarkUv;
          float d = length(p);
          float ink = 0.0;
          float alpha = 0.96;
          if (vMarkState < 0.5) {
            float angle = atan(p.y, p.x);
            ink = abs(d - 0.27) < 0.055 && angle < 2.55 ? 1.0 : 0.0;
            alpha = 0.54;
          } else if (vMarkState < 1.5) {
            float c = cos(uPhase);
            float s = sin(uPhase);
            vec2 rotated = mat2(c, -s, s, c) * p;
            ink = d < 0.31 && rotated.x > -0.02 ? 1.0 : 0.0;
          } else if (vMarkState < 2.5) {
            float check = min(
              segment(p, vec2(-0.27, 0.01), vec2(-0.07, -0.20)),
              segment(p, vec2(-0.07, -0.20), vec2(0.31, 0.23))
            );
            ink = check < 0.055 ? 1.0 : 0.0;
          } else if (vMarkState < 3.5) {
            ink = abs(d - 0.27) < 0.055 || d < 0.065 ? 1.0 : 0.0;
          } else {
            float cross = min(
              segment(p, vec2(-0.24, -0.24), vec2(0.24, 0.24)),
              segment(p, vec2(-0.24, 0.24), vec2(0.24, -0.24))
            );
            ink = cross < 0.055 ? 1.0 : 0.0;
          }
          if (ink < 0.5) discard;
          gl_FragColor = vec4(vMarkColor, alpha);
        }
      `,
    }),
    []
  );

  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const states = geometry.getAttribute(
      'instanceState'
    ) as THREE.InstancedBufferAttribute;
    const colors = geometry.getAttribute(
      'instanceMarkColor'
    ) as THREE.InstancedBufferAttribute;
    const stateByStatus = [3, 4, 1, 1, 0, 2] as const;
    mesh.current.count = field.count;
    for (let index = 0; index < field.count; index += 1) {
      scratch.position.set(field.x[index]!, -field.y[index]!, 0.92);
      scratch.scale.setScalar(field.size[index]! * 1.42);
      scratch.updateMatrix();
      mesh.current.setMatrixAt(index, scratch.matrix);
      states.setX(index, stateByStatus[field.status[index]!]!);
      const color =
        lens === 'burn'
          ? new THREE.Color(
              field.burn[index]! < 0
                ? theme.consumption.unknown
                : spatialPressureColor(theme, field.burn[index]!)
            )
          : new THREE.Color(
              spatialStatusColor(
                theme,
                POPULATION_STATUS_ORDER[field.status[index]!]!
              )
            );
      colors.setXYZ(index, color.r, color.g, color.b);
    }
    mesh.current.instanceMatrix.needsUpdate = true;
    states.needsUpdate = true;
    colors.needsUpdate = true;
    invalidate();
  }, [field, geometry, invalidate, lens, scratch, theme]);

  useFrame((frame, delta) => {
    if (!ambient || activeCount === 0 || !material.current) return;
    material.current.uniforms.uPhase!.value =
      (material.current.uniforms.uPhase!.value -
        (Math.min(delta, 0.05) * Math.PI * 2) /
          STATUS_LIGHT_ACTIVE_ROTATION_SECONDS) %
      (Math.PI * 2);
    frame.invalidate();
  });

  if (field.count === 0) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={mesh}
      args={[geometry, undefined, capacity]}
      frustumCulled={false}
      raycast={noopRaycast}
      renderOrder={2}
    >
      <shaderMaterial
        ref={material}
        args={[shader]}
        transparent
        depthWrite={false}
      />
    </instancedMesh>
  );
}
/**
 * Demo-scale population field (V3.1): every aggregate piece expands into
 * per-agent status dots packed inside its zone, drawn as ONE InstancedMesh
 * for the whole board. No per-agent React elements or DOM labels; zone DOM
 * controls remain the interaction and exact-count owners. Static at rest so
 * the demand loop still parks.
 */
function PopulationDotLayer({
  zones,
  pieces,
  altitude,
  reduced,
  lens,
  theme,
}: {
  zones: SpatialBoardProjectZone[];
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  reduced: boolean;
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
}) {
  const invalidate = useThree(state => state.invalidate);
  const field = useMemo(
    () => computePopulationDotField(zones, pieces),
    [pieces, zones]
  );
  // Buffer capacity grows in power-of-two buckets so live ticks reuse the
  // same GPU buffers; the mesh remounts only when the bucket changes.
  const capacity = useMemo(() => {
    let size = 64;
    while (size < field.count) size *= 2;
    return size;
  }, [field.count]);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const entrance = useRef(reduced ? 1 : 0);
  const previousField = useRef<PopulationDotField | null>(null);
  const previousAltitude = useRef(altitude);
  const morph = useRef<{
    progress: number;
    fromX: Float32Array;
    fromY: Float32Array;
    fromSize: Float32Array;
  } | null>(null);
  const scratch = useMemo(() => new THREE.Object3D(), []);
  /** Palette conversion happens once per resolved snapshot, never per unit or
   * frame. Theme changes update the existing mesh's instance colors in place. */
  const burnColors = useMemo(
    () =>
      Array.from(
        { length: BURN_RAMP_STEPS + 1 },
        (_, index) =>
          new THREE.Color(spatialPressureColor(theme, index / BURN_RAMP_STEPS))
      ),
    [theme]
  );
  const burnUnknown = useMemo(
    () => new THREE.Color(theme.consumption.unknown),
    [theme]
  );
  const unitColor = useMemo(() => new THREE.Color(theme.unit), [theme]);
  const geometry = useMemo(() => {
    const next = new THREE.CylinderGeometry(0.5, 0.56, 0.2, 6);
    next.rotateX(Math.PI / 2);
    return next;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const prior = previousField.current;
    const transitioning =
      !reduced && prior !== null && previousAltitude.current !== altitude;
    if (transitioning) {
      const priorIndex = new Map<string, number>();
      for (let index = 0; index < prior.count; index++) {
        priorIndex.set(
          `${prior.zoneIds[prior.zone[index]!]}:${prior.status[index]}:${prior.ordinal[index]}`,
          index
        );
      }
      const centers = new Map(
        zones.map(zone => [
          zone.id,
          {
            x: zone.rect.x + zone.radius,
            y: zone.rect.y + zone.radius,
          },
        ])
      );
      const fromX = new Float32Array(field.count);
      const fromY = new Float32Array(field.count);
      const fromSize = new Float32Array(field.count);
      for (let index = 0; index < field.count; index++) {
        const zoneId = field.zoneIds[field.zone[index]!]!;
        const match = priorIndex.get(
          `${zoneId}:${field.status[index]}:${field.ordinal[index]}`
        );
        const center = centers.get(zoneId);
        fromX[index] =
          match === undefined
            ? (center?.x ?? field.x[index]!)
            : prior.x[match]!;
        fromY[index] =
          match === undefined
            ? (center?.y ?? field.y[index]!)
            : prior.y[match]!;
        fromSize[index] =
          match === undefined ? field.size[index]! * 0.4 : prior.size[match]!;
      }
      morph.current = { progress: 0, fromX, fromY, fromSize };
    } else {
      morph.current = null;
    }
    mesh.count = field.count;
    for (let index = 0; index < field.count; index++) {
      scratch.position.set(
        morph.current?.fromX[index] ?? field.x[index]!,
        -(morph.current?.fromY[index] ?? field.y[index]!),
        0.7
      );
      scratch.scale.setScalar(
        morph.current?.fromSize[index] ?? field.size[index]!
      );
      scratch.updateMatrix();
      mesh.setMatrixAt(index, scratch.matrix);
      // Parallel palettes, one mesh (ENG-008): the burn lens swaps the color
      // source from the D40 status protocol to the FLUX ramp — geometry,
      // packing, and instancing are untouched.
      mesh.setColorAt(
        index,
        lens === 'burn'
          ? field.burn[index]! < 0
            ? burnUnknown
            : burnColors[
                Math.round(
                  Math.max(0, Math.min(1, field.burn[index]!)) * BURN_RAMP_STEPS
                )
              ]!
          : unitColor
      );
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    previousField.current = field;
    previousAltitude.current = altitude;
    invalidate();
  }, [
    altitude,
    burnColors,
    burnUnknown,
    field,
    invalidate,
    lens,
    reduced,
    scratch,
    unitColor,
    zones,
  ]);

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    let animating = false;
    const activeMorph = morph.current;
    const mesh = meshRef.current;
    if (activeMorph && mesh) {
      activeMorph.progress = Math.min(
        1,
        activeMorph.progress + Math.min(delta, 0.05) * 3.8
      );
      const eased = 1 - Math.pow(1 - activeMorph.progress, 3);
      for (let index = 0; index < field.count; index++) {
        scratch.position.set(
          THREE.MathUtils.lerp(
            activeMorph.fromX[index]!,
            field.x[index]!,
            eased
          ),
          -THREE.MathUtils.lerp(
            activeMorph.fromY[index]!,
            field.y[index]!,
            eased
          ),
          0.7
        );
        scratch.scale.setScalar(
          THREE.MathUtils.lerp(
            activeMorph.fromSize[index]!,
            field.size[index]!,
            eased
          )
        );
        scratch.updateMatrix();
        mesh.setMatrixAt(index, scratch.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      animating = activeMorph.progress < 1;
      if (!animating) morph.current = null;
    }
    if (entrance.current < 1) {
      entrance.current = Math.min(
        1,
        entrance.current + Math.min(delta, 0.05) * 3.5
      );
      material.opacity = 0.92 * entrance.current;
      animating = true;
    } else {
      material.opacity = 0.92;
    }
    if (animating) state.invalidate();
  });

  if (field.count === 0) return null;
  return (
    <>
      <instancedMesh
        key={capacity}
        ref={meshRef}
        args={[geometry, undefined, capacity]}
        frustumCulled={false}
        raycast={noopRaycast}
        renderOrder={1}
      >
        <meshBasicMaterial
          ref={materialRef}
          toneMapped={false}
          transparent
          opacity={reduced ? 0.92 : 0}
          depthWrite={false}
        />
      </instancedMesh>
      {/* Very-far agglomeration preserves D40 shape and exact mass without
          per-agent ambient motion; individual Active hexes own visible work. */}
      <PopulationStatusMarks
        field={field}
        lens={lens}
        ambient={false}
        theme={theme}
      />
    </>
  );
}

/** One dashed Line2 draw for every stopped Session-backed Agent. The DOM
 * controls remain the interaction/a11y owner; this layer is visual state. */
function StoppedAgentOutlines({
  pieces,
  lens,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
}) {
  const geometry = useMemo(() => {
    const points: Array<[number, number, number]> = [];
    const vertexColors: THREE.Color[] = [];
    for (const piece of pieces) {
      if (piece.kind !== 'agent' || piece.sessionState !== 'stopped') continue;
      const radius = piece.size * 0.52;
      const color = new THREE.Color(pieceLensColor(piece, lens, theme));
      for (let edge = 0; edge < 8; edge += 1) {
        const from = (edge / 8) * Math.PI * 2 + Math.PI / 8;
        const to = ((edge + 1) / 8) * Math.PI * 2 + Math.PI / 8;
        points.push(
          [
            piece.x + Math.cos(from) * radius,
            -piece.y + Math.sin(from) * radius,
            0.72,
          ],
          [
            piece.x + Math.cos(to) * radius,
            -piece.y + Math.sin(to) * radius,
            0.72,
          ]
        );
        vertexColors.push(color, color);
      }
    }
    return { points, vertexColors };
  }, [lens, pieces, theme]);

  if (geometry.points.length === 0) return null;
  return (
    <Line
      points={geometry.points}
      vertexColors={geometry.vertexColors}
      segments
      dashed
      dashSize={0.08}
      gapSize={0.11}
      lineWidth={1.35}
      transparent
      opacity={0.78}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

/**
 * Multi-selection marks (V3.2): dashed rings on every multi-selected agent
 * piece plus a dashed outline around zones whose visible population is fully
 * captured — the board's existing selection language (the dashed teal of
 * `SelectionRing`) applied at group scale. ONE segmented Line2 draw for the
 * whole set; static, so the demand loop still parks.
 */
function MultiSelectionLayer({
  layout,
  selection,
  theme,
}: {
  layout: SpatialBoardLayout;
  selection: ReadonlySet<string>;
  theme: SpatialThemeSnapshot;
}) {
  const points = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    if (selection.size === 0) return result;
    const RING_SEGMENTS = 16;
    for (const piece of layout.pieces) {
      if (
        piece.kind !== 'agent' ||
        !piece.visible ||
        !piece.agentId ||
        !selection.has(piece.agentId)
      ) {
        continue;
      }
      const radius = piece.size * 0.66;
      for (let segment = 0; segment < RING_SEGMENTS; segment += 1) {
        const from = (segment / RING_SEGMENTS) * Math.PI * 2;
        const to = ((segment + 1) / RING_SEGMENTS) * Math.PI * 2;
        result.push(
          [
            piece.x + Math.cos(from) * radius,
            -piece.y + Math.sin(from) * radius,
            0.78,
          ],
          [
            piece.x + Math.cos(to) * radius,
            -piece.y + Math.sin(to) * radius,
            0.78,
          ]
        );
      }
    }
    for (const zone of layout.zones) {
      if (!zone.visible || zone.isAggregate || zone.visibleAgentCount === 0) {
        continue;
      }
      let selectedCount = 0;
      for (const agentId of zone.agentIds) {
        if (selection.has(agentId)) selectedCount += 1;
      }
      if (selectedCount < zone.visibleAgentCount) continue;
      const center = rectCenter(zone.rect);
      const radius = Math.max(0, zone.radius - 0.5);
      const z = 0.4;
      const segments = 48;
      for (let edge = 0; edge < segments; edge += 1) {
        const from = (edge / segments) * Math.PI * 2;
        const to = ((edge + 1) / segments) * Math.PI * 2;
        result.push(
          [
            center.x + Math.cos(from) * radius,
            center.y + Math.sin(from) * radius,
            z,
          ],
          [
            center.x + Math.cos(to) * radius,
            center.y + Math.sin(to) * radius,
            z,
          ]
        );
      }
    }
    return result;
  }, [layout.pieces, layout.zones, selection]);

  if (points.length === 0) return null;
  return (
    <Line
      points={points}
      color={theme.selection}
      segments
      dashed
      dashSize={0.24}
      gapSize={0.12}
      lineWidth={1.5}
      toneMapped={false}
      transparent
      opacity={0.92}
      depthWrite={false}
      raycast={() => null}
    />
  );
}

function AgentControls({
  pieces,
  altitude,
  focusedProjectId,
  onSelectAgent,
  onToggleAgentSelect,
  multiSelection,
  reduced,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  onSelectAgent: (agentId: string) => void;
  onToggleAgentSelect?: (agentId: string) => void;
  multiSelection?: ReadonlySet<string>;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  if (altitude === 'fleet') return null;
  return pieces
    .filter(
      piece =>
        piece.kind === 'agent' &&
        piece.visible &&
        piece.agentId &&
        piece.projectId === focusedProjectId
    )
    .map(piece => {
      const always = piece.labelVisibility === 'always';
      const lightState = statusLightStateForAgentStatus(piece.status);
      // Delegation joins the control copy as labels (ENG-023 D3b): the count
      // and the team's kinds. Full child descriptions stay at the Sessions
      // and Terminal altitudes — a board tooltip is not a roster.
      const delegated = piece.delegation;
      const delegationCopy = delegated
        ? `${delegated.count} delegated ${delegated.count === 1 ? 'agent' : 'agents'} working`
        : null;
      const delegationKinds = delegated
        ? [
            ...new Set(
              delegated.children
                .map(child => child.agentType?.trim())
                .filter((kind): kind is string => !!kind)
            ),
          ].join(', ')
        : '';
      return (
        <DampedHtmlAnchor
          key={`control:${piece.id}`}
          position={[piece.x, -piece.y, 1.2]}
          reduced={reduced}
          center
        >
          <button
            type="button"
            data-board-agent={piece.agentId}
            data-board-session-state={piece.sessionState}
            data-board-status-light={lightState}
            data-board-delegation={delegated ? delegated.count : undefined}
            aria-current={piece.selected ? 'true' : undefined}
            aria-pressed={
              onToggleAgentSelect
                ? (multiSelection?.has(piece.agentId!) ?? false)
                : undefined
            }
            aria-label={`${piece.label}${piece.activity ? `, ${piece.activity}` : ''}, ${STATUS_LIGHT_META[lightState].label}${piece.sessionState === 'stopped' ? ', stopped session' : ''}${delegationCopy ? `, ${delegationCopy}` : ''}`}
            onClick={event => {
              // Shift-activate (pointer or keyboard) toggles the Agent in
              // the multi-selection (V3.2); plain activate inspects it.
              if (event.shiftKey && onToggleAgentSelect) {
                onToggleAgentSelect(piece.agentId!);
              } else {
                onSelectAgent(piece.agentId!);
              }
            }}
            className="board-control-enter group relative grid h-11 w-11 place-items-center border border-transparent bg-transparent outline-none transition-[border-color,transform] duration-150 active:translate-y-px focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span
              className={`exa-material-overlay pointer-events-none absolute left-1/2 top-[calc(100%+3px)] w-16 -translate-x-1/2 border px-1 py-1 text-center text-chrome-nano font-medium transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 sm:w-28 sm:px-1.5 sm:text-chrome-micro ${always ? 'opacity-100' : 'opacity-0'}`}
              style={{
                borderColor: theme.unitMuted,
                color: theme.label,
                boxShadow: `0 8px 22px ${theme.shadow}`,
              }}
            >
              <span className="block truncate">{piece.label}</span>
              <span
                className="mt-0.5 block truncate text-chrome-nano font-normal"
                style={{ color: theme.labelMuted }}
              >
                {piece.activity ?? 'No recent activity reported'}
              </span>
              {delegationCopy && (
                <span
                  className="block truncate text-chrome-nano font-normal"
                  style={{ color: theme.labelMuted }}
                >
                  {delegated!.count} delegated
                  {delegationKinds ? ` · ${delegationKinds}` : ''}
                </span>
              )}
            </span>
          </button>
        </DampedHtmlAnchor>
      );
    });
}

function delegationElapsedCopy(startedAt: number | null): string | null {
  if (startedAt === null || !Number.isFinite(startedAt)) return null;
  const minutes = Math.floor((Date.now() - startedAt) / 60_000);
  if (minutes < 0) return null;
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * DOM equivalents for delegated child units (D3c). WebGL stays out of the
 * accessibility tree, so every visible child is reachable by pointer, focus,
 * and screen reader here. Focus reveals type, description, elapsed, and parent.
 * Activating opens the PARENT Session: D3c does not pretend a child is
 * independently commandable, and never joins "Direct N Agents".
 */
function DelegationControls({
  units,
  pieces,
  altitude,
  focusedProjectId,
  onSelectAgent,
  reduced,
  theme,
}: {
  units: SpatialBoardDelegationUnit[];
  pieces: SpatialBoardPiece[];
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  onSelectAgent: (agentId: string) => void;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  if (altitude === 'fleet') return null;
  const parentLabels = new Map(
    pieces.map(piece => [piece.id, piece.label] as const)
  );
  return units
    .filter(unit => unit.projectId === focusedProjectId)
    .map(unit => {
      const parentLabel = parentLabels.get(unit.parentPieceId) ?? 'its parent';
      const elapsed = delegationElapsedCopy(unit.startedAt);
      const label =
        unit.kind === 'overflow'
          ? `${unit.overflowCount} more delegated Agents under ${parentLabel}`
          : [
              unit.agentType ?? 'Delegated Agent',
              unit.description,
              elapsed ? `running ${elapsed}` : null,
              `delegated by ${parentLabel}`,
            ]
              .filter(Boolean)
              .join(', ');
      return (
        <DampedHtmlAnchor
          key={`delegation-control:${unit.id}`}
          position={[unit.x, -unit.y, 1.1]}
          reduced={reduced}
          center
        >
          <button
            type="button"
            data-board-delegation-unit={unit.id}
            data-board-delegation-kind={unit.kind}
            data-board-delegation-parent={unit.parentAgentId}
            aria-label={label}
            title={label}
            onClick={() => onSelectAgent(unit.parentAgentId)}
            className="board-control-enter group relative grid h-8 w-8 place-items-center border border-transparent bg-transparent outline-none transition-[border-color] duration-150 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {unit.kind === 'overflow' && (
              <span
                aria-hidden="true"
                className="pointer-events-none font-mono text-chrome-nano font-semibold"
                style={{ color: theme.label }}
              >
                +{unit.overflowCount}
              </span>
            )}
          </button>
        </DampedHtmlAnchor>
      );
    });
}

/** Demand-loop bridge: material/DOM props update in place, then the existing
 * scene gets exactly one requested paint for the new resolved snapshot. */
function InvalidateOnSpatialTheme({ theme }: { theme: SpatialThemeSnapshot }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => invalidate(), [invalidate, theme]);
  return null;
}

export function OperationsBoardCanvas({
  layout,
  projection,
  lens = 'status',
  controllerRef,
  onViewportChange,
  onDrillProject,
  onSelectAgent,
  onBackground,
  multiSelection,
  onToggleAgentSelect,
  onToggleZoneSelect,
  onBandSelect,
  bandOverlayRef,
  followSelection = true,
  touchSelectionMode = false,
  onManualCameraInput,
  onClampEdges,
  preserveDrawingBuffer = false,
  theme,
}: {
  layout: SpatialBoardLayout;
  projection: SpatialBoardProjection;
  lens?: SpatialBoardLens;
  controllerRef: { current: OperationsBoardHandle | null };
  onViewportChange?: (viewport: OperationsBoardViewport) => void;
  onDrillProject: (projectId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onBackground: () => void;
  /** Multi-selection (V3.2): ephemeral Agent ids; rendering + toggles only —
   *  the single URL-addressed selection stays `layout.selectedAgentId`. */
  multiSelection?: ReadonlySet<string>;
  onToggleAgentSelect?: (agentId: string) => void;
  onToggleZoneSelect?: (zoneId: string) => void;
  onBandSelect?: (band: SpatialBoardRect) => void;
  bandOverlayRef?: { current: HTMLDivElement | null };
  followSelection?: boolean;
  touchSelectionMode?: boolean;
  onManualCameraInput?: () => void;
  onClampEdges?: (edges: BoardClampEdges | null) => void;
  preserveDrawingBuffer?: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const pageVisible = usePageVisible();
  const ambient = !reduced && !lowPower && pageVisible;
  // During a Team→Fleet handoff the lazy postprocessing chunk's shader
  // compile is the single biggest main-thread stall — landing it mid
  // crossfade cuts the flight short. Defer the bloom mount until the entry
  // choreography has settled; outside a handoff it mounts immediately.
  const [effectsReady, setEffectsReady] = useState(false);
  useEffect(() => {
    if (!altitudeHandoffActive()) {
      setEffectsReady(true);
      return;
    }
    const timer = window.setTimeout(
      () => setEffectsReady(true),
      ALTITUDE_HANDOFF_HOLD_MS + ALTITUDE_HANDOFF_CROSSFADE_MS + 400
    );
    return () => window.clearTimeout(timer);
  }, []);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  /** Band-drag end timestamp — the trailing click must not clear/ascend. */
  const suppressMissRef = useRef(0);
  const visibleZones = layout.zones.filter(zone => zone.visible);
  // Delegation composition (V3.4): pure slot/overflow/lineage policy, resolved
  // once per layout. Aggregated tiers emit none by construction.
  const delegationUnits = useMemo(
    () => selectSpatialDelegationUnits(layout),
    [layout]
  );
  // Zone-label budget: full cards only when every zone's projected width can
  // afford them, so the bound is the NARROWEST visible zone (one overflowing
  // card is the failure the tier exists to prevent). Hysteresis keeps the
  // tier stable through damped zoom, and the state only flips at a boundary
  // crossing (never per frame). Recomputes on zoom AND on zone-width changes
  // (layout ticks can resize zones without any camera motion).
  const [labelTier, setLabelTier] = useState<ZoneLabelTier>('full');
  const labelTierRef = useRef<ZoneLabelTier>('full');
  const zoneWidthRef = useRef(24);
  const zoomRef = useRef(1);
  const minZoneWidth =
    visibleZones.length > 0
      ? visibleZones.reduce(
          (min, zone) => Math.min(min, zone.rect.width),
          Number.POSITIVE_INFINITY
        )
      : 24;
  zoneWidthRef.current = minZoneWidth;
  const applyLabelTier = useCallback(() => {
    const projectedPx = zoneWidthRef.current * zoomRef.current;
    const next: ZoneLabelTier =
      labelTierRef.current === 'full'
        ? projectedPx < 250
          ? 'compact'
          : 'full'
        : projectedPx > 290
          ? 'full'
          : 'compact';
    if (next !== labelTierRef.current) {
      labelTierRef.current = next;
      setLabelTier(next);
    }
  }, []);
  const handleZoomChange = useCallback(
    (zoom: number) => {
      zoomRef.current = zoom;
      applyLabelTier();
    },
    [applyLabelTier]
  );
  useEffect(() => {
    applyLabelTier();
  }, [minZoneWidth, applyLabelTier]);
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 200 }}
      gl={{ antialias: true, preserveDrawingBuffer }}
      style={{ touchAction: 'none' }}
      onPointerMissed={event => {
        // The click that trails a band drag is not a background click.
        if (performance.now() - suppressMissRef.current < 250) return;
        if (event.type === 'click' && event.target instanceof HTMLCanvasElement)
          onBackground();
      }}
      onCreated={({ gl, scene, camera }) => {
        if (process.env.NODE_ENV !== 'production') {
          const target = window as typeof window & {
            __EVAL_GL__?: THREE.WebGLRenderer;
            __EVAL_SCENE__?: THREE.Scene;
            __EVAL_CAM__?: THREE.Camera;
          };
          target.__EVAL_GL__ = gl;
          target.__EVAL_SCENE__ = scene;
          target.__EVAL_CAM__ = camera;
        }
      }}
      aria-hidden="true"
      data-board-canvas-theme={theme.themeId}
    >
      {/* The flat board ground is the scene clear itself: identical authored
          theme color without spending a draw call on a full-screen plane. */}
      <color attach="background" args={[theme.zone]} />
      <InvalidateOnSpatialTheme theme={theme} />
      {/* Soft key + fill: gives zone plates and piece bodies a readable
          top/side split in the fixed-angle projection. */}
      <ambientLight intensity={1.15} />
      <directionalLight position={[26, 42, 80]} intensity={0.65} />
      <BoardCameraRig
        layout={layout}
        projection={projection}
        reduced={reduced}
        controllerRef={controllerRef}
        onViewportChange={onViewportChange}
        onZoomChange={handleZoomChange}
        onBandSelect={onBandSelect}
        bandOverlayRef={bandOverlayRef}
        suppressMissRef={suppressMissRef}
        followSelection={followSelection}
        touchSelectionMode={touchSelectionMode}
        onManualCameraInput={onManualCameraInput}
        onClampEdges={onClampEdges}
      />
      <BoardGrid bounds={layout.bounds} theme={theme} />
      <ZoneLayer
        zones={visibleZones}
        reduced={reduced}
        onDrillProject={onDrillProject}
        onToggleZoneSelect={onToggleZoneSelect}
        onHover={setHoveredZoneId}
        hoveredId={hoveredZoneId}
        theme={theme}
      />
      <AgentPieceLayer
        pieces={layout.pieces}
        delegationUnits={delegationUnits}
        altitude={layout.altitude}
        reduced={reduced}
        ambient={ambient}
        lens={lens}
        onSelectAgent={onSelectAgent}
        onToggleAgentSelect={onToggleAgentSelect}
        theme={theme}
      />
      <PopulationDotLayer
        zones={layout.zones}
        pieces={layout.pieces}
        altitude={layout.altitude}
        reduced={reduced}
        lens={lens}
        theme={theme}
      />
      {multiSelection && multiSelection.size > 0 && (
        <MultiSelectionLayer
          layout={layout}
          selection={multiSelection}
          theme={theme}
        />
      )}
      <ProjectControls
        zones={visibleZones}
        altitude={layout.altitude}
        focusedProjectId={layout.focusedProjectId}
        labelTier={labelTier}
        reduced={reduced}
        lens={lens}
        onDrillProject={onDrillProject}
        onToggleZoneSelect={onToggleZoneSelect}
        theme={theme}
      />
      <AgentControls
        pieces={layout.pieces}
        altitude={layout.altitude}
        focusedProjectId={layout.focusedProjectId}
        onSelectAgent={onSelectAgent}
        onToggleAgentSelect={onToggleAgentSelect}
        multiSelection={multiSelection}
        reduced={reduced}
        theme={theme}
      />
      <DelegationControls
        units={delegationUnits}
        pieces={layout.pieces}
        altitude={layout.altitude}
        focusedProjectId={layout.focusedProjectId}
        onSelectAgent={onSelectAgent}
        reduced={reduced}
        theme={theme}
      />
      {!lowPower && effectsReady && theme.bloom.enabled && (
        <Suspense fallback={null}>
          <OperationsBoardEffects bloom={theme.bloom} />
        </Suspense>
      )}
    </Canvas>
  );
}
