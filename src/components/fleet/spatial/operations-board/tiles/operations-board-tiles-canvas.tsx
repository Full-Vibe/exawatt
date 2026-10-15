'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import type * as THREE from 'three';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type {
  TileFrame,
  TileRendererProps,
} from '@/components/tiles/tile-contract';
import type { CrustMaterialId } from '@/components/tiles/crust-materials';
import { DEFAULT_MOTION } from '@/components/tiles/crust-motion';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import { BoardCameraRig } from '../operations-board-camera-rig';
import type { OperationsBoardCanvas } from '../operations-board-canvas';
import { BoardField, BoardTransitionProvider } from '../operations-board-field';
import { ZoneLayer } from '../operations-board-zone-layer';
import { AgentControls, ProjectControls } from '../operations-board-controls';
import { createBoardHoverStore } from '../operations-board-hover';
import { createZoneLabelTierStore } from '../operations-board-label-tier';
import { useLowPowerMode, useReducedMotion } from '../operations-board-env';
import {
  createAmbientFrameScheduler,
  resolveAmbientCadence,
  type AmbientMotion,
} from '../operations-board-ambient';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { boardTileModel } from './board-tiles-model';

export type BoardTileMaterial = Extract<
  CrustMaterialId,
  'gummy' | 'acrylic' | 'anodized'
>;
export type OperationsBoardTilesProps = ComponentProps<
  typeof OperationsBoardCanvas
> & {
  material?: BoardTileMaterial;
  greybox?: boolean;
  sourceMarks?: Readonly<Record<string, string>>;
};

const PRODUCT_MARKS = { paths: HARNESS_MARK_PATHS, tone: harnessMarkTone };

const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const NO_MOTION = {
  sheen: false,
  breathe: false,
  wander: false,
  pulse: false,
  spin: false,
  lift: 'still',
} as const;

function RefreshScene({ identity }: { identity: unknown }) {
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => invalidate(), [identity, invalidate]);
  return null;
}

/** One host cadence for both Working motion and the initial spring settle. */
function CadencedTiles({
  ambient,
  ...props
}: TileRendererProps & { ambient: AmbientMotion }) {
  const invalidate = useThree(state => state.invalidate);
  const settleUntil = useRef(0);
  const requestFrame = useCallback(() => {
    settleUntil.current = performance.now() + 1600;
    invalidate();
  }, [invalidate]);
  const moving =
    !props.reducedMotion && props.tiles.some(tile => tile.status === 'active');
  useEffect(requestFrame, [
    requestFrame,
    props.tiles,
    props.readFrame,
    props.material,
    ambient,
  ]);
  useFrame(() => {
    if (ambient.cadence === 'parked') return;
    if (performance.now() < settleUntil.current) invalidate();
    else if (moving) ambient.requestFrame(invalidate);
  });
  return (
    <TileRenderer
      {...props}
      reducedMotion={props.reducedMotion || ambient.cadence === 'parked'}
      requestFrame={requestFrame}
    />
  );
}

/** V4.1 P3 review canvas. Same input/handle contract and camera as v1; it is
 * mounted only by the bench until the operator accepts the look. P4 owns the
 * registry, product preference read, full keyboard/entry/delegation parity. */
export function OperationsBoardTilesCanvas({
  layout,
  theme,
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
  const model = useMemo(
    () => boardTileModel(layout, sourceMarks),
    [layout, sourceMarks]
  );
  const tiles = useMemo(
    () => [
      ...model.ground,
      ...model.ghosts,
      ...model.agents,
      ...model.population,
    ],
    [model]
  );
  const ghostIds = useMemo(
    () => new Set(model.ghosts.map(tile => tile.id)),
    [model]
  );
  const groundIds = useMemo(
    () => new Set(model.ground.map(tile => tile.id)),
    [model]
  );
  const frame = useMemo<TileFrame>(
    () => ({
      focusId: layout.selectedAgentId,
      selection: multiSelection ?? EMPTY_SELECTION,
      tileGhost: id => ghostIds.has(id),
      tilePresent: id => !ghostIds.has(id),
      tileAgent: id => !ghostIds.has(id) && !groundIds.has(id),
    }),
    [ghostIds, groundIds, layout.selectedAgentId, multiSelection]
  );
  const readFrame = useCallback(() => frame, [frame]);
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
          <group rotation={[Math.PI / 2, 0, 0]}>
            <CadencedTiles
              ambient={ambient}
              tiles={tiles}
              surface="plane"
              theme={theme}
              material={greybox ? 'matte' : material}
              shape={greybox || model.agents.length === 0 ? 'hex' : 'rounded'}
              mark={greybox ? 'off' : 'relief'}
              motion={greybox ? NO_MOTION : DEFAULT_MOTION}
              signal="paint"
              readFrame={readFrame}
              marks={PRODUCT_MARKS}
              reducedMotion={reduced}
              calmAttention
              transmission={
                layout.altitude !== 'fleet' &&
                !lowPower &&
                !theme.reducedTransparency
              }
            />
          </group>
          <ProjectControls
            zones={zones}
            altitude={layout.altitude}
            focusedProjectId={layout.focusedProjectId}
            labelTierStore={labels}
            reduced={reduced}
            lens="status"
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
        </BoardField>
      </BoardTransitionProvider>
    </Canvas>
  );
}
