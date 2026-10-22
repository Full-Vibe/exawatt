'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import {
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type * as THREE from 'three';
import type { OperationsBoardTilesProps } from '@/components/fleet/spatial/operations-board/tiles/operations-board-tiles-canvas';
import { BoardCameraRig } from '@/components/fleet/spatial/operations-board/operations-board-camera-rig';
import { BoardDisplayResolution } from '@/components/fleet/spatial/operations-board/operations-board-canvas';
import { BoardTransitionProvider } from '@/components/fleet/spatial/operations-board/operations-board-field';
import {
  AgentControls,
  DelegationControls,
} from '@/components/fleet/spatial/operations-board/operations-board-controls';
import {
  createBoardHoverStore,
  useBoardHoverSlice,
} from '@/components/fleet/spatial/operations-board/operations-board-hover';
import { StatusMarkLayer } from '@/components/fleet/spatial/operations-board/operations-board-status-marks';
import { StoppedAgentOutlines } from '@/components/fleet/spatial/operations-board/operations-board-agent-layer';
import { boardTileStatusSubjects } from '@/components/fleet/spatial/operations-board/tiles/board-tile-status';
import { boardWorldPosition } from '@/components/fleet/spatial/operations-board/operations-board-camera';
import {
  spatialProjectIdentityColor,
  spatialColorWithAlpha,
} from '@/components/fleet/spatial/spatial-theme';
import {
  useLowPowerMode,
  useReducedMotion,
} from '@/components/fleet/spatial/operations-board/operations-board-env';
import {
  createAmbientFrameScheduler,
  resolveAmbientCadence,
  type AmbientMotion,
} from '@/components/fleet/spatial/operations-board/operations-board-ambient';
import { useHostRenderPolicy } from '@/lib/host-power/use-host-render-policy';
import { TileRenderer } from '@/components/tiles/tile-renderer';
import type { TileFrame } from '@/components/tiles/tile-contract';
import { DEFAULT_MOTION } from '@/components/tiles/crust-motion';
import { HARNESS_MARK_PATHS } from '@/components/workspace/harness-icons';
import { harnessMarkTone } from '@/components/workspace/harness-mark-tones';
import { qualityModel } from './model';
import { PopulationStatusMarks } from '@/components/fleet/spatial/operations-board/operations-board-population-layer';
import { computePopulationDotField } from '@/components/fleet/spatial/operations-board/population-dots';
import { useBoardProjectLabels } from '@/components/fleet/spatial/operations-board/use-board-project-labels';
import type { ZoneLabelTierStore } from '@/components/fleet/spatial/operations-board/operations-board-label-tier';
import type { SpatialThemeSnapshot } from '@/components/fleet/spatial/spatial-theme';
import type { OperationsBoardHandle } from '@/components/fleet/spatial/operations-board/operations-board-camera-rig';

const MARKS = { paths: HARNESS_MARK_PATHS, tone: harnessMarkTone };
const EMPTY = new Set<string>();
const STILL = {
  sheen: false,
  breathe: false,
  wander: false,
  pulse: false,
  spin: false,
  lift: 'still',
} as const;
const GROUND_FRAME: TileFrame = {
  focusId: null,
  selection: EMPTY,
  tileAgent: () => false,
};
const readGround = () => GROUND_FRAME;
const readClock = () => performance.now() / 1000;

/** Gallery-only composition. Reuses the production camera, command targets,
 * materials, status protocol and host-power boundary; not a third Fleet view. */
export function QualityCanvas(props: OperationsBoardTilesProps) {
  const reduced = useReducedMotion();
  const lowPower = useLowPowerMode();
  const host = useHostRenderPolicy();
  const cadence = resolveAmbientCadence({
    reduced,
    lowPower,
    visible: host.ambientAllowed,
    onBattery: host.onBattery,
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
  return (
    <Canvas
      orthographic
      frameloop={host.renderAllowed ? 'demand' : 'never'}
      dpr={[1, 2]}
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 200 }}
      gl={{
        antialias: true,
        preserveDrawingBuffer: props.preserveDrawingBuffer,
      }}
      style={{ touchAction: 'none' }}
      aria-hidden="true"
      data-board-view="quality-study"
      data-board-material={props.material}
      onCreated={({ gl, scene, camera }) => {
        (
          gl.domElement as HTMLCanvasElement & {
            boardEvidence: {
              gl: THREE.WebGLRenderer;
              scene: THREE.Scene;
              camera: THREE.Camera;
            };
          }
        ).boardEvidence = { gl, scene, camera };
      }}
    >
      <color attach="background" args={[props.theme.canvas]} />
      <BoardDisplayResolution lowPower={lowPower} />
      <BoardTransitionProvider>
        <QualityScene
          {...props}
          reduced={reduced}
          ambient={ambient}
          transmission={
            !lowPower && !host.onBattery && !props.theme.reducedTransparency
          }
        />
      </BoardTransitionProvider>
    </Canvas>
  );
}

