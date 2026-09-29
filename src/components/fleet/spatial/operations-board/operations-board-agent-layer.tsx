'use client';

/**
 * Individual Agent pieces and their D40 status marks, selection and candidate
 * treatments, stopped-Agent outlines, and the multi-selection layer. The
 * emergence tracker and the mark refs travel together here: a piece and its
 * mark must scale as one thing.
 */

import { Instances, Instance, Line, useCursor } from '@react-three/drei';
import { type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentRef,
} from 'react';
import * as THREE from 'three';
import {
  type SpatialBoardDelegationUnit,
  type SpatialBoardLayout,
  type SpatialBoardLens,
  type SpatialBoardPiece,
} from '@exawatt/ui-model';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  workStateReading,
  type StatusLightReading,
} from '@/components/status-light/protocol';
import {
  createEmergenceTracker,
  type EmergenceTracker,
} from './operations-board-emergence';
import {
  useBoardFocusRecession,
} from './operations-board-field';
import {
  type SpatialThemeSnapshot,
} from '../spatial-theme';
import {
  boardRectCenter as rectCenter,
  boardWorldPoint,
  boardWorldPosition,
} from './operations-board-camera';
import {
  delegationStatusPieces,
} from './delegation-roster';
import type {
  BoardAgentCandidate,
} from './operations-board-presentation';
import {
  AGENT_HEX_GEOMETRY,
  FOCUS_RECESSION_MIX,
  STATUS_MARK_GEOMETRY,
  pieceLensColor,
} from './operations-board-materials';
import {
  DelegationUnitLayer,
  useSettledDelegationUnits,
} from './operations-board-delegation-layer';
import {
  useBoardHoverSlice,
  type BoardHoverStore,
} from './operations-board-hover';
import { statusMarkSubjects } from './status-mark-subjects';

/**
 * Batched spatial sibling of the DOM StatusLight. Project identity stays on
 * zone edges; every Agent piece carries one exact protocol color and shape.
 * Only Active rotors invalidate the demand loop, at the shared DOM cadence.
 */

