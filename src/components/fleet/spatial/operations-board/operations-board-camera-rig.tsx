'use client';

/**
 * The board's camera: pose state, semantic flights on the shared transition
 * clock, damped manual moves, pointer/wheel/pinch ownership, the V3.0 entry
 * handoff, and the controller verbs the surface drives. The rig mutates the
 * camera only -- world layout is never a function of what the camera does.
 */

import {
  useFrame,
  useThree,
} from '@react-three/fiber';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardLayout,
  type SpatialBoardProjection,
  type SpatialBoardRect,
} from '@exawatt/ui-model';
import {
  useBoardTransitionClock,
} from './operations-board-field';
import {
  beginBoardTransition,
  boardTransitionEase,
  boardTransitionProgress,
  dampBoardZoom,
  mixBoardZoom,
  settleBoardTransition,
} from './operations-board-transition';
import {
  ALTITUDE_HANDOFF_CROSSFADE_MS,
  ALTITUDE_HANDOFF_FALLBACK_EVENT,
  ALTITUDE_HANDOFF_HOLD_MS,
  ALTITUDE_HANDOFF_POSE_EVENT,
  altitudeHandoffActive,
  claimAltitudeHandoff,
  solveEntryPose,
  type HandoffPoseDetail,
} from '@/components/nav/altitude-handoff';
import {
  applyBoardCameraTarget,
  boardCameraLimits,
  boardClampEdgesKey,
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
import {
  bandBoardRect,
  bandGestureMoved,
  bandOverlayRect,
  createBoardGestureState,
  endBoardGesture,
} from './operations-board-gestures';

export interface OperationsBoardHandle {
  recenter(): void;
  restoreViewport(viewport: OperationsBoardViewport): void;
  focusProject(projectId: string): void;
  /** Fly to the whole board -- the Fleet altitude's frame. */
  focusFleet(): void;
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

export const BoardCameraRig = memo(function BoardCameraRig({
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
  /**
   * Semantic camera moves ride the board's shared transition clock, so the
   * camera and the field arrive on the same frame and neither starts with the
   * velocity step damping cannot avoid. Continuous moves -- pan, wheel, pinch,
   * follow, clamp rubber-band -- keep damping, because their target is still
   * moving and there is no arrival to schedule.
   */
  const transitionClock = useBoardTransitionClock();
  const flightFrom = useRef<BoardCameraTarget | null>(null);
  const beginFlight = useCallback(() => {
    lambda.current = FLIGHT_LAMBDA;
    if (reduced || !transitionClock || !initialized.current) {
      flightFrom.current = null;
      return;
    }
    flightFrom.current = { ...current.current };
    beginBoardTransition(transitionClock.current, performance.now());
  }, [reduced, transitionClock]);
  const beginDrift = useCallback((speed: number) => {
    lambda.current = speed;
    flightFrom.current = null;
  }, []);
  // Held in refs like the other camera helpers here, so the pointer listeners
  // can stay registered once instead of re-binding whenever these rebuild.
  const beginFlightRef = useRef(beginFlight);
  beginFlightRef.current = beginFlight;
  const beginDriftRef = useRef(beginDrift);
  beginDriftRef.current = beginDrift;
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
  // The gesture outlives listener re-registration. Everything the pointer
  // handlers need that CAN change on a data tick is read through a ref, so the
  // listeners are registered once and a fleet update can never interrupt a
  // hand movement mid-drag.
  const gesture = useRef(createBoardGestureState());
  const constrainTargetRef = useRef<() => void>(() => undefined);
  const announceTargetViewportRef = useRef<() => void>(() => undefined);
  const handlers = useRef({
    onBandSelect,
    onManualCameraInput,
    touchSelectionMode,
    reduced,
  });
  handlers.current = {
    onBandSelect,
    onManualCameraInput,
    touchSelectionMode,
    reduced,
  };

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
  announceTargetViewportRef.current = announceTargetViewport;

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
  constrainTargetRef.current = constrainTarget;

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
      beginFlightRef.current();
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
      // The hotkey that caused this move already started the camera on its
      // own frame (`focusProject` / `focusFleet`), before React committed. If
      // this commit resolves to the flight already in progress, JOIN it --
      // restarting would reset the ease and read as a hitch 80ms in.
      const alreadyFlying =
        flightFrom.current !== null &&
        Math.abs(next.x - target.current.x) < 1e-3 &&
        Math.abs(next.y - target.current.y) < 1e-3 &&
        Math.abs(Math.log(next.zoom / Math.max(target.current.zoom, 1e-6))) <
          1e-3;
      if (!alreadyFlying) {
        target.current.x = next.x;
        target.current.y = next.y;
        target.current.zoom = next.zoom;
        // The clamp (F3) measures zoom against this fit. It must be the pose
        // the move actually lands on, or the resting camera can sit outside
        // its own limits and the first input rubber-bands it somewhere else.
        fitZoom.current = next.zoom;
        beginFlightRef.current();
        if (reduced) snapToTargetRef.current();
        invalidate();
      }
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

  const previousProjection = useRef(projection);
  useEffect(() => {
    target.current.tilt = projection === 'fixed-angle' ? 1 : 0;
    // A flight belongs to a projection CHANGE. This effect also re-runs when
    // its callbacks are rebuilt by a layout change, and starting a flight then
    // restarted the semantic flight already in progress a frame later.
    if (previousProjection.current !== projection) {
      previousProjection.current = projection;
      beginFlightRef.current();
    }
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
    const state = gesture.current;
    // The marquee is DOM (pixel-crisp, outside the canvas); its transform is
    // written directly per move — never through React state (guide rule 14).
    const positionBandOverlay = (clientX: number, clientY: number) => {
      const overlay = bandOverlayRef?.current;
      if (!overlay) return;
      const box = bandOverlayRect(
        state,
        clientX,
        clientY,
        element.getBoundingClientRect()
      );
      overlay.style.display = 'block';
      overlay.style.left = `${box.left}px`;
      overlay.style.top = `${box.top}px`;
      overlay.style.width = `${box.width}px`;
      overlay.style.height = `${box.height}px`;
    };
    const hideBandOverlay = () => {
      const overlay = bandOverlayRef?.current;
      if (overlay) overlay.style.display = 'none';
    };
    const beginPinch = () => {
      const points = [...state.touches.values()];
      if (points.length < 2) return;
      const first = points[0]!;
      const second = points[1]!;
      state.phase = 'pinch';
      hideBandOverlay();
      state.pinchDistance = Math.max(
        1,
        Math.hypot(second.x - first.x, second.y - first.y)
      );
      state.pinchZoom = target.current.zoom;
      state.pinchAnchor = worldAt(
        (first.x + second.x) / 2,
        (first.y + second.y) / 2
      );
      handlers.current.onManualCameraInput?.();
    };
    const onPointerDown = (event: PointerEvent) => {
      const action = boardPointerAction({
        pointerType: event.pointerType,
        button: event.button,
        touchSelectionMode: handlers.current.touchSelectionMode,
        canBandSelect: Boolean(handlers.current.onBandSelect),
      });
      if (action === 'ignore') return;
      if (event.pointerType === 'touch') {
        state.touches.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        element.setPointerCapture(event.pointerId);
        if (state.touches.size === 2) {
          beginPinch();
          return;
        }
      }
      state.pointerId = event.pointerId;
      element.setPointerCapture(event.pointerId);
      if (action === 'band') {
        state.phase = 'band';
        state.bandStart = { x: event.clientX, y: event.clientY };
        state.bandLast = { x: event.clientX, y: event.clientY };
        return;
      }
      state.phase = 'pan';
      state.panLast = { x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && state.touches.has(event.pointerId)) {
        state.touches.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        });
        if (state.touches.size >= 2) {
          const points = [...state.touches.values()];
          const first = points[0]!;
          const second = points[1]!;
          const distance = Math.max(
            1,
            Math.hypot(second.x - first.x, second.y - first.y)
          );
          const nextZoom = pinchZoomTarget(
            state.pinchZoom,
            state.pinchDistance,
            distance
          );
          const ratio = target.current.zoom / Math.max(nextZoom, 0.001);
          target.current.x =
            state.pinchAnchor.x -
            (state.pinchAnchor.x - target.current.x) * ratio;
          target.current.y =
            state.pinchAnchor.y -
            (state.pinchAnchor.y - target.current.y) * ratio;
          target.current.zoom = nextZoom;
          constrainTargetRef.current();
          beginDriftRef.current(NUDGE_LAMBDA);
          if (handlers.current.reduced) snapToTargetRef.current();
          invalidate();
          return;
        }
      }
      if (state.phase === 'band') {
        state.bandLast = { x: event.clientX, y: event.clientY };
        positionBandOverlay(event.clientX, event.clientY);
        return;
      }
      if (state.phase !== 'pan') return;
      const zoom = Math.max(effectiveBoardCameraZoom(current.current), 0.001);
      target.current.x -= (event.clientX - state.panLast.x) / zoom;
      target.current.y += (event.clientY - state.panLast.y) / zoom;
      constrainTargetRef.current();
      state.panLast = { x: event.clientX, y: event.clientY };
      beginDriftRef.current(NUDGE_LAMBDA);
      element.style.cursor = 'grabbing';
      handlers.current.onManualCameraInput?.();
      announceTargetViewportRef.current();
      if (handlers.current.reduced) snapToTargetRef.current();
      invalidate();
    };
    const releaseCapture = (pointerId: number) => {
      if (element.hasPointerCapture(pointerId)) {
        element.releasePointerCapture(pointerId);
      }
    };
    const endDrag = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        state.touches.delete(event.pointerId);
        if (state.phase === 'pinch') {
          if (state.touches.size < 2) endBoardGesture(state);
          hideBandOverlay();
          releaseCapture(event.pointerId);
          return;
        }
      }
      const phase = state.phase;
      // The marquee never outlives the hand that drew it, whatever the drag
      // selected — including nothing at all.
      hideBandOverlay();
      element.style.cursor = '';
      releaseCapture(event.pointerId);
      endBoardGesture(state);
      if (phase !== 'band') return;
      const endX =
        event.pointerType === 'touch' ? state.bandLast.x : event.clientX;
      const endY =
        event.pointerType === 'touch' ? state.bandLast.y : event.clientY;
      // A still click falls through to the piece/zone handlers.
      if (!bandGestureMoved(state, endX, endY)) return;
      const commit = handlers.current.onBandSelect;
      if (!commit) return;
      const from = worldAt(state.bandStart.x, state.bandStart.y);
      const to = worldAt(endX, endY);
      commit(bandBoardRect(from, to));
      if (suppressMissRef) suppressMissRef.current = performance.now();
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
      constrainTargetRef.current();
      beginDriftRef.current(NUDGE_LAMBDA);
      handlers.current.onManualCameraInput?.();
      announceTargetViewportRef.current();
      if (handlers.current.reduced) snapToTargetRef.current();
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
      // The board going away mid-drag is still the hand letting go: the
      // marquee is owned by the surface outside this canvas and would
      // otherwise be left on screen with no one listening to dismiss it.
      hideBandOverlay();
      element.style.cursor = '';
      if (state.pointerId !== null) releaseCapture(state.pointerId);
      for (const pointerId of state.touches.keys()) releaseCapture(pointerId);
      state.touches.clear();
      endBoardGesture(state);
    };
  }, [bandOverlayRef, gl, invalidate, projectionScratch, suppressMissRef]);

  useEffect(() => {
    const span = () => Math.max(layout.bounds.width, layout.bounds.height, 24);
    const focusRect = (rect: SpatialBoardRect) => {
      targetForRect(rect);
      if (reduced) snapToTarget();
      invalidate();
    };
    const cameraChanged = (manual = true) => {
      beginDriftRef.current(NUDGE_LAMBDA);
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
        fitZoom.current = next.zoom;
        beginFlightRef.current();
        if (reduced) snapToTarget();
        invalidate();
      },
      focusFleet() {
        const next = semanticBoardCameraTarget(target.current, layout.bounds, {
          width: size.width,
          height: size.height,
        });
        target.current.x = next.x;
        target.current.y = next.y;
        target.current.zoom = next.zoom;
        fitZoom.current = next.zoom;
        beginFlightRef.current();
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
          beginDriftRef.current(FOLLOW_LAMBDA);
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
        beginDriftRef.current(FOLLOW_LAMBDA);
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
        beginFlightRef.current();
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
    layout.bounds,
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
    const flight = flightFrom.current;
    let moving = false;
    if (flight && transitionClock) {
      const now = performance.now();
      const progress = boardTransitionProgress(transitionClock.current, now);
      const eased = boardTransitionEase(progress);
      current.current.x = flight.x + (target.current.x - flight.x) * eased;
      current.current.y = flight.y + (target.current.y - flight.y) * eased;
      // Zoom is multiplicative, so it mixes in log space. Mixing it linearly
      // made zooming in front-load and zooming out back-load the same journey,
      // which is why the two directions used to feel like different moves.
      current.current.zoom = mixBoardZoom(
        flight.zoom,
        target.current.zoom,
        eased
      );
      current.current.tilt =
        flight.tilt + (target.current.tilt - flight.tilt) * eased;
      moving = progress < 1;
      if (!moving) {
        flightFrom.current = null;
        settleBoardTransition(transitionClock.current, now);
      }
    } else {
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
      const nextZoom = dampBoardZoom(
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
      moving =
        Math.abs(nextX - target.current.x) > 0.001 ||
        Math.abs(nextY - target.current.y) > 0.001 ||
        Math.abs(nextZoom - target.current.zoom) > 0.001 ||
        Math.abs(nextTilt - target.current.tilt) > 0.001;
      current.current.x = moving ? nextX : target.current.x;
      current.current.y = moving ? nextY : target.current.y;
      current.current.zoom = moving ? nextZoom : target.current.zoom;
      current.current.tilt = moving ? nextTilt : target.current.tilt;
    }
    applyCamera(current.current);
    notifyViewport();
    if (moving || relaxing) state.invalidate();
  });

  return null;
});
