'use client';

import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { SpatialBoardLens, SpatialBoardPiece } from '@exawatt/ui-model';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  workStateReading,
  type StatusLightReading,
} from '@/components/status-light/protocol';
import {
  sameStatusMarkPaint,
  sameStatusMarkPiecePaint,
} from './status-mark-subjects';
import {
  statusMarkRendering,
  type StatusMarkDepthPolicy,
} from './status-mark-rendering';
import type { SpatialThemeSnapshot } from '../spatial-theme';
import { boardWorldPosition } from './operations-board-camera';
import { AMBIENT_FRAME_DELTA_CAP_S } from '@/lib/frame-demand/frame-scheduler';
import {
  useAmbientDemand,
  useFrameScheduler,
} from '@/lib/frame-demand/frame-demand';
import {
  STATUS_MARK_GEOMETRY,
  pieceLensColor,
} from './operations-board-materials';

/** The production batched D40 marks. Neutral inspection is an independent
 * static layer on the same anchors, scales, and emergence clock. Working
 * Agents hold the canvas's ambient demand while they exist; the canvas's
 * cadence says how often their rotors paint, and `parked` rests them at
 * zero. */
export function StatusMarkLayer({
  pieces,
  lens,
  theme,
  emergenceScale,
  depthPolicy = 'scene',
}: {
  pieces: SpatialBoardPiece[];
  depthPolicy?: StatusMarkDepthPolicy;
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
  /** Per-frame scale for a piece's marks (V3.7 emergence); 1 when settled. */
  emergenceScale?: (pieceId: string, nowMs: number) => number;
}) {
  const rotorRefs = useRef(new Map<string, THREE.Object3D>());
  // Every mark instance a piece owns, so its light scales with its body.
  const markRefs = useRef(new Map<string, Set<THREE.Object3D>>());
  const collectMark = useCallback((pieceId: string, rotor = false) => {
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
  }, []);
  const sizeById = useMemo(
    () => new Map(pieces.map(piece => [piece.id, piece.size])),
    [pieces]
  );
  // The claim follows the data, not the frames: a Working Agent keeps the
  // canvas painting even through a frame in which its rotor is re-mounting
  // (BUG-300). Its readout says how many Working Agents the marks were
  // given and how many rotors are attached (BUG-113).
  const working = useMemo(
    () =>
      pieces.filter(
        piece =>
          piece.kind === 'agent' && workStateReading(piece.status) === 'active'
      ).length,
    [pieces]
  );
  const workingRef = useRef(working);
  workingRef.current = working;
  const [readout] = useState(() => () => ({
    working: workingRef.current,
    rotors: rotorRefs.current.size,
  }));
  useAmbientDemand('rotors', working > 0, readout);
  const frames = useFrameScheduler();
  useFrame((_, delta) => {
    if (emergenceScale) {
      // The emergence owner's deadline paints every in-flight scale.
      const now = performance.now();
      for (const [pieceId, set] of markRefs.current) {
        const size =
          (sizeById.get(pieceId) ?? 1) * emergenceScale(pieceId, now);
        for (const mark of set) mark.scale.set(size, size, 1);
      }
    }
    if (rotorRefs.current.size === 0) return;
    if (frames.policy.ambient === 'parked') {
      for (const rotor of rotorRefs.current.values()) rotor.rotation.z = 0;
      return;
    }
    const step =
      (Math.min(delta, AMBIENT_FRAME_DELTA_CAP_S) * Math.PI * 2) /
      STATUS_LIGHT_ACTIVE_ROTATION_SECONDS;
    // Power is a cadence, never a freeze: the scheduler paints every
    // refresh on AC and on a bounded timer on battery or weak hardware.
    for (const rotor of rotorRefs.current.values()) {
      rotor.rotation.z = (rotor.rotation.z - step) % (Math.PI * 2);
    }
  });

  return (
    <StatusMarkInstances
      pieces={pieces}
      lens={lens}
      theme={theme}
      collectMark={collectMark}
      depthPolicy={depthPolicy}
    />
  );
}
type MarkInstancesProps = {
  depthPolicy: StatusMarkDepthPolicy;
  pieces: SpatialBoardPiece[];
  lens: SpatialBoardLens;
  theme: SpatialThemeSnapshot;
  collectMark: (
    pieceId: string,
    rotor?: boolean
  ) => (instance: THREE.Object3D | null) => void;
};

/** Animation stays live outside this static scene boundary. Unrelated source
 * metadata must not reconcile hundreds of Drei instances every clock tick. */
