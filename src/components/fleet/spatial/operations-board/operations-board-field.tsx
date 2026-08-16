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
  boardFieldPoseAt,
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
  reduced,
  children,
}: {
  pieces: readonly SpatialBoardPiece[];
  altitude: SpatialBoardAltitude;
  reduced: boolean;
  children: ReactNode;
}) {
  const group = useRef<THREE.Group>(null);
  const clock = useBoardTransitionClock();
  const invalidate = useThree(state => state.invalidate);
  const carry = useRef<BoardFieldPose>(BOARD_FIELD_IDENTITY);
  const previousAltitude = useRef(altitude);
  const previousPositions = useRef(new Map<string, { x: number; y: number }>());

  useLayoutEffect(() => {
    // World y is up; layout y is down.
    const next = new Map(
      pieces.map(piece => [piece.id, { x: piece.x, y: -piece.y }])
    );
    const node = group.current;
    const altitudeChanged = previousAltitude.current !== altitude;
    previousAltitude.current = altitude;
    const previous = previousPositions.current;
    previousPositions.current = next;

    if (!node || reduced || !altitudeChanged || !clock) return;

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
    // No shared pieces means no continuity to preserve: cut rather than invent
    // a relationship between two unrelated boards.
    if (!fitted) return;

    carry.current = fitted;
    node.position.set(fitted.x, fitted.y, 0);
    node.scale.set(fitted.scale, fitted.scale, 1);
    beginBoardTransition(clock.current, performance.now());
    invalidate();
  }, [altitude, clock, invalidate, pieces, reduced]);

  useFrame(state => {
    const node = group.current;
    if (!node || reduced || !clock) return;
    const now = performance.now();
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
