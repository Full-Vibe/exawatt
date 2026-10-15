'use client';

import { Canvas, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import type * as THREE from 'three';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import { selectSpatialDelegationUnits } from '@exawatt/ui-model';
import { BoardCameraRig } from '../operations-board-camera-rig';
import type { OperationsBoardCanvas } from '../operations-board-canvas';
import { BoardField, BoardTransitionProvider } from '../operations-board-field';
import { ZoneLayer } from '../operations-board-zone-layer';
import {
  AgentControls,
  DelegationControls,
  ProjectControls,
} from '../operations-board-controls';
import { createBoardHoverStore } from '../operations-board-hover';
import { createZoneLabelTierStore } from '../operations-board-label-tier';
import { useLowPowerMode, useReducedMotion } from '../operations-board-env';
import {
  createAmbientFrameScheduler,
  resolveAmbientCadence,
  type AmbientMotion,
} from '../operations-board-ambient';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { BoardTilesLayer } from './board-tiles-layer';

export type BoardTileMaterial = CrustMaterialId;
export type OperationsBoardTilesProps = ComponentProps<
  typeof OperationsBoardCanvas
> & {
  material?: BoardTileMaterial;
  greybox?: boolean;
  sourceMarks?: Readonly<Record<string, string>>;
};

function RefreshScene({ identity }: { identity: unknown }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => invalidate(), [identity, invalidate]);
  return null;
}

/** Fleet v2 implements the same board contract and camera handle as v1.
 * Presentation preferences and route/selection commands remain above it. */
export function OperationsBoardTilesCanvas({
  layout,
  theme,
  lens = 'status',
  onSelectDelegationChild,
  selectedDelegationUnitId = null,
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
  material = 'gummy',
  greybox = false,
  sourceMarks,
}: OperationsBoardTilesProps) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const { onBattery, visible } = useHostRenderPolicy();
  const cadence = resolveAmbientCadence({
    reduced,
    visible,
    lowPower,
    onBattery,
  });
  const [scheduler] = useState(createAmbientFrameScheduler);
  useEffect(() => () => scheduler.dispose(), [scheduler]);
  const ambient = useMemo<AmbientMotion>(
    () => ({
      cadence,
      requestFrame: invalidate => scheduler.request(cadence, invalidate),
    }),
    [cadence, scheduler]
  );
  const [hover] = useState(createBoardHoverStore);
  const [labels] = useState(() => createZoneLabelTierStore('full'));
  const onZoomChange = useCallback(
    (zoom: number) => labels.setZoom(zoom),
    [labels]
  );
  const suppressMissRef = useRef(0);
  const zones = useMemo(
    () => layout.zones.filter(zone => zone.visible),
    [layout.zones]
  );
  useEffect(
    () =>
      labels.setMinZoneWidth(
        Math.min(...zones.map(zone => zone.rect.width), 24)
      ),
    [labels, zones]
  );
  const delegationUnits = useMemo(
    () => selectSpatialDelegationUnits(layout),
    [layout]
  );
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 200 }}
      gl={{ antialias: true, preserveDrawingBuffer }}
      style={{ touchAction: 'none' }}
      onPointerMissed={event => {
        if (
          event.type === 'click' &&
          event.target instanceof HTMLCanvasElement &&
          performance.now() - suppressMissRef.current >= 250
        )
          onBackground();
      }}
      onCreated={({ gl, scene, camera }) => {
        // Per-canvas evidence avoids the global-last-canvas trap in comparison.
        const canvas = gl.domElement as HTMLCanvasElement & {
          boardEvidence?: {
            gl: THREE.WebGLRenderer;
            scene: THREE.Scene;
            camera: THREE.Camera;
          };
        };
        canvas.boardEvidence = { gl, scene, camera };
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
      data-board-view="v2"
      data-board-material={greybox ? 'greybox' : material}
    >
      <color attach="background" args={[theme.canvas]} />
      <RefreshScene identity={theme} />
      <RefreshScene identity={ambient} />
      <BoardTransitionProvider>
        <BoardCameraRig
          layout={layout}
          projection="fixed-angle"
          reduced={reduced}
          controllerRef={controllerRef}
          onViewportChange={onViewportChange}
          onZoomChange={onZoomChange}
          onBandSelect={onBandSelect}
          bandOverlayRef={bandOverlayRef}
          suppressMissRef={suppressMissRef}
          followSelection={followSelection}
          touchSelectionMode={touchSelectionMode}
          onManualCameraInput={onManualCameraInput}
          onClampEdges={onClampEdges}
        />
        <BoardField
          pieces={layout.pieces}
          altitude={layout.altitude}
          focusedProjectId={layout.focusedProjectId}
          reduced={reduced}
        >
          <group position={[0, 0, -1]}>
            <ZoneLayer
              zones={zones}
              altitude={layout.altitude}
              focusedProjectId={layout.focusedProjectId}
              reduced={reduced}
              onDrillProject={onDrillProject}
              onToggleZoneSelect={onToggleZoneSelect}
              hover={hover}
              theme={theme}
            />
          </group>
          <BoardTilesLayer
            layout={layout}
            theme={theme}
            ambient={ambient}
            reduced={reduced}
            lowPower={lowPower}
            material={material}
            greybox={greybox}
            sourceMarks={sourceMarks}
            hover={hover}
            multiSelection={multiSelection}
            delegationUnits={delegationUnits}
            selectedDelegationUnitId={selectedDelegationUnitId}
            lens={lens}
          />
          <ProjectControls
            zones={zones}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            labelTierStore={labels}
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
            onHoverChange={hover.setAgent}
            onPressedChange={hover.setPressed}
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
            onSelectDelegationChild={onSelectDelegationChild}
            onHoverChange={hover.setDelegation}
            reduced={reduced}
            theme={theme}
          />
        </BoardField>
      </BoardTransitionProvider>
    </Canvas>
  );
}