const StatusMarkInstances = memo(
  function StatusMarkInstances({
    pieces,
    lens,
    theme,
    collectMark,
    depthPolicy,
  }: MarkInstancesProps) {
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
    const unread = agentPieces.filter(piece => piece.unread);
    const geometries = STATUS_MARK_GEOMETRY;

    const shared = { lens, theme, collectMark, depthPolicy };
    const rendering = statusMarkRendering(depthPolicy);
    return (
      <>
        <MarkCohort
          {...shared}
          pieces={unread}
          geometry={geometries.unread}
          limit={1024}
          order={rendering.unread}
          color={theme.labelMuted}
          z={1.01}
        />
        <MarkCohort
          {...shared}
          pieces={agentPieces}
          geometry={geometries.backing}
          limit={1024}
          order={rendering.backing}
          color={theme.markBacking}
          z={0.91}
        />
        <MarkCohort
          {...shared}
          pieces={rotating}
          geometry={geometries.ring}
          opacity={0.98}
        />
        <MarkCohort
          {...shared}
          pieces={signalDisks}
          geometry={geometries.signal}
          opacity={0.98}
        />
        <MarkCohort
          {...shared}
          pieces={off}
          geometry={geometries.offSegment}
          limit={1024}
          segments={4}
        />
        <MarkCohort
          {...shared}
          pieces={unreported}
          geometry={geometries.socketRing}
          limit={1024}
          opacity={0.35}
        />
        <MarkCohort
          {...shared}
          pieces={unreported}
          geometry={geometries.noReadingBar}
          limit={1024}
        />
        <MarkCohort
          {...shared}
          pieces={rotating}
          geometry={geometries.rotor}
          opacity={0.84}
          rotor
        />
        <MarkCohort
          {...shared}
          pieces={result}
          geometry={geometries.check}
          color={theme.canvas}
          materialColor={theme.canvas}
          order={rendering.cutout}
          z={0.97}
          opacity={0.98}
        />
        <MarkCohort
          {...shared}
          pieces={needsYou}
          geometry={geometries.dot}
          color={theme.canvas}
          materialColor={theme.canvas}
          order={rendering.cutout}
          z={0.97}
          opacity={0.98}
        />
        <MarkCohort
          {...shared}
          pieces={fault}
          geometry={geometries.cross}
          color={theme.canvas}
          materialColor={theme.canvas}
          order={rendering.cutout}
          z={0.97}
          opacity={0.98}
        />
      </>
    );
  },
  (previous, next) =>
    previous.collectMark === next.collectMark &&
    previous.depthPolicy === next.depthPolicy &&
    previous.theme === next.theme &&
    previous.lens === next.lens &&
    sameStatusMarkPaint(previous.pieces, next.pieces, next.lens)
);

type MarkInstanceProps = Omit<MarkInstancesProps, 'pieces' | 'depthPolicy'> & {
  piece: SpatialBoardPiece;
  color?: string;
  z?: number;
  angle?: number;
  rotor?: boolean;
};
const noRaycast = () => null;
/** A changed reading updates its own marks without reattaching every other
 * instance ref in the draw cohort. */
const MarkInstance = memo(
  function MarkInstance({
    piece,
    lens,
    theme,
    collectMark,
    color,
    z = 0.94,
    angle = 0,
    rotor = false,
  }: MarkInstanceProps) {
    const ref = useMemo(
      () => collectMark(piece.id, rotor),
      [collectMark, piece.id, rotor]
    );
    return (
      <Instance
        name={`mark:${piece.id}`}
        ref={ref}
        position={boardWorldPosition(piece, z)}
        scale={[piece.size, piece.size, 1]}
        color={color ?? pieceLensColor(piece, lens, theme)}
        rotation={[0, 0, angle]}
        raycast={noRaycast}
      />
    );
  },
  (previous, next) =>
    previous.collectMark === next.collectMark &&
    previous.theme === next.theme &&
    previous.lens === next.lens &&
    previous.color === next.color &&
    previous.z === next.z &&
    previous.angle === next.angle &&
    previous.rotor === next.rotor &&
    sameStatusMarkPiecePaint(previous.piece, next.piece, next.lens)
);

type MarkCohortProps = MarkInstancesProps & {
  geometry: THREE.BufferGeometry;
  color?: string;
  materialColor?: string;
  z?: number;
  rotor?: boolean;
  opacity?: number;
  limit?: number;
  order?: number;
  segments?: number;
};
/** A draw cohort retains its React instance tree when another reading changes.
 * The backing and cutout cohorts consume only position, size and fixed paint. */
const MarkCohort = memo(
  function MarkCohort({
    pieces,
    lens,
    theme,
    collectMark,
    geometry,
    color,
    materialColor,
    z,
    rotor,
    opacity = 1,
    limit = 256,
    order,
    depthPolicy,
    segments = 1,
  }: MarkCohortProps) {
    if (!pieces.length) return null;
    const rendering = statusMarkRendering(depthPolicy);
    return (
      <Instances
        geometry={geometry}
        limit={limit}
        range={pieces.length * segments}
        renderOrder={order ?? rendering.glyph}
      >
        {/* v2 annotations ignore decorative tile depth; v1 keeps scene depth. */}
        <meshBasicMaterial
          color={materialColor}
          toneMapped={false}
          transparent
          opacity={opacity}
          depthTest={rendering.depthTest}
          depthWrite={rendering.depthWrite}
        />
        {pieces.flatMap(piece =>
          Array.from({ length: segments }, (_, segment) => (
            <MarkInstance
              key={`${piece.id}:${segment}`}
              piece={piece}
              lens={lens}
              theme={theme}
              collectMark={collectMark}
              color={color}
              z={z}
              rotor={rotor}
              angle={(segment * Math.PI) / 2}
            />
          ))
        )}
      </Instances>
    );
  },
  (previous, next) =>
    previous.collectMark === next.collectMark &&
    previous.theme === next.theme &&
    previous.lens === next.lens &&
    previous.depthPolicy === next.depthPolicy &&
    previous.geometry === next.geometry &&
    previous.color === next.color &&
    previous.materialColor === next.materialColor &&
    previous.z === next.z &&
    previous.rotor === next.rotor &&
    previous.opacity === next.opacity &&
    previous.limit === next.limit &&
    previous.order === next.order &&
    previous.segments === next.segments &&
    previous.pieces.length === next.pieces.length &&
    previous.pieces.every((piece, index) => {
      const other = next.pieces[index]!;
      return next.color !== undefined
        ? piece.id === other.id &&
            piece.x === other.x &&
            piece.y === other.y &&
            piece.size === other.size
        : sameStatusMarkPiecePaint(piece, other, next.lens);
    })
);
