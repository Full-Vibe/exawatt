'use client';

import { useFrame, useThree } from '@react-three/fiber';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
  type ReactNode,
} from 'react';
import type * as THREE from 'three';
import type { SpatialBoardAltitude, SpatialBoardPiece } from '@exawatt/ui-model';
import {
  BOARD_FIELD_IDENTITY,
  beginBoardTransition,
  cancelBoardTransition,
  boardFieldPoseAt,
  boardTransitionEase,
  boardFieldPoseMoved,
  boardTransitionProgress,
  carryBoardFieldPose,
  createBoardTransitionClock,
  isBoardTransitionActive,
  settleBoardTransition,
  type BoardFieldPose,
  type BoardTransitionClock,
} from './operations-board-transition';

/**
 * The board's single transition clock.
 *
 * Held in a ref rather than state on purpose: layers sample it inside
 * `useFrame`, and a transition must not cost a React render per frame.
 */
const BoardTransitionContext =
  createContext<RefObject<BoardTransitionClock> | null>(null);

export function BoardTransitionProvider({ children }: { children: ReactNode }) {
  const clock = useRef(createBoardTransitionClock());
  return (
    <BoardTransitionContext.Provider value={clock}>
      {children}
    </BoardTransitionContext.Provider>
  );
}

/**
 * Read the shared clock. Returns null outside a provider, which lets layers
 * that are also used in isolation (the gallery, tests) keep working.
 */
export function useBoardTransitionClock(): RefObject<BoardTransitionClock> | null {
  return useContext(BoardTransitionContext);
}

/** Is a semantic transition running right now? For layers that must stand down. */
export function useBoardTransitionActive(): () => boolean {
  const clock = useBoardTransitionClock();
  return useMemo(
    () => () =>
      clock ? isBoardTransitionActive(clock.current, performance.now()) : false,
    [clock]
  );
}

/**
 * The board field: every content layer under one transform.
 *
 * **Why one group.** The board is eight sibling layers -- grid, zone plates,
 * zone edges, pieces, population dots, selection, and the control overlays --
 * and each of them reads the same layout. When altitude changes the layout is
 * recomputed from scratch, so every layer's coordinates change at once. Before
 * this group existed only the piece layer carried any continuity: it eased from
 * its old positions while the plates beneath it jumped straight to their new
 * ones. That is what made the pieces look like they were sliding against their
 * own zones.
 *
 * Now the whole field is one object. It starts a transition wearing the pose
 * that makes the new layout land exactly where the old one was drawn, then
 * eases that pose to identity off the shared clock. Layers no longer animate
 * their own arrival, because there is nothing left for them to animate: the
 * field moved them, together, as one.
 */