function QualityScene({
  layout,
  theme,
  material = 'gummy',
  sourceMarks = {},
  controllerRef,
  onDrillProject,
  onSelectAgent,
  onSelectDelegationChild,
  multiSelection,
  onToggleAgentSelect,
  reduced,
  ambient,
  transmission,
}: OperationsBoardTilesProps & {
  reduced: boolean;
  ambient: AmbientMotion;
  transmission: boolean;
}) {
  const invalidate = useThree(state => state.invalidate);
  const scene = useThree(state => state.scene);
  useLayoutEffect(() => {
    // The shared tiles are authored on XZ and rotated into the board's XY
    // world. Reflect the same studio in that basis, like the local lights.
    const previous = scene.environmentRotation.clone();
    scene.environmentRotation.set(Math.PI / 2, 0, 0);
    invalidate();
    return () => {
      scene.environmentRotation.copy(previous);
    };
  }, [scene, invalidate]);
  const model = useMemo(
    () => qualityModel(layout, sourceMarks),
    [layout, sourceMarks]
  );
  const population = useMemo(
    () => computePopulationDotField(layout.zones, layout.pieces),
    [layout.zones, layout.pieces]
  );
  const labels = useBoardProjectLabels(model.territories);
  const framing = `${layout.altitude}:${layout.focusedProjectId}:${layout.stats.sourceAgentCount}`;
  const lastFraming = useRef('');
  const frameSmallFleet = useCallback(
    (handle: OperationsBoardHandle) => {
      if (lastFraming.current === framing) return;
      lastFraming.current = framing;
      if (model.territories.length === 1) handle.zoom(2.4);
    },
    [framing, model.territories.length]
  );
  const [hover] = useState(createBoardHoverStore);
  const hoveredId = useBoardHoverSlice(hover, value => value.agentId);
  const pressedId = useBoardHoverSlice(hover, value => value.pressedAgentId);
  const agentIds = useMemo(
    () =>
      new Set(model.tiles.filter(tile => tile.agentId).map(tile => tile.id)),
    [model]
  );
  const frame = useMemo<TileFrame>(
    () => ({
      focusId: null,
      selection: multiSelection ?? EMPTY,
      hoveredId,
      pressedId,
      tileAgent: id => agentIds.has(id),
    }),
    [multiSelection, hoveredId, pressedId, agentIds]
  );
  const readFrame = useCallback(() => frame, [frame]);
  const onMotionFrame = useCallback(
    (settling: boolean, working: boolean) => {
      if (settling || working) ambient.requestFrame(invalidate);
    },
    [ambient, invalidate]
  );
  useEffect(() => invalidate(), [invalidate, theme, ambient, frame, model]);
  const suppressMiss = useRef(0);
  const subjects = useMemo(
    () =>
      boardTileStatusSubjects([
        ...layout.pieces.filter(
          piece => piece.visible && piece.kind === 'agent'
        ),
        ...model.children,
      ]),
    [layout.pieces, model.children]
  );
  const tethers = useMemo(
    () =>
      layout.delegationUnits.flatMap(unit => [
        boardWorldPosition({ x: unit.tether.x1, y: unit.tether.y1 }, 0.06),
        boardWorldPosition({ x: unit.tether.x2, y: unit.tether.y2 }, 0.06),
      ]),
    [layout.delegationUnits]
  );
  return (
    <>
      <BoardCameraRig
        layout={model.cameraLayout}
        projection="fixed-angle"
        reduced={reduced}
        controllerRef={controllerRef}
        onControllerReady={frameSmallFleet}
        onZoomChange={labels.onZoomChange}
        followSelection={false}
        touchSelectionMode={false}
        suppressMissRef={suppressMiss}
      />
      <group rotation={[Math.PI / 2, 0, 0]}>
        <TileRenderer
          tiles={model.ground}
          surface="plane"
          theme={theme}
          material="glazed"
          shape="hex"
          detail="coarse"
          mark="off"
          motion={STILL}
          signal="paint"
          readFrame={readGround}
          marks={MARKS}
          reducedMotion
          lighting={false}
          interactive={false}
          transmission={false}
          staticInstances
        />
        <TileRenderer
          tiles={model.tiles}
          surface="plane"
          theme={theme}
          material={material}
          shape="rounded"
          detail="adaptive"
          mark="relief"
          motion={DEFAULT_MOTION}
          signal="paint"
          light="studio"
          readFrame={readFrame}
          readClock={readClock}
          marks={MARKS}
          reducedMotion={reduced || ambient.cadence === 'parked'}
          calmAttention
          interactive={false}
          requestFrame={invalidate}
          onMotionFrame={onMotionFrame}
          transmission={transmission && model.tiles.length < 700}
        />
      </group>
      {tethers.length > 0 && (
        <Line
          points={tethers}
          segments
          color={theme.labelMuted}
          lineWidth={1}
          transparent
          opacity={0.45}
          toneMapped={false}
          depthWrite={false}
          raycast={() => null}
        />
      )}
      <StatusMarkLayer
        pieces={subjects}
        theme={theme}
        ambient={ambient}
        lens="status"
        depthPolicy="overlay"
      />
      <PopulationStatusMarks
        depthPolicy="overlay"
        field={population}
        lens="status"
        ambient={false}
        theme={theme}
        backing
      />
      <StoppedAgentOutlines
        pieces={layout.pieces}
        lens="status"
        theme={theme}
      />
      <TerritoryLabels
        model={model}
        theme={theme}
        store={labels.store}
        onDrillProject={onDrillProject}
      />
      {model.territories
        .filter(
          ({ zone }) =>
            layout.stats.sourceAgentCount <= 100 ||
            zone.id === layout.focusedProjectId
        )
        .map(({ zone }) => (
          <group key={`controls:${zone.id}`}>
            <AgentControls
              pieces={layout.pieces}
              altitude="project"
              focusedProjectId={zone.id}
              onSelectAgent={onSelectAgent}
              onToggleAgentSelect={onToggleAgentSelect}
              onHoverChange={hover.setAgent}
              onPressedChange={hover.setPressed}
              multiSelection={multiSelection}
              reduced={reduced}
              theme={theme}
            />
            <DelegationControls
              units={layout.delegationUnits}
              pieces={layout.pieces}
              altitude="project"
              focusedProjectId={zone.id}
              onSelectAgent={onSelectAgent}
              onSelectDelegationChild={onSelectDelegationChild}
              onHoverChange={hover.setDelegation}
              reduced={reduced}
              theme={theme}
            />
          </group>
        ))}
    </>
  );
}

