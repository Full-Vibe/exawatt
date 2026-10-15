'use client';

import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { SpatialBoardPiece } from '@exawatt/ui-model';
import { boardWorldY } from './operations-board-camera';
import {
  createFleetAgentHitSelector,
  fleetAgentHitId,
} from './fleet-agent-hit-model';

/** Fleet's modifier-selection surface belongs to the board, not its visual
 * material. Only addressable bodies participate; population/ghosts never do. */
export const FleetAgentHitTargets = memo(function FleetAgentHitTargets({
  pieces,
  onToggleAgentSelect,
}: {
  pieces: readonly SpatialBoardPiece[];
  onToggleAgentSelect: (agentId: string) => void;
}) {
  const selectTargets = useMemo(() => createFleetAgentHitSelector(), []);
  const targets = selectTargets(pieces);
  return (
    <FleetHitInstances
      targets={targets}
      onToggleAgentSelect={onToggleAgentSelect}
    />
  );
});

const FleetHitInstances = memo(function FleetHitInstances({
  targets,
  onToggleAgentSelect,
}: {
  targets: readonly SpatialBoardPiece[];
  onToggleAgentSelect: (agentId: string) => void;
}) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const value = new THREE.CylinderGeometry(0.5, 0.56, 0.34, 6);
    value.rotateX(Math.PI / 2);
    return value;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    const node = mesh.current;
    if (!node) return;
    const matrix = new THREE.Matrix4();
    targets.forEach((piece, index) => {
      matrix.makeScale(piece.size, piece.size, 1);
      matrix.setPosition(piece.x, boardWorldY(piece.y), 0.65);
      node.setMatrixAt(index, matrix);
    });
    node.count = targets.length;
    node.instanceMatrix.needsUpdate = true;
    node.computeBoundingSphere();
    invalidate();
  }, [targets, invalidate]);
  const activate = (event: ThreeEvent<MouseEvent>) => {
    const agentId = fleetAgentHitId(targets, event);
    if (!agentId) return;
    event.stopPropagation();
    onToggleAgentSelect(agentId);
  };
  return (
    <instancedMesh
      ref={mesh}
      name="fleet-agent-hit-targets"
      args={[geometry, undefined, Math.max(1, targets.length)]}
      visible={false}
      onClick={activate}
      // Three's raycaster tests invisible meshes; the renderer skips them.
      // Keep the Agent ids alongside the slots for picking diagnostics.
      userData={{ agentIds: targets.map(piece => piece.agentId) }}
    >
      <meshBasicMaterial />
    </instancedMesh>
  );
});
