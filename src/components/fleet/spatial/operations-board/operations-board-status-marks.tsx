'use client';

import { Instances, Instance } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SpatialBoardLens, SpatialBoardPiece } from '@exawatt/ui-model';
import {
  STATUS_LIGHT_ACTIVE_ROTATION_SECONDS,
  workStateReading,
  type StatusLightReading,
} from '@/components/status-light/protocol';
import type { SpatialThemeSnapshot } from '../spatial-theme';
import { boardWorldPosition } from './operations-board-camera';
import {
  STATUS_MARK_GEOMETRY,
  pieceLensColor,
} from './operations-board-materials';

/** The production batched D40 marks. Neutral inspection is an independent
 * static layer on the same anchors, scales, and emergence clock. */
export function StatusMarkLayer({
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
  const unread = agentPieces.filter(piece => piece.unread);
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
      {unread.length > 0 && (
        <Instances
          geometry={STATUS_MARK_GEOMETRY.unread}
          limit={1024}
          range={unread.length}
          renderOrder={3}
        >
          <meshBasicMaterial
            toneMapped={false}
            transparent
            opacity={1}
            depthWrite={false}
          />
          {unread.map(piece => (
            <Instance
              {...instance(piece)}
              key={`unread:${piece.id}`}
              color={theme.labelMuted}
              position={boardWorldPosition(piece, 1.01)}
              raycast={() => null}
            />
          ))}
        </Instances>
      )}
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