function TerritoryLabels({
  model,
  theme,
  store,
  onDrillProject,
}: {
  model: ReturnType<typeof qualityModel>;
  theme: SpatialThemeSnapshot;
  store: ZoneLabelTierStore;
  onDrillProject: (id: string) => void;
}) {
  const tier = useSyncExternalStore(store.subscribe, store.get, store.get);
  return (
    <>
      {model.territories.map(({ zone, rect }) => (
        <Html
          key={zone.id}
          position={boardWorldPosition({ x: rect.x, y: rect.y - 0.5 }, 1)}
          zIndexRange={[30, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <button
            data-board-zone={zone.id}
            className="group pointer-events-auto flex w-max flex-col items-start gap-1 rounded-md px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{
              color: theme.label,
              background: spatialColorWithAlpha(theme.canvas, 0.92),
            }}
            disabled={zone.isAggregate}
            onClick={() => onDrillProject(zone.id)}
            aria-label={`Open Project ${zone.label}`}
          >
            <span className="flex items-center gap-2 whitespace-nowrap text-sm font-semibold">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: spatialProjectIdentityColor(theme, zone.id),
                }}
              />
              {tier === 'nano' ? zone.slotIndex + 1 : zone.label}
              <span
                className="font-mono text-chrome-meta font-normal"
                style={{ color: theme.labelMuted }}
              >
                {zone.agentCount}
              </span>
            </span>
            <span
              className={
                tier === 'full'
                  ? 'flex gap-3 whitespace-nowrap pl-3.5 font-mono text-chrome-meta'
                  : 'hidden'
              }
              style={{ color: theme.labelMuted }}
            >
              <span>{zone.activeCount} active</span>
              {zone.blockedCount > 0 && (
                <span style={{ color: theme.status['needs-you'] }}>
                  {zone.blockedCount} blocked
                </span>
              )}
            </span>
          </button>
        </Html>
      ))}
    </>
  );
}