export function BoardField({
  pieces,
  altitude,
  focusedProjectId,
  reduced,
  children,
}: {
  pieces: readonly SpatialBoardPiece[];
  altitude: SpatialBoardAltitude;
  focusedProjectId: string | null;
  reduced: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const clock = useBoardTransitionClock();
  const invalidate = useThree(state => state.invalidate);
  const carry = useRef<BoardFieldPose>(BOARD_FIELD_IDENTITY);
  // The semantic address: altitude AND focus. Either changing is one
  // semantic move, and the field is the single owner that starts its clock.
  const address = `${altitude}:${focusedProjectId ?? ''}`;
  const previousAddress = useRef(address);
  /** The transition this field last saw, so it can tell when the shared clock
   *  was restarted underneath it by the camera. */
  const seenStart = useRef<number | null>(null);
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    // World y is up; layout y is down.
    const next = new Map(
      pieces.map(piece => [piece.id, { x: piece.x, y: -piece.y }])
    );
    const node = group.current;
    const addressChanged = previousAddress.current !== address;
    previousAddress.current = address;
    const previous = previousPositions.current;
    previousPositions.current = next;

    if (!node || reduced || !addressChanged || !clock) return;

    // Fit against the pose the field is drawn at right now, so a change that
    // lands mid-flight continues from what the operator can see.
    const actual: BoardFieldPose = {
      x: node.position.x,
      y: node.position.y,
      scale: node.scale.x,
    };
    const fitted = carryBoardFieldPose(
      previous,
      pieces.map(piece => ({ id: piece.id, x: piece.x, y: -piece.y })),
      actual
    );
    // Under one geometry (V3.7) the fit is identity on every semantic move:
    // nothing moved, and the field's job is to START the shared clock that
    // the camera, the recession, and the reveals all sample. It still carries
    // a real pose when the lattice itself changed underneath the move.
    carry.current = fitted ?? BOARD_FIELD_IDENTITY;
    node.position.set(carry.current.x, carry.current.y, 0);
    node.scale.set(carry.current.scale, carry.current.scale, 1);
    // The camera is the primary owner: a hotkey starts its flight on the
    // keystroke's frame, and this commit arrives a few frames later. Join a
    // clock that is already running rather than restarting it under the
    // camera; start one only if nothing else has.
    if (!isBoardTransitionActive(clock.current, performance.now())) {
      beginBoardTransition(clock.current, performance.now());
    }
    invalidate();
  }, [address, clock, invalidate, pieces, reduced]);

  // Reduced motion can be switched on mid-flight. A field left frozen partway
  // through a carry would keep the whole board at the wrong size in the wrong
  // place for as long as the session lasts, so it takes its resting pose at
  // once instead of waiting for a transition it is no longer allowed to run.
  useLayoutEffect(() => {
    const node = group.current;
    if (!node || !reduced) return;
    carry.current = BOARD_FIELD_IDENTITY;
    seenStart.current = null;
    node.position.set(0, 0, 0);
    node.scale.set(1, 1, 1);
    if (clock) cancelBoardTransition(clock.current);
    invalidate();
  }, [clock, invalidate, reduced]);

  useFrame(state => {
    const node = group.current;
    if (!node || reduced || !clock) return;
    const now = performance.now();
    // The clock is shared with the camera, and a camera flight may restart it
    // while this field is still travelling. Carrying on from the pose the
    // field started with would rewind it visibly, so a restart re-reads where
    // the field actually IS and finishes the journey from there.
    if (clock.current.startedAt !== seenStart.current) {
      seenStart.current = clock.current.startedAt;
      if (clock.current.startedAt !== null) {
        carry.current = {
          x: node.position.x,
          y: node.position.y,
          scale: node.scale.x,
        };
      }
    }
    const progress = boardTransitionProgress(clock.current, now);
    const pose = boardFieldPoseAt(carry.current, progress);
    node.position.set(pose.x, pose.y, 0);
    node.scale.set(pose.scale, pose.scale, 1);
    if (progress < 1) {
      state.invalidate();
      return;
    }
    settleBoardTransition(clock.current, now);
    if (boardFieldPoseMoved(carry.current)) {
      carry.current = BOARD_FIELD_IDENTITY;
      node.position.set(0, 0, 0);
      node.scale.set(1, 1, 1);
    }
  });

  // Named so motion evals can read the field pose straight off the scene.
  return (
    <group ref={group} name="board-field">
      {children}
    </group>
  );
}

/**
 * How far each Project has receded from focus, 0 (in focus, or nothing is
 * focused) to 1 (a neighbour of the focused Project).
 *
 * V3.7: focus changes what a Project SHOWS, never where it sits. Neighbours
 * keep their hexes and recede -- bodies, plates, edges, and tethers mix
 * toward the board -- and the recession cross-fades on the shared transition
 * clock so it arrives with the camera rather than snapping ahead of it.
 * Status lights stay at full: attention is truth, and a blocked Agent next
 * door is still blocked.
 *
 * Returns a sampler for `useFrame`; it allocates nothing per frame.
 */
export function useBoardFocusRecession(
  zoneIds: readonly string[],
  altitude: SpatialBoardAltitude,
  focusedProjectId: string | null,
  reduced: boolean
): (zoneId: string, nowMs: number) => number {
  const clock = useBoardTransitionClock();
  // from/to per zone; `from` is re-read at the moment the target changes so a
  // change mid-fade continues from what is on screen.
  const state = useRef(new Map<string, { from: number; to: number }>());
  const seenStart = useRef<number | null>(null);
  const targetFor = (zoneId: string) =>
    altitude !== 'fleet' && focusedProjectId !== null && zoneId !== focusedProjectId
      ? 1
      : 0;
  const sample = useMemo(() => {
    return (zoneId: string, nowMs: number): number => {
      const entry = state.current.get(zoneId);
      if (!entry) return 0;
      if (reduced || !clock) return entry.to;
      const progress = boardTransitionProgress(clock.current, nowMs);
      const eased = boardTransitionEase(progress);
      return entry.from + (entry.to - entry.from) * eased;
    };
  }, [clock, reduced]);
  useLayoutEffect(() => {
    const now = performance.now();
    const map = state.current;
    for (const zoneId of zoneIds) {
      const to = targetFor(zoneId);
      const entry = map.get(zoneId);
      if (!entry) {
        map.set(zoneId, { from: to, to });
        continue;
      }
      if (entry.to === to) continue;
      entry.from = sample(zoneId, now);
      entry.to = to;
    }
    for (const zoneId of [...map.keys()]) {
      if (!zoneIds.includes(zoneId)) map.delete(zoneId);
    }
    seenStart.current = clock?.current.startedAt ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- targetFor closes over altitude/focus, listed below
  }, [altitude, focusedProjectId, zoneIds, sample, clock]);
  return sample;
}