function StatusMarkLayer({
  pieces,
  active,
  lens,
  theme,
  emergenceScale,
}: {
  pieces: SpatialBoardPiece[];
  active: boolean;
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
  /** Per-frame scale for a piece's marks (V3.7 emergence); 1 when settled. */
  emergenceScale?: (pieceId: string, nowMs: number) => number;
}) {
  const rotorRefs = useRef(new Map<string, THREE.Object3D>());
  // Every mark instance a piece owns, so its light scales with its body.
  const markRefs = useRef(new Map<string, Set<THREE.Object3D>>());
  const collectMark = (pieceId: string, rotor = false) => {
    let attached: THREE.Object3D | null = null;
    return (instance: THREE.Object3D | null) => {
      if (attached) {
        const set = markRefs.current.get(pieceId);
        set?.delete(attached);
        if (set?.size === 0) markRefs.current.delete(pieceId);
        if (rotor && rotorRefs.current.get(pieceId) === attached) {
          rotorRefs.current.delete(pieceId);
        }
      }
      attached = instance;
      if (!instance) return;
      let set = markRefs.current.get(pieceId);
      if (!set) {
        set = new Set();
        markRefs.current.set(pieceId, set);
      }
      set.add(instance);
      if (rotor) rotorRefs.current.set(pieceId, instance);
    };
  };
  const sizeById = useMemo(
    () => new Map(pieces.map(piece => [piece.id, piece.size])),
    [pieces]
  );
  const agentPieces = pieces.filter(piece => piece.kind === 'agent');
  const byState = (state: StatusLightReading) =>
    agentPieces.filter(piece => workStateReading(piece.status) === state);
  const off = byState('off');
  const unreported = byState('unreported');
  const rotating = byState('active');
  const result = byState('result');
  const needsYou = byState('needs-you');
  const fault = byState('fault');
  const signalDisks = [...result, ...needsYou, ...fault];
  const geometries = STATUS_MARK_GEOMETRY;

  useFrame((state, delta) => {
    if (emergenceScale) {
      const now = performance.now();
      let emerging = false;
      for (const [pieceId, set] of markRefs.current) {
        const factor = emergenceScale(pieceId, now);
        // Apply both endpoints, but only in-flight scales need another frame.
        if (factor > 0 && factor < 1) emerging = true;
        const size = (sizeById.get(pieceId) ?? 1) * factor;
        for (const mark of set) mark.scale.set(size, size, 1);
      }
      if (emerging) state.invalidate();
    }
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
    name: `mark:${piece.id}`,
    ref: collectMark(piece.id),
    position: boardWorldPosition(piece, 0.94),
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
          {/* The whole mark stack -- this plate and every mark above it --
              draws in the transparent pass (BUG-250). The hex bodies are
              transparent (they fade in) and three.js draws every opaque object
              first, so an opaque plate or mark that writes no depth was painted
              over by the body beneath it: Idle's arcs and the no-reading bar
              vanished into their hex, and the plate that carries each mark's
              contrast (design system: every mark sits on a canvas-colored
              plate) never showed. Inside the transparent pass, render order
              sequences body (0), plate (1), mark (2). */}
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={1}
            depthWrite={false}
          />
          {agentPieces.map(piece => (
            <Instance
              {...instance(piece)}
              color={theme.markBacking}
              key={`status-backing:${piece.id}`}
              position={boardWorldPosition(piece, 0.91)}
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
            transparent
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
      {unreported.length > 0 && (
        <Instances
          geometry={geometries.socketRing}
          limit={1024}
          range={unreported.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={0.35}
            depthWrite={false}
          />
          {unreported.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-unreported-ring:${piece.id}`}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
      {unreported.length > 0 && (
        <Instances
          geometry={geometries.noReadingBar}
          limit={1024}
          range={unreported.length}
          renderOrder={2}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={1}
            depthWrite={false}
          />
          {unreported.map(piece => (
            <Instance
              {...instance(piece)}
              key={`status-unreported-bar:${piece.id}`}
              raycast={() => null}
            />
          ))}
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
              ref={collectMark(piece.id, true)}
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
          renderOrder={2}
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
              position={boardWorldPosition(piece, 0.97)}
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
          renderOrder={2}
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
              position={boardWorldPosition(piece, 0.97)}
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
          renderOrder={2}
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
              position={boardWorldPosition(piece, 0.97)}
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
    <group ref={group} position={boardWorldPosition(piece, 0.78)}>
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

/**
 * Soft candidate feedback for the Agent the pointer or keyboard is about to
 * choose. The committed selection keeps its circular dashed reticle; this is
 * a solid, padded hex so feed-forward and selection cannot be confused. The
 * reticle contracts on press, giving mouse/touch-down visible weight without
 * moving the Agent's stable address.
 */
function AgentCandidateReticle({
  piece,
  pressed,
  reduced,
  theme,
}: {
  piece: SpatialBoardPiece;
  pressed: boolean;
  reduced: boolean;
  theme: SpatialThemeSnapshot;
}) {
  const group = useRef<THREE.Group>(null);
  const line = useRef<ComponentRef<typeof Line>>(null);
  const points = useMemo(() => {
    const result: Array<[number, number, number]> = [];
    for (let index = 0; index <= 6; index += 1) {
      const angle = -Math.PI / 2 + (index / 6) * Math.PI * 2;
      result.push([Math.cos(angle) * 0.68, Math.sin(angle) * 0.68, 0]);
    }
    return result;
  }, []);
  const restingScale = piece.size * (pressed ? 0.75 : 1);
  const restingOpacity = pressed ? 1 : 0.78;
  useFrame((state, delta) => {
    const target = group.current;
    const material = line.current?.material;
    if (!target || !material) return;
    const clamped = Math.min(delta, 0.05);
    const nextScale = reduced
      ? restingScale
      : THREE.MathUtils.damp(target.scale.x, restingScale, 14, clamped);
    const nextOpacity = reduced
      ? restingOpacity
      : THREE.MathUtils.damp(material.opacity, restingOpacity, 14, clamped);
    target.scale.setScalar(nextScale);
    material.opacity = nextOpacity;
    if (
      Math.abs(nextScale - restingScale) > 0.001 ||
      Math.abs(nextOpacity - restingOpacity) > 0.002
    ) {
      state.invalidate();
    }
  });
  return (
    <group
      ref={group}
      position={boardWorldPosition(piece, 0.82)}
      scale={reduced ? restingScale : piece.size * 1.08}
    >
      <Line
        ref={line}
        points={points}
        color={theme.selection}
        lineWidth={pressed ? 3.2 : 2.1}
        toneMapped={false}
        transparent
        opacity={reduced ? restingOpacity : 0}
        depthWrite={false}
        raycast={() => null}
      />
    </group>
  );
}

export const AgentPieceLayer = memo(function AgentPieceLayer({
  pieces,
  delegationUnits,
  hover,
  selectedDelegationUnitId,
  altitude,
  focusedProjectId,
  reduced,
  ambient,
  lens,
  onSelectAgent,
  onToggleAgentSelect,
  candidateTreatment,
  theme,
}: {
  pieces: SpatialBoardPiece[];
  delegationUnits: SpatialBoardDelegationUnit[];
  hover: BoardHoverStore;
  /** The delegated child arrow navigation currently sits on. */
  selectedDelegationUnitId: string | null;
  altitude: SpatialBoardLayout['altitude'];
  focusedProjectId: string | null;
  reduced: boolean;
  ambient: boolean;
  lens: SpatialBoardLens;
  onSelectAgent: (agentId: string) => void;
  onToggleAgentSelect?: (agentId: string) => void;
  candidateTreatment: BoardAgentCandidate;
  theme: SpatialThemeSnapshot;
}) {
  const hoveredAgentId = useBoardHoverSlice(hover, state => state.agentId);
  const pressedAgentId = useBoardHoverSlice(
    hover,
    state => state.pressedAgentId
  );
  // Aggregate pieces render as the instanced population dot field (V3.1),
  // never as per-piece bodies or DOM count labels.
  const visible = useMemo(
    () => pieces.filter(piece => piece.visible && piece.kind === 'agent'),
    [pieces]
  );
  const solid = useMemo(
    () => visible.filter(piece => piece.sessionState !== 'stopped'),
    [visible]
  );
  // Pieces that appear or disappear while the layer is mounted -- a Project
  // revealing its Agents at scale, or hiding them again -- scale in and out
  // on the board's transition policy instead of popping (V3.7). Departing
  // pieces stay rendered until they are gone; the tracker says which.
  const emergence = useRef<EmergenceTracker | null>(null);
  if (emergence.current === null) {
    emergence.current = createEmergenceTracker(
      solid.map(piece => piece.id),
      reduced ? 0 : undefined
    );
  }
  const lastPieceById = useRef(new Map<string, SpatialBoardPiece>());
  for (const piece of solid) lastPieceById.current.set(piece.id, piece);
  const [retiringIds, setRetiringIds] = useState<string[]>([]);
  const invalidate = useThree(state => state.invalidate);
  const previousReduced = useRef(reduced);
  useLayoutEffect(() => {
    // A changed motion preference snaps existing transitions, including a
    // departure. It must not inherit the duration captured on first mount.
    if (previousReduced.current !== reduced) {
      emergence.current = createEmergenceTracker(
        solid.map(piece => piece.id),
        reduced ? 0 : undefined
      );
      previousReduced.current = reduced;
    }
    const tracker = emergence.current!;
    tracker.reconcile(
      solid.map(piece => piece.id),
      performance.now()
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      const now = performance.now();
      const next = tracker.retiring(now);
      setRetiringIds(previous =>
        previous.length === next.length &&
        previous.every((id, i) => id === next[i])
          ? previous
          : next
      );
      invalidate();
      // Cleanup belongs to the React lifecycle, not the frame loop. Even if
      // rendering was suspended past the deadline, the final commit retires
      // the pieces. An early timer re-arms for the actual remaining interval.
      const remaining = tracker.remainingMs(now);
      if (remaining > 0) timer = setTimeout(settle, remaining);
    };
    settle();
    return () => clearTimeout(timer);
  }, [solid, reduced, invalidate]);
  useLayoutEffect(() => {
    // A completed departure stays at zero until React has detached its refs;
    // pruning it earlier would briefly restore its default scale of one.
    emergence.current!.prune(performance.now(), retiringIds);
    const retained = new Set([
      ...solid.map(piece => piece.id),
      ...retiringIds,
      ...emergence.current!.retiring(performance.now()),
    ]);
    for (const id of lastPieceById.current.keys()) {
      if (!retained.has(id)) lastPieceById.current.delete(id);
    }
  }, [solid, retiringIds]);
  const rendered = useMemo(() => {
    const ids = new Set(solid.map(piece => piece.id));
    const retiring: SpatialBoardPiece[] = [];
    for (const id of retiringIds) {
      if (ids.has(id)) continue;
      const piece = lastPieceById.current.get(id);
      if (piece) retiring.push(piece);
    }
    return retiring.length ? [...solid, ...retiring] : solid;
  }, [retiringIds, solid]);
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);
  const bodyMat = useRef<THREE.MeshLambertMaterial>(null);
  const bodyRefs = useRef(new Map<string, THREE.Object3D>());
  // Focus recession (V3.7): a neighbour's bodies mix toward the board on the
  // shared clock. One sampler per zone, one write per body per frame only
  // while the value is actually moving.
  const bodyZoneIds = useMemo(
    () => [...new Set(visible.map(piece => piece.projectId))],
    [visible]
  );
  const recession = useBoardFocusRecession(
    bodyZoneIds,
    altitude,
    focusedProjectId,
    reduced
  );
  const recessionScratch = useMemo(
    () => ({ a: new THREE.Color(), b: new THREE.Color() }),
    []
  );
  const lastBodyRecession = useRef(new Map<string, number>());
  const entranceClock = useRef<number | null>(reduced ? null : 0);
  const pieceGeometry = AGENT_HEX_GEOMETRY;
  // Keep the shipped cursor path local to this layer. The review treatment
  // additionally lifts candidate state to the canvas root so its WebGL and
  // DOM hit paths converge, but production should not rerender the whole
  // board merely because the pointer crossed an Agent.
  useCursor(hoveredMeshId != null);
  // Settled delegated children ride the parents' own D40 draws, so a child's
  // Active light is literally the same light — and costs no extra draw call.
  const settledDelegation = useSettledDelegationUnits(delegationUnits, reduced);
  const statusSubjects = useMemo(
    () => [
      ...statusMarkSubjects(rendered, visible),
      ...delegationStatusPieces(settledDelegation).map(piece =>
        piece.id === selectedDelegationUnitId
          ? { ...piece, selected: true }
          : piece
      ),
    ],
    [selectedDelegationUnitId, settledDelegation, rendered, visible]
  );
  const stoppedIds = useMemo(
    () =>
      new Set(
        visible
          .filter(piece => piece.sessionState === 'stopped')
          .map(piece => piece.id)
      ),
    [visible]
  );
  /** Per-frame scale for a piece from its emergence, 1 when settled. A
   *  stopped piece's mark holds its size while the body it sat on retires. */
  const emergenceScale = useCallback(
    (pieceId: string, nowMs: number) =>
      stoppedIds.has(pieceId)
        ? 1
        : emergence.current!.scaleOf(pieceId, nowMs),
    [stoppedIds]
  );

  // Entrance choreography (V2.4): pieces scale in with a radial slot stagger
  // while the material fades up. Because the layer now survives altitude
  // changes, this remains a board/data arrival signature and never replays on
  // Fleet → Project → Agent navigation.
  useFrame((state, delta) => {
    {
      const now = performance.now();
      const tracker = emergence.current!;
      // Always sample the final frame too: active() is already false at
      // the endpoint, while bodies may still hold the preceding frame's size.
      for (const piece of rendered) {
        const body = bodyRefs.current.get(piece.id);
        if (!body) continue;
        const scale = piece.size * tracker.scaleOf(piece.id, now);
        body.scale.set(scale, scale, 1);
      }
      if (tracker.active(now)) state.invalidate();
    }
    {
      const now = performance.now();
      let receding = false;
      for (const piece of visible) {
        const body = bodyRefs.current.get(piece.id) as
          | (THREE.Object3D & { color?: THREE.Color })
          | undefined;
        if (!body?.color) continue;
        const amount = recession(piece.projectId, now);
        const previous = lastBodyRecession.current.get(piece.id);
        if (previous !== undefined && Math.abs(previous - amount) < 0.002)
          continue;
        lastBodyRecession.current.set(piece.id, amount);
        recessionScratch.a.set(theme.unit);
        recessionScratch.b.set(theme.canvas);
        body.color.copy(
          recessionScratch.a.lerp(
            recessionScratch.b,
            amount * FOCUS_RECESSION_MIX
          )
        );
        if (amount > 0.001 && amount < 0.999) receding = true;
      }
      if (receding) state.invalidate();
    }
    if (entranceClock.current === null) {
      if (bodyMat.current) bodyMat.current.opacity = 1;
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

  // Selection is looked up over the same set the status marks draw, so a
  // walked-to child wears the board's own selection ring rather than being
  // reachable but unmarked.
  const selected = statusSubjects.find(piece => piece.selected);
  const candidateAgentId = pressedAgentId ?? hoveredAgentId;
  const candidate = candidateAgentId
    ? visible.find(piece => piece.agentId === candidateAgentId)
    : undefined;
  return (
    <group>
      <Instances geometry={pieceGeometry} limit={256} range={rendered.length}>
        <meshLambertMaterial
          ref={bodyMat}
          transparent
          opacity={reduced ? 1 : 0}
        />
        {rendered.map(piece => {
          const interactive = piece.kind === 'agent' && altitude !== 'fleet';
          return (
            <Instance
              key={piece.id}
              name={`body:${piece.id}`}
              ref={(instance: THREE.Object3D | null) => {
                if (instance) bodyRefs.current.set(piece.id, instance);
                else bodyRefs.current.delete(piece.id);
              }}
              position={boardWorldPosition(piece, 0.65)}
              scale={[piece.size, piece.size, 1]}
              color={theme.unit}
              onPointerOver={event => {
                if (!interactive) return;
                event.stopPropagation();
                setHoveredMeshId(piece.id);
                if (candidateTreatment === 'precision') {
                  hover.setAgent(piece.agentId);
                }
              }}
              onPointerOut={() => {
                setHoveredMeshId(null);
                if (candidateTreatment === 'precision') {
                  hover.setAgent(null);
                }
              }}
              onPointerDown={event => {
                if (
                  !interactive ||
                  !piece.agentId ||
                  event.button !== 0 ||
                  candidateTreatment !== 'precision'
                )
                  return;
                event.stopPropagation();
                hover.setPressed(piece.agentId);
              }}
              onPointerUp={() => {
                if (candidateTreatment === 'precision') {
                  hover.setPressed(null);
                }
              }}
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
        pieces={statusSubjects}
        active={ambient}
        lens={lens}
        theme={theme}
        emergenceScale={emergenceScale}
      />
      <DelegationUnitLayer
        units={delegationUnits}
        reduced={reduced}
        hover={hover}
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
      {candidateTreatment === 'precision' && candidate && (
        <AgentCandidateReticle
          key={`agent-candidate:${candidate.id}`}
          piece={candidate}
          pressed={pressedAgentId === candidate.agentId}
          reduced={reduced}
          theme={theme}
        />
      )}
    </group>
  );
});

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
      const center = boardWorldPoint(piece);
      const color = new THREE.Color(pieceLensColor(piece, lens, theme));
      for (let edge = 0; edge < 8; edge += 1) {
        const from = (edge / 8) * Math.PI * 2 + Math.PI / 8;
        const to = ((edge + 1) / 8) * Math.PI * 2 + Math.PI / 8;
        points.push(
          [
            center.x + Math.cos(from) * radius,
            center.y + Math.sin(from) * radius,
            0.72,
          ],
          [
            center.x + Math.cos(to) * radius,
            center.y + Math.sin(to) * radius,
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
export const MultiSelectionLayer = memo(function MultiSelectionLayer({
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
      const center = boardWorldPoint(piece);
      for (let segment = 0; segment < RING_SEGMENTS; segment += 1) {
        const from = (segment / RING_SEGMENTS) * Math.PI * 2;
        const to = ((segment + 1) / RING_SEGMENTS) * Math.PI * 2;
        result.push(
          [
            center.x + Math.cos(from) * radius,
            center.y + Math.sin(from) * radius,
            0.78,
          ],
          [
            center.x + Math.cos(to) * radius,
            center.y + Math.sin(to) * radius,
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
});
